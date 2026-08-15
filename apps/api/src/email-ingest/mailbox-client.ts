import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

export interface MailboxAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
}

export interface MailboxMessage {
  messageId: string;
  from: string;
  subject: string | null;
  receivedAt: Date | null;
  attachments: MailboxAttachment[];
}

/**
 * The seam between the poller and the wire. The ingest service is tested
 * against this interface with an in-memory fake; only this file speaks IMAP.
 */
export interface MailboxClient {
  fetchUnprocessed(limit: number): Promise<MailboxMessage[]>;
  /** Flags the message seen. Never moves, never deletes. */
  markProcessed(messageId: string): Promise<void>;
  close(): Promise<void>;
}

export interface ImapMailboxConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  folder: string;
}

/**
 * Unseen means unprocessed: the poller flags handled messages `\Seen` and
 * additionally records their Message-ID server-side, so the flag is a filter,
 * not the source of truth. A dedicated archive mailbox is assumed — a human
 * reading it by hand marks messages seen and thereby hides them from the
 * poller, which the operations docs state explicitly.
 */
export function createImapMailboxClient(config: ImapMailboxConfig): MailboxClient {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
    logger: false,
  });

  let connected = false;
  const uidByMessageId = new Map<string, number>();

  async function ensureConnected() {
    if (connected) return;
    await client.connect();
    await client.mailboxOpen(config.folder);
    connected = true;
  }

  return {
    async fetchUnprocessed(limit: number): Promise<MailboxMessage[]> {
      await ensureConnected();
      const unseen = await client.search({ seen: false });
      const uids = (Array.isArray(unseen) ? unseen : []).slice(0, limit);
      const messages: MailboxMessage[] = [];

      for (const uid of uids) {
        const fetched = await client.fetchOne(String(uid), { source: true });
        if (!fetched || typeof fetched === "boolean" || !fetched.source) continue;
        const parsed = await simpleParser(fetched.source);
        const messageId = parsed.messageId ?? `imap-uid-${uid}@${config.host}`;
        uidByMessageId.set(messageId, uid);
        messages.push({
          messageId,
          from: parsed.from?.value?.[0]?.address ?? "",
          subject: parsed.subject ?? null,
          receivedAt: parsed.date ?? null,
          attachments: (parsed.attachments ?? [])
            .filter((attachment) => Buffer.isBuffer(attachment.content))
            .map((attachment) => ({
              filename: attachment.filename ?? "attachment",
              contentType: attachment.contentType ?? "application/octet-stream",
              content: attachment.content as Buffer,
            })),
        });
      }

      return messages;
    },

    async markProcessed(messageId: string): Promise<void> {
      const uid = uidByMessageId.get(messageId);
      if (uid === undefined) return;
      await ensureConnected();
      await client.messageFlagsAdd(String(uid), ["\\Seen"]);
    },

    async close(): Promise<void> {
      if (!connected) return;
      connected = false;
      await client.logout().catch(() => undefined);
    },
  };
}
