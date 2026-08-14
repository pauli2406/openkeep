import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { NotificationItem, NotificationsResponse } from "@openkeep/types";

import { AppConfigService } from "../common/config/app-config.service";
import { DatabaseService } from "../common/db/database.service";

export const DEADLINE_WINDOWS = ["upcoming", "due", "overdue"] as const;
export type DeadlineWindow = (typeof DEADLINE_WINDOWS)[number];

interface NotificationRow {
  id: string;
  document_id: string;
  kind: string;
  window: string;
  due_date: string;
  created_at: string;
  read_at: string | null;
  email_delivered_at: string | null;
  desktop_delivered_at: string | null;
  document_title: string;
  correspondent_name: string | null;
  amount: string | null;
  currency: string | null;
}

/** Today as YYYY-MM-DD in the archive's timezone — never UTC midnight math. */
export function todayInTimezone(timeZone: string | undefined, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly timeZone: string | undefined;
  private readonly upcomingDays: number;

  constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    @Inject(AppConfigService) private readonly configService: AppConfigService,
  ) {
    this.timeZone = this.configService.get("ARCHIVE_TIMEZONE");
    this.upcomingDays = this.configService.get("DEADLINE_UPCOMING_DAYS");
  }

  /**
   * Arm notification records for every deadline that has entered a window,
   * and invalidate records whose reason disappeared. Idempotent by the
   * unique (document, window, due_date) index: reruns, multiple workers,
   * and restarts insert nothing new.
   */
  async scanDeadlines(todayOverride?: string): Promise<{ armed: number; invalidated: number }> {
    const today = todayOverride ?? todayInTimezone(this.timeZone);

    // One statement per window keeps each insert idempotent and readable.
    // Every placeholder must appear in its statement, so each window carries
    // its own parameter list.
    const windows: Array<{ window: DeadlineWindow; where: string; params: unknown[] }> = [
      {
        window: "upcoming",
        where: `d.due_date > $2::date AND d.due_date <= $2::date + $3::int`,
        params: [today, this.upcomingDays],
      },
      { window: "due", where: `d.due_date = $2::date`, params: [today] },
      { window: "overdue", where: `d.due_date < $2::date`, params: [today] },
    ];

    let armed = 0;
    for (const { window, where, params } of windows) {
      const result = await this.databaseService.pool.query(
        `INSERT INTO notifications (user_id, document_id, kind, "window", due_date)
         SELECT d.owner_user_id, d.id, 'deadline', $1, d.due_date
         FROM documents d
         WHERE d.due_date IS NOT NULL
           AND d.task_completed_at IS NULL
           AND ${where}
         ON CONFLICT (document_id, "window", due_date) DO NOTHING`,
        [window, ...params],
      );
      armed += result.rowCount ?? 0;
    }

    // A completed task, a cleared deadline, or a moved date takes the reason
    // away: undelivered records for that document+date stop being pending.
    // Delivered records stay untouched — they are history, not intent.
    const invalidated = await this.databaseService.pool.query(
      `UPDATE notifications n
       SET invalidated_at = now()
       FROM documents d
       WHERE d.id = n.document_id
         AND n.invalidated_at IS NULL
         AND n.email_delivered_at IS NULL
         AND n.desktop_delivered_at IS NULL
         AND (
           d.task_completed_at IS NOT NULL
           OR d.due_date IS NULL
           OR d.due_date <> n.due_date
         )`,
    );

    if (armed > 0 || (invalidated.rowCount ?? 0) > 0) {
      this.logger.log(
        `Deadline scan: armed ${armed}, invalidated ${invalidated.rowCount ?? 0} (today=${today})`,
      );
    }

    return { armed, invalidated: invalidated.rowCount ?? 0 };
  }

  async listNotifications(
    userId: string,
    options: { undeliveredFor?: "email" | "desktop" } = {},
  ): Promise<NotificationsResponse> {
    const conditions = [`n.user_id = $1`, `n.invalidated_at IS NULL`];
    if (options.undeliveredFor === "email") {
      conditions.push(`n.email_delivered_at IS NULL`);
    } else if (options.undeliveredFor === "desktop") {
      conditions.push(`n.desktop_delivered_at IS NULL`);
    }

    const result = await this.databaseService.pool.query<NotificationRow>(
      `SELECT
         n.id, n.document_id, n.kind, n."window",
         n.due_date::text AS due_date,
         n.created_at::text AS created_at,
         n.read_at::text AS read_at,
         n.email_delivered_at::text AS email_delivered_at,
         n.desktop_delivered_at::text AS desktop_delivered_at,
         d.title AS document_title,
         c.name AS correspondent_name,
         d.amount::text AS amount,
         d.currency
       FROM notifications n
       INNER JOIN documents d ON d.id = n.document_id
       LEFT JOIN correspondents c ON c.id = d.correspondent_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY n.due_date ASC, n.created_at ASC
       LIMIT 200`,
      [userId],
    );

    const items: NotificationItem[] = result.rows.map((row) => ({
      id: row.id,
      documentId: row.document_id,
      documentTitle: row.document_title,
      correspondentName: row.correspondent_name,
      kind: row.kind,
      window: row.window as DeadlineWindow,
      dueDate: row.due_date,
      amount: row.amount === null ? null : Number(row.amount),
      currency: row.currency,
      createdAt: row.created_at,
      readAt: row.read_at,
      emailDeliveredAt: row.email_delivered_at,
      desktopDeliveredAt: row.desktop_delivered_at,
    }));

    return {
      items,
      unreadCount: items.filter((item) => item.readAt === null).length,
    };
  }

  async markRead(id: string, userId: string): Promise<void> {
    const result = await this.databaseService.pool.query(
      `UPDATE notifications SET read_at = now()
       WHERE id = $1 AND user_id = $2 AND read_at IS NULL`,
      [id, userId],
    );
    if ((result.rowCount ?? 0) === 0) {
      const exists = await this.databaseService.pool.query(
        `SELECT 1 FROM notifications WHERE id = $1 AND user_id = $2`,
        [id, userId],
      );
      if ((exists.rowCount ?? 0) === 0) {
        throw new NotFoundException("Notification not found");
      }
    }
  }
}
