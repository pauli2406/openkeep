import { Inject, Injectable, Logger } from "@nestjs/common";
import { ingestedEmails, users } from "@openkeep/db";
import { eq } from "drizzle-orm";

import type { AuthenticatedPrincipal } from "../auth/auth.types";
import { AppConfigService } from "../common/config/app-config.service";
import { DatabaseService } from "../common/db/database.service";
import { DocumentsService } from "../documents/documents.service";
import {
  createImapMailboxClient,
  type MailboxClient,
  type MailboxMessage,
} from "./mailbox-client";

/** The same types every other ingestion channel accepts. */
const SUPPORTED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/tiff",
  "image/heic",
  "image/heif",
]);

const MESSAGES_PER_POLL = 20;

/**
 * An inbox is an open port: whatever the declared Content-Type says, the
 * bytes decide. Mirrors the desktop importer's disguised-file rejection.
 * Returns the detected supported type, or null when the bytes are not a
 * supported document format.
 */
export function sniffSupportedType(content: Buffer): string | null {
  if (content.length < 12) return null;
  if (content.subarray(0, 4).toString("latin1") === "%PDF") return "application/pdf";
  if (content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) return "image/jpeg";
  if (content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return "image/png";
  if (
    (content[0] === 0x49 && content[1] === 0x49 && content[2] === 0x2a && content[3] === 0x00) ||
    (content[0] === 0x4d && content[1] === 0x4d && content[2] === 0x00 && content[3] === 0x2a)
  ) {
    return "image/tiff";
  }
  // ISO-BMFF: size (4 bytes) + "ftyp" + brand.
  if (content.subarray(4, 8).toString("latin1") === "ftyp") {
    const brand = content.subarray(8, 12).toString("latin1").toLowerCase();
    if (brand.startsWith("hei") || brand.startsWith("mif") || brand.startsWith("msf")) {
      return "image/heic";
    }
  }
  return null;
}

export function isSenderAllowed(from: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return true;
  const address = from.trim().toLowerCase();
  if (!address) return false;
  const domain = address.split("@")[1] ?? "";
  return allowlist.some((entry) => {
    const rule = entry.trim().toLowerCase();
    if (!rule) return false;
    return rule.includes("@") ? address === rule : domain === rule;
  });
}

export interface EmailIngestSummary {
  imported: number;
  skipped: number;
  rejected: number;
  failed: number;
  unconfigured?: boolean;
}

@Injectable()
export class EmailIngestService {
  private readonly logger = new Logger(EmailIngestService.name);

  constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    @Inject(AppConfigService) private readonly configService: AppConfigService,
    @Inject(DocumentsService) private readonly documentsService: DocumentsService,
  ) {}

  get configured(): boolean {
    return Boolean(
      this.configService.get("IMAP_HOST") &&
        this.configService.get("IMAP_USER") &&
        this.configService.get("IMAP_PASSWORD"),
    );
  }

  private createClient(): MailboxClient {
    return createImapMailboxClient({
      host: this.configService.get("IMAP_HOST") as string,
      port: this.configService.get("IMAP_PORT"),
      secure: this.configService.get("IMAP_SECURE"),
      user: this.configService.get("IMAP_USER") as string,
      password: this.configService.get("IMAP_PASSWORD") as string,
      folder: this.configService.get("IMAP_FOLDER"),
    });
  }

  /**
   * One poll: fetch unprocessed messages, import their supported attachments
   * through the exact upload path (checksum dedup, review routing, audit),
   * and record every message once by Message-ID.
   *
   * Crash ordering: the record is written before the message is flagged, and
   * the unique Message-ID index makes the record insert idempotent. A crash
   * between upload and record means the next poll re-uploads — where the
   * content-hash dedup resolves to the same document instead of a second one.
   */
  async pollOnce(clientOverride?: MailboxClient): Promise<EmailIngestSummary> {
    if (!clientOverride && !this.configured) {
      this.logger.warn("Email ingestion skipped: IMAP is not configured");
      return { imported: 0, skipped: 0, rejected: 0, failed: 0, unconfigured: true };
    }

    const [owner] = await this.databaseService.db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.isOwner, true))
      .limit(1);
    if (!owner) {
      this.logger.warn("Email ingestion skipped: no owner account exists yet");
      return { imported: 0, skipped: 0, rejected: 0, failed: 0 };
    }
    const principal: AuthenticatedPrincipal = {
      userId: owner.id,
      email: owner.email,
      type: "api-token",
    };

    const client = clientOverride ?? this.createClient();
    const summary: EmailIngestSummary = { imported: 0, skipped: 0, rejected: 0, failed: 0 };

    try {
      const messages = await client.fetchUnprocessed(MESSAGES_PER_POLL);

      const allowlist = (this.configService.get("EMAIL_INGEST_ALLOWED_SENDERS") ?? "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);

      for (const message of messages) {
        const [existing] = await this.databaseService.db
          .select({ id: ingestedEmails.id, status: ingestedEmails.status })
          .from(ingestedEmails)
          .where(eq(ingestedEmails.messageId, message.messageId))
          .limit(1);
        if (existing) {
          // Already recorded — a crash after record but before flagging.
          await client.markProcessed(message.messageId);
          continue;
        }

        if (!isSenderAllowed(message.from, allowlist)) {
          // Rejected messages keep their bytes in the mailbox — flagged seen
          // so they stop occupying the fetch window, never imported, and the
          // ledger answers "why did my forward not arrive".
          await this.recordMessage(message, "rejected", "sender-not-allowed", []);
          summary.rejected += 1;
          await client.markProcessed(message.messageId);
          continue;
        }

        try {
          const outcome = await this.ingestMessage(message, principal);
          summary[outcome] += 1;
        } catch (error) {
          summary.failed += 1;
          this.logger.error(
            `Email ingestion failed for message ${message.messageId}: ${String(error)}`,
          );
          // No record and no flag: the next poll retries this message.
          continue;
        }
        await client.markProcessed(message.messageId);
      }

      await this.pruneLog();
    } finally {
      if (!clientOverride) {
        await client.close();
      }
    }

    if (summary.imported > 0 || summary.failed > 0) {
      this.logger.log(
        `Email ingestion: ${summary.imported} imported, ${summary.skipped} skipped, ${summary.rejected} rejected, ${summary.failed} failed`,
      );
    }
    return summary;
  }

  private async ingestMessage(
    message: MailboxMessage,
    principal: AuthenticatedPrincipal,
  ): Promise<"imported" | "skipped" | "rejected"> {
    const maxBytes = this.configService.get("MAX_UPLOAD_BYTES");
    const declaredSupported = message.attachments.filter((attachment) =>
      SUPPORTED_MIME_TYPES.has(attachment.contentType.split(";")[0].trim().toLowerCase()),
    );

    // The bytes decide, not the declared Content-Type: a renamed executable
    // declaring application/pdf is rejected here the same way the desktop
    // importer rejects it.
    const rejectionReasons: string[] = [];
    const supported: Array<{ filename: string; content: Buffer; detectedType: string }> = [];
    for (const attachment of declaredSupported) {
      if (attachment.content.length > maxBytes) {
        rejectionReasons.push(`attachment-too-large:${attachment.filename}`);
        continue;
      }
      const detectedType = sniffSupportedType(attachment.content);
      if (!detectedType) {
        rejectionReasons.push(`disguised-file:${attachment.filename}`);
        continue;
      }
      supported.push({
        filename: attachment.filename,
        content: attachment.content,
        detectedType,
      });
    }

    if (supported.length === 0 && rejectionReasons.length > 0) {
      await this.recordMessage(message, "rejected", rejectionReasons.join(", "), []);
      return "rejected";
    }

    if (supported.length === 0) {
      await this.recordMessage(message, "skipped", "no-supported-attachment", []);
      return "skipped";
    }

    const documentIds: string[] = [];
    for (const attachment of supported) {
      const uploaded = await this.documentsService.uploadDocument({
        principal,
        buffer: attachment.content,
        filename: attachment.filename,
        // The sniffed type, not the declared one.
        mimeType: attachment.detectedType,
        metadata: {
          // The subject names the document when it has one; a message with
          // several attachments falls back to each attachment's own name.
          title:
            supported.length === 1 && message.subject?.trim()
              ? message.subject.trim()
              : undefined,
          source: "email",
        },
      });
      // The ledger records what this message actually created. Upload keeps
      // its normal duplicate semantics: same bytes share one file record, and
      // the response's duplicateOf points at the earlier document.
      documentIds.push(uploaded.id);
    }

    await this.recordMessage(message, "imported", null, documentIds);
    return "imported";
  }

  private async recordMessage(
    message: MailboxMessage,
    status: string,
    reason: string | null,
    documentIds: string[],
  ): Promise<void> {
    await this.databaseService.db
      .insert(ingestedEmails)
      .values({
        messageId: message.messageId,
        fromAddress: message.from,
        subject: message.subject,
        receivedAt: message.receivedAt,
        status,
        reason,
        documentIds,
      })
      .onConflictDoNothing();
  }

  /**
   * The rejection/skip log is capped: a leaked mailbox address cannot grow
   * the table unboundedly. Imported rows are never pruned — they are the
   * idempotency ledger, and dropping one would re-import its message.
   */
  private async pruneLog(): Promise<void> {
    const limit = this.configService.get("EMAIL_INGEST_LOG_LIMIT");
    await this.databaseService.pool.query(
      `DELETE FROM ingested_emails
       WHERE status <> 'imported'
         AND id NOT IN (
           SELECT id FROM ingested_emails
           WHERE status <> 'imported'
           ORDER BY created_at DESC
           LIMIT $1
         )`,
      [limit],
    );
  }
}
