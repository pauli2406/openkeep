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

export interface EmailIngestSummary {
  imported: number;
  skipped: number;
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
      return { imported: 0, skipped: 0, failed: 0, unconfigured: true };
    }

    const [owner] = await this.databaseService.db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.isOwner, true))
      .limit(1);
    if (!owner) {
      this.logger.warn("Email ingestion skipped: no owner account exists yet");
      return { imported: 0, skipped: 0, failed: 0 };
    }
    const principal: AuthenticatedPrincipal = {
      userId: owner.id,
      email: owner.email,
      type: "api-token",
    };

    const client = clientOverride ?? this.createClient();
    const summary: EmailIngestSummary = { imported: 0, skipped: 0, failed: 0 };

    try {
      const messages = await client.fetchUnprocessed(MESSAGES_PER_POLL);

      for (const message of messages) {
        const [existing] = await this.databaseService.db
          .select({ id: ingestedEmails.id })
          .from(ingestedEmails)
          .where(eq(ingestedEmails.messageId, message.messageId))
          .limit(1);
        if (existing) {
          // Already recorded — a crash after record but before flagging.
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
    } finally {
      if (!clientOverride) {
        await client.close();
      }
    }

    if (summary.imported > 0 || summary.failed > 0) {
      this.logger.log(
        `Email ingestion: ${summary.imported} imported, ${summary.skipped} skipped, ${summary.failed} failed`,
      );
    }
    return summary;
  }

  private async ingestMessage(
    message: MailboxMessage,
    principal: AuthenticatedPrincipal,
  ): Promise<"imported" | "skipped"> {
    const supported = message.attachments.filter((attachment) =>
      SUPPORTED_MIME_TYPES.has(attachment.contentType.split(";")[0].trim().toLowerCase()),
    );

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
        mimeType: attachment.contentType.split(";")[0].trim().toLowerCase(),
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
}
