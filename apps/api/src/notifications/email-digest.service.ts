import { Inject, Injectable, Logger } from "@nestjs/common";

import { AppConfigService } from "../common/config/app-config.service";
import { DatabaseService } from "../common/db/database.service";
import { MailerService } from "./mailer.service";
import { todayInTimezone } from "./notifications.service";

interface DigestRow {
  id: string;
  document_id: string;
  due_date: string;
  document_title: string;
  correspondent_name: string | null;
  amount: string | null;
  currency: string | null;
  user_id: string;
  email: string;
  ui_language: string;
}

interface DigestSection {
  heading: string;
  rows: DigestRow[];
}

const COPY = {
  en: {
    subject: (count: number) => `OpenKeep: ${count} deadline${count === 1 ? "" : "s"} need attention`,
    overdue: "Overdue",
    dueToday: "Due today",
    dueSoon: "Due soon",
    intro: "These documents in your archive carry deadlines that need attention:",
    footer: "You receive this because the deadline digest is enabled in your OpenKeep preferences.",
  },
  de: {
    subject: (count: number) =>
      `OpenKeep: ${count} Frist${count === 1 ? "" : "en"} brauchen Aufmerksamkeit`,
    overdue: "Überfällig",
    dueToday: "Heute fällig",
    dueSoon: "Bald fällig",
    intro: "Diese Dokumente in deinem Archiv tragen Fristen, die Aufmerksamkeit brauchen:",
    footer: "Du erhältst diese Mail, weil der Fristen-Digest in deinen OpenKeep-Einstellungen aktiviert ist.",
  },
} as const;

function formatAmount(amount: string | null, currency: string | null): string {
  return amount !== null && currency ? ` — ${amount} ${currency}` : "";
}

@Injectable()
export class EmailDigestService {
  private readonly logger = new Logger(EmailDigestService.name);
  private readonly timeZone: string | undefined;
  private readonly publicUrl: string | undefined;

  constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    @Inject(AppConfigService) private readonly configService: AppConfigService,
    @Inject(MailerService) private readonly mailerService: MailerService,
  ) {
    this.timeZone = this.configService.get("ARCHIVE_TIMEZONE");
    this.publicUrl = this.configService.get("PUBLIC_URL")?.replace(/\/$/, "");
  }

  /**
   * One email per opted-in user with pending, email-undelivered deadline
   * notifications. Sending marks the records, so the next run is empty —
   * a failed send marks nothing and the bounded pg-boss retry tries again.
   */
  async runDigest(todayOverride?: string): Promise<{ sent: number; skipped?: string }> {
    if (!this.mailerService.configured) {
      this.logger.warn("Email digest skipped: SMTP is not configured");
      return { sent: 0, skipped: "unconfigured" };
    }

    const today = todayOverride ?? todayInTimezone(this.timeZone);

    const pending = await this.databaseService.pool.query<DigestRow>(
      `SELECT
         n.id, n.document_id, n.due_date::text AS due_date,
         d.title AS document_title,
         c.name AS correspondent_name,
         d.amount::text AS amount, d.currency,
         u.id AS user_id, u.email, u.ui_language
       FROM notifications n
       INNER JOIN users u ON u.id = n.user_id
       INNER JOIN documents d ON d.id = n.document_id
       LEFT JOIN correspondents c ON c.id = d.correspondent_id
       WHERE u.email_digest_enabled = true
         AND n.invalidated_at IS NULL
         AND n.email_delivered_at IS NULL
       ORDER BY n.due_date ASC`,
    );

    const byUser = new Map<string, DigestRow[]>();
    for (const row of pending.rows) {
      const rows = byUser.get(row.user_id) ?? [];
      rows.push(row);
      byUser.set(row.user_id, rows);
    }

    let sent = 0;
    for (const rows of byUser.values()) {
      const copy = rows[0].ui_language === "de" ? COPY.de : COPY.en;

      // The window label is computed against *today*, not against the window
      // the record was armed under — an "upcoming" record whose date has
      // meanwhile passed reads as overdue, which is the truth.
      const documentIds = new Set(rows.map((row) => row.document_id));
      const sections: DigestSection[] = [
        { heading: copy.overdue, rows: rows.filter((row) => row.due_date < today) },
        { heading: copy.dueToday, rows: rows.filter((row) => row.due_date === today) },
        { heading: copy.dueSoon, rows: rows.filter((row) => row.due_date > today) },
      ].filter((section) => section.rows.length > 0);

      // Deduplicate documents inside a section (a document can carry several
      // window records); the earliest record represents it.
      for (const section of sections) {
        const seen = new Set<string>();
        section.rows = section.rows.filter((row) => {
          if (seen.has(row.document_id)) return false;
          seen.add(row.document_id);
          return true;
        });
      }

      const textLines: string[] = [copy.intro, ""];
      const htmlParts: string[] = [`<p>${copy.intro}</p>`];
      for (const section of sections) {
        textLines.push(`${section.heading}:`);
        htmlParts.push(`<h3>${section.heading}</h3><ul>`);
        for (const row of section.rows) {
          const who = row.correspondent_name ? ` (${row.correspondent_name})` : "";
          const amount = formatAmount(row.amount, row.currency);
          const line = `${row.document_title}${who} — ${row.due_date}${amount}`;
          const link = this.publicUrl
            ? `${this.publicUrl}/documents/${row.document_id}`
            : null;
          textLines.push(link ? `- ${line}\n  ${link}` : `- ${line}`);
          htmlParts.push(
            link
              ? `<li><a href="${link}">${row.document_title}</a>${who} — ${row.due_date}${amount}</li>`
              : `<li>${line}</li>`,
          );
        }
        textLines.push("");
        htmlParts.push("</ul>");
      }
      textLines.push(copy.footer);
      htmlParts.push(`<p style="color:#666;font-size:12px">${copy.footer}</p>`);

      await this.mailerService.send({
        to: rows[0].email,
        subject: copy.subject(documentIds.size),
        text: textLines.join("\n"),
        html: htmlParts.join("\n"),
      });

      await this.databaseService.pool.query(
        `UPDATE notifications SET email_delivered_at = now() WHERE id = ANY($1::uuid[])`,
        [rows.map((row) => row.id)],
      );
      sent += 1;
    }

    if (sent > 0) {
      this.logger.log(`Email digest: ${sent} mail(s) sent`);
    }
    return { sent };
  }
}
