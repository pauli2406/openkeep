import { Inject, Injectable } from "@nestjs/common";
import { users } from "@openkeep/db";
import type {
  AnswerQueryRequest,
  AnswerQueryResponse,
  Document,
  DashboardDeadlineItem,
  ReviewReason,
} from "@openkeep/types";
import { eq } from "drizzle-orm";

import type { AuthenticatedPrincipal } from "../auth/auth.types";
import { DatabaseService } from "../common/db/database.service";
import { DocumentsService } from "../documents/documents.service";
import { ExplorerService } from "../explorer/explorer.service";

type StructuredQueryRoute =
  | {
      kind: "deadline_items";
      invoiceOnly: boolean;
      overdue: boolean;
      dueDateFrom: string | null;
      dueDateTo: string | null;
      title: string;
      description: string | null;
    }
  | {
      kind: "pending_review_documents";
      title: string;
      description: string | null;
    }
  | {
      kind: "expiring_contracts";
      expiryDateFrom: string | null;
      expiryDateTo: string | null;
      title: string;
      description: string | null;
    };

@Injectable()
export class SearchOrchestratorService {
  constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    @Inject(DocumentsService) private readonly documentsService: DocumentsService,
    @Inject(ExplorerService) private readonly explorerService: ExplorerService,
  ) {}

  async answerQuery(
    request: AnswerQueryRequest,
    principal: AuthenticatedPrincipal,
  ): Promise<AnswerQueryResponse> {
    const route = this.routeStructuredQuery(request.query);
    if (!route) {
      return this.documentsService.answerQuery(request, principal);
    }

    return this.answerStructuredQuery(route, principal, request.maxDocuments, request.query);
  }

  async *streamAnswer(
    request: AnswerQueryRequest,
    principal: AuthenticatedPrincipal,
  ): AsyncGenerator<string> {
    const route = this.routeStructuredQuery(request.query);
    if (!route) {
      for await (const chunk of this.documentsService.streamAnswer(request, principal)) {
        yield chunk;
      }
      return;
    }

    const response = await this.answerStructuredQuery(route, principal, request.maxDocuments, request.query);
    yield `event: search-results\ndata: ${JSON.stringify({ results: [] })}\n\n`;
    yield `event: done\ndata: ${JSON.stringify({
      status: response.status,
      route: response.route,
      fullAnswer: response.answer,
      citations: response.citations,
      structuredData: response.structuredData,
    })}\n\n`;
  }

  private async answerStructuredQuery(
    route: StructuredQueryRoute,
    principal: AuthenticatedPrincipal,
    maxDocuments: number,
    originalQuery: string,
  ): Promise<AnswerQueryResponse> {
    const preferredLanguage = await this.getUserAiChatLanguage(principal.userId);
    const language = looksGerman(normalizeQuery(originalQuery)) ? "de" : preferredLanguage;
    const safeMaxDocuments = Number.isFinite(maxDocuments) ? maxDocuments : 0;

    switch (route.kind) {
      case "deadline_items":
        return this.answerStructuredDeadlineQuery(route, language, safeMaxDocuments);
      case "pending_review_documents":
        return this.answerStructuredPendingReviewQuery(route, language, safeMaxDocuments);
      case "expiring_contracts":
        return this.answerStructuredExpiringContractsQuery(route, language, safeMaxDocuments);
    }
  }

  private async answerStructuredDeadlineQuery(
    route: Extract<StructuredQueryRoute, { kind: "deadline_items" }>,
    language: "en" | "de",
    maxDocuments: number,
  ): Promise<AnswerQueryResponse> {
    const items = await this.explorerService.listDeadlineItems({
      overdue: route.overdue,
      dueDateFrom: route.dueDateFrom,
      dueDateTo: route.dueDateTo,
      invoiceOnly: route.invoiceOnly,
      limit: Math.max(maxDocuments, 50),
    });
    const { totalAmount, currency } = summarizeAmounts(items);

    return {
      status: "answered",
      route: "structured",
      answer: buildDeadlineAnswer({ language, route, items, totalAmount, currency }),
      reasoning:
        language === "de"
          ? "Antwort aus strukturierten Frist- und Aufgabenfeldern statt aus freiem Dokumenttext erzeugt."
          : "Answered from structured deadline and task fields instead of free-form document text.",
      citations: [],
      results: [],
      structuredData: {
        kind: "deadline_items",
        title: route.title,
        description: route.description,
        items,
        totalOpenCount: items.length,
        totalAmount,
        currency,
        windowStart: route.dueDateFrom,
        windowEnd: route.dueDateTo,
      },
    };
  }

  private async answerStructuredPendingReviewQuery(
    route: Extract<StructuredQueryRoute, { kind: "pending_review_documents" }>,
    language: "en" | "de",
    maxDocuments: number,
  ): Promise<AnswerQueryResponse> {
    const response = await this.documentsService.listReviewDocuments({
      page: 1,
      pageSize: Math.max(maxDocuments, 20),
    });

    return {
      status: "answered",
      route: "structured",
      answer: buildPendingReviewAnswer(language, response.items),
      reasoning:
        language === "de"
          ? "Antwort aus strukturiertem Review-Status und Review-Grunden erzeugt."
          : "Answered from structured review status and review reasons.",
      citations: [],
      results: [],
      structuredData: {
        kind: "pending_review_documents",
        title: route.title,
        description: route.description,
        items: response.items,
        totalCount: response.total,
      },
    };
  }

  private async answerStructuredExpiringContractsQuery(
    route: Extract<StructuredQueryRoute, { kind: "expiring_contracts" }>,
    language: "en" | "de",
    maxDocuments: number,
  ): Promise<AnswerQueryResponse> {
    const response = await this.documentsService.listExpiringDocuments({
      expiryDateFrom: route.expiryDateFrom,
      expiryDateTo: route.expiryDateTo,
      limit: Math.max(maxDocuments, 20),
    });

    return {
      status: "answered",
      route: "structured",
      answer: buildExpiringContractsAnswer(language, response.items, route.expiryDateTo),
      reasoning:
        language === "de"
          ? "Antwort aus strukturierten Ablaufdaten von Vertragsdokumenten erzeugt."
          : "Answered from structured contract expiry dates.",
      citations: [],
      results: [],
      structuredData: {
        kind: "expiring_contracts",
        title: route.title,
        description: route.description,
        items: response.items,
        totalCount: response.total,
        windowStart: route.expiryDateFrom,
        windowEnd: route.expiryDateTo,
      },
    };
  }

  private routeStructuredQuery(query: string): StructuredQueryRoute | null {
    const normalized = normalizeQuery(query);
    const today = new Date();

    if (isPendingReviewQuery(normalized)) {
      return {
        kind: "pending_review_documents",
        title: looksGerman(normalized) ? "Dokumente mit ausstehender Prufung" : "Documents pending review",
        description: looksGerman(normalized)
          ? "Dokumente mit strukturiertem Review-Status 'pending'."
          : "Documents with structured review status 'pending'.",
      };
    }

    if (isExpiringContractQuery(normalized)) {
      const isThisMonth = /(this month|diesen monat|diesem monat)/.test(normalized);
      const isNextMonth = /(next month|nachsten monat|naechsten monat|kommenden monat)/.test(normalized);
      const isSoon = /(soon|bald|demnachst|demnaechst|next 30 days|in den nachsten 30 tagen)/.test(normalized);
      let expiryDateFrom = formatDateOnly(today);
      let expiryDateTo: string | null = formatDateOnly(addDays(today, 30));

      if (isThisMonth) {
        expiryDateFrom = formatDateOnly(today);
        expiryDateTo = formatDateOnly(endOfMonth(today));
      } else if (isNextMonth) {
        const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
        expiryDateFrom = formatDateOnly(startOfMonth(nextMonth));
        expiryDateTo = formatDateOnly(endOfMonth(nextMonth));
      } else if (!isSoon) {
        expiryDateTo = formatDateOnly(addDays(today, 60));
      }

      return {
        kind: "expiring_contracts",
        expiryDateFrom,
        expiryDateTo,
        title: buildExpiringContractsTitle(normalized, isThisMonth, isNextMonth),
        description: buildExpiringContractsDescription(normalized, isThisMonth, isNextMonth),
      };
    }

    const hasInvoiceTerms = /(invoice|rechnung|bill|payment|pay|bezahlen|bezahl)/.test(normalized);
    const hasOperationalTerms =
      /(offen|open|overdue|uberfallig|ueberfaellig|deadline|frist|upcoming|task|aufgabe|this month|diesen monat|diesem monat|next month|nachsten monat|naechsten monat|kommenden monat|still|remaining|noch)/.test(
        normalized,
      ) || /zu bezahlen|noch zu bezahlen/.test(normalized);

    if (!hasInvoiceTerms && !hasOperationalTerms) {
      return null;
    }

    const isOverdue = /(overdue|uberfallig|ueberfaellig|past due)/.test(normalized);
    const isThisMonth = /(this month|diesen monat|diesem monat)/.test(normalized);
    const isNextMonth = /(next month|nachsten monat|naechsten monat|kommenden monat)/.test(normalized);
    const isRemainingWindow = /(noch|still|remaining|rest of)/.test(normalized);
    const wantsUpcoming = /(upcoming|als nachstes|next due|coming due)/.test(normalized);
    const invoiceOnly = hasInvoiceTerms;

    if (!hasOperationalTerms || (!invoiceOnly && !isOverdue && !isThisMonth && !isNextMonth && !wantsUpcoming)) {
      return null;
    }

    let dueDateFrom: string | null = null;
    let dueDateTo: string | null = null;

    if (isOverdue) {
      dueDateTo = formatDateOnly(addDays(today, -1));
    } else if (isThisMonth) {
      dueDateFrom = formatDateOnly(isRemainingWindow ? today : startOfMonth(today));
      dueDateTo = formatDateOnly(endOfMonth(today));
    } else if (isNextMonth) {
      const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
      dueDateFrom = formatDateOnly(startOfMonth(nextMonth));
      dueDateTo = formatDateOnly(endOfMonth(nextMonth));
    } else {
      dueDateFrom = formatDateOnly(today);
    }

    return {
      kind: "deadline_items",
      invoiceOnly,
      overdue: isOverdue,
      dueDateFrom,
      dueDateTo,
      title: buildDeadlineTitle({ normalized, invoiceOnly, isOverdue, isThisMonth, isNextMonth }),
      description: buildDeadlineDescription({ normalized, invoiceOnly, isOverdue, isThisMonth, isNextMonth }),
    };
  }

  private async getUserAiChatLanguage(userId: string): Promise<"en" | "de"> {
    const [user] = await this.databaseService.db
      .select({ aiChatLanguage: users.aiChatLanguage })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    return user?.aiChatLanguage === "de" ? "de" : "en";
  }
}

function buildDeadlineTitle(input: {
  normalized: string;
  invoiceOnly: boolean;
  isOverdue: boolean;
  isThisMonth: boolean;
  isNextMonth: boolean;
}): string {
  const isGerman = looksGerman(input.normalized);
  if (isGerman) {
    if (input.invoiceOnly && input.isOverdue) return "Offene uberfallige Rechnungen";
    if (input.invoiceOnly && input.isThisMonth) return "Offene Rechnungen in diesem Monat";
    if (input.invoiceOnly && input.isNextMonth) return "Offene Rechnungen im nachsten Monat";
    if (input.invoiceOnly) return "Offene Rechnungen";
    if (input.isOverdue) return "Uberfallige Aufgaben";
    return "Offene Fristen";
  }

  if (input.invoiceOnly && input.isOverdue) return "Open overdue invoices";
  if (input.invoiceOnly && input.isThisMonth) return "Open invoices this month";
  if (input.invoiceOnly && input.isNextMonth) return "Open invoices next month";
  if (input.invoiceOnly) return "Open invoices";
  if (input.isOverdue) return "Overdue tasks";
  return "Open deadlines";
}

function buildDeadlineDescription(input: {
  normalized: string;
  invoiceOnly: boolean;
  isOverdue: boolean;
  isThisMonth: boolean;
  isNextMonth: boolean;
}): string | null {
  const isGerman = looksGerman(input.normalized);
  if (isGerman) {
    if (input.isOverdue) {
      return input.invoiceOnly
        ? "Offene Rechnungen mit Falligkeit vor heute und ohne erledigte Aufgabe."
        : "Offene Aufgaben mit Falligkeit vor heute und ohne erledigte Aufgabe.";
    }
    if (input.isThisMonth) {
      return input.invoiceOnly
        ? "Offene Rechnungen im aktuellen Monatsfenster auf Basis strukturierter Falligkeitsfelder."
        : "Offene Aufgaben im aktuellen Monatsfenster auf Basis strukturierter Falligkeitsfelder.";
    }
    if (input.isNextMonth) {
      return input.invoiceOnly
        ? "Offene Rechnungen im nachsten Monat auf Basis strukturierter Falligkeitsfelder."
        : "Offene Aufgaben im nachsten Monat auf Basis strukturierter Falligkeitsfelder.";
    }
    return input.invoiceOnly
      ? "Offene Rechnungen auf Basis strukturierter Falligkeitsfelder."
      : "Offene Aufgaben auf Basis strukturierter Falligkeitsfelder.";
  }

  if (input.isOverdue) {
    return input.invoiceOnly
      ? "Open invoices due before today and not marked done."
      : "Open tasks due before today and not marked done.";
  }
  if (input.isThisMonth) {
    return input.invoiceOnly
      ? "Open invoices in the current month window from structured due-date fields."
      : "Open tasks in the current month window from structured due-date fields.";
  }
  if (input.isNextMonth) {
    return input.invoiceOnly
      ? "Open invoices in the next month window from structured due-date fields."
      : "Open tasks in the next month window from structured due-date fields.";
  }
  return input.invoiceOnly
    ? "Open invoices from structured due-date fields."
    : "Open tasks from structured due-date fields.";
}

function buildDeadlineAnswer(input: {
  language: "en" | "de";
  route: Extract<StructuredQueryRoute, { kind: "deadline_items" }>;
  items: DashboardDeadlineItem[];
  totalAmount: number | null;
  currency: string | null;
}): string {
  const { language, route, items, totalAmount, currency } = input;
  const noun = route.invoiceOnly
    ? language === "de"
      ? items.length === 1
        ? "offene Rechnung"
        : "offene Rechnungen"
      : items.length === 1
        ? "open invoice"
        : "open invoices"
    : language === "de"
      ? items.length === 1
        ? "offene Aufgabe"
        : "offene Aufgaben"
      : items.length === 1
        ? "open task"
        : "open tasks";

  if (items.length === 0) {
    if (language === "de") {
      if (route.overdue) {
        return route.invoiceOnly
          ? "Aktuell sind keine uberfalligen offenen Rechnungen in deinem Archiv erfasst."
          : "Aktuell sind keine uberfalligen offenen Aufgaben in deinem Archiv erfasst.";
      }
      if (route.dueDateTo) {
        return route.invoiceOnly
          ? "Fur dieses Zeitfenster sind aktuell keine offenen Rechnungen in deinem Archiv erfasst."
          : "Fur dieses Zeitfenster sind aktuell keine offenen Aufgaben in deinem Archiv erfasst.";
      }
      return route.invoiceOnly
        ? "Aktuell sind keine offenen Rechnungen in deinem Archiv erfasst."
        : "Aktuell sind keine offenen Aufgaben in deinem Archiv erfasst.";
    }

    if (route.overdue) {
      return route.invoiceOnly
        ? "There are currently no overdue open invoices in your archive."
        : "There are currently no overdue open tasks in your archive.";
    }
    if (route.dueDateTo) {
      return route.invoiceOnly
        ? "There are currently no open invoices in this time window."
        : "There are currently no open tasks in this time window.";
    }
    return route.invoiceOnly
      ? "There are currently no open invoices in your archive."
      : "There are currently no open tasks in your archive.";
  }

  const amountText =
    totalAmount !== null && currency
      ? language === "de"
        ? ` Zusammen ergibt das ${formatCurrency(totalAmount, currency, language)}.`
        : ` Combined amount: ${formatCurrency(totalAmount, currency, language)}.`
      : "";

  return language === "de"
    ? `Ich habe ${items.length} ${noun} gefunden.${amountText}`
    : `I found ${items.length} ${noun}.${amountText}`;
}

function buildPendingReviewAnswer(language: "en" | "de", items: Document[]): string {
  if (items.length === 0) {
    return language === "de"
      ? "Aktuell gibt es keine Dokumente mit ausstehender Prufung."
      : "There are currently no documents pending review.";
  }

  const topReasons = summarizeReviewReasons(items);
  const reasonText =
    topReasons.length > 0
      ? language === "de"
        ? ` Haufige Grunde: ${topReasons.join(", ")}.`
        : ` Common reasons: ${topReasons.join(", ")}.`
      : "";

  return language === "de"
    ? `Ich habe ${items.length} Dokumente mit ausstehender Prufung gefunden.${reasonText}`
    : `I found ${items.length} documents pending review.${reasonText}`;
}

function buildExpiringContractsTitle(
  normalized: string,
  isThisMonth: boolean,
  isNextMonth: boolean,
): string {
  const isGerman = looksGerman(normalized);
  if (isGerman) {
    if (isThisMonth) return "Vertrage mit Ablauf in diesem Monat";
    if (isNextMonth) return "Vertrage mit Ablauf im nachsten Monat";
    return "Bald auslaufende Vertrage";
  }

  if (isThisMonth) return "Contracts expiring this month";
  if (isNextMonth) return "Contracts expiring next month";
  return "Contracts expiring soon";
}

function buildExpiringContractsDescription(
  normalized: string,
  isThisMonth: boolean,
  isNextMonth: boolean,
): string {
  const isGerman = looksGerman(normalized);
  if (isGerman) {
    if (isThisMonth) return "Vertragsdokumente mit strukturiertem Ablaufdatum im aktuellen Monat.";
    if (isNextMonth) return "Vertragsdokumente mit strukturiertem Ablaufdatum im nachsten Monat.";
    return "Vertragsdokumente mit strukturiertem Ablaufdatum im nahen Zeitfenster.";
  }

  if (isThisMonth) return "Contract documents with structured expiry dates in the current month.";
  if (isNextMonth) return "Contract documents with structured expiry dates in the next month.";
  return "Contract documents with structured expiry dates in the near-term window.";
}

function buildExpiringContractsAnswer(
  language: "en" | "de",
  items: Document[],
  expiryDateTo: string | null,
): string {
  if (items.length === 0) {
    return language === "de"
      ? "Aktuell sind keine bald auslaufenden Vertrage in deinem Archiv erfasst."
      : "There are currently no contracts expiring soon in your archive.";
  }

  const qualifier = expiryDateTo
    ? language === "de"
      ? ` bis ${expiryDateTo}`
      : ` by ${expiryDateTo}`
    : "";

  return language === "de"
    ? `Ich habe ${items.length} Vertragsdokumente mit Ablauf${qualifier} gefunden.`
    : `I found ${items.length} contract documents expiring${qualifier}.`;
}

function summarizeReviewReasons(items: Document[]): string[] {
  const counts = new Map<ReviewReason, number>();
  for (const item of items) {
    for (const reason of item.reviewReasons) {
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([reason]) => reason.replaceAll("_", " "));
}

function summarizeAmounts(items: DashboardDeadlineItem[]): {
  totalAmount: number | null;
  currency: string | null;
} {
  const currencies = [...new Set(items.map((item) => item.currency).filter(Boolean))];
  if (currencies.length !== 1) {
    return { totalAmount: null, currency: null };
  }

  const totalAmount = items.reduce((sum, item) => sum + (item.amount ?? 0), 0);
  return {
    totalAmount: Number.isFinite(totalAmount) ? totalAmount : null,
    currency: currencies[0] ?? null,
  };
}

function isPendingReviewQuery(query: string): boolean {
  return /(pending review|review queue|needs review|under review|ausstehender prufung|prufung ausstehend|zu prufen|zu pruefen|gepruft|gepruft werden|review)/.test(
    query,
  );
}

function isExpiringContractQuery(query: string): boolean {
  return /(contract|vertrage|vertrag|agreement).*(expir|lauf|end|renew|renewal|verlanger|verlaenger)/.test(
    query,
  ) || /(which|welche).*(contract|vertrag|agreement).*(expir|endet|ablauf|laufzeit)/.test(query);
}

function formatCurrency(amount: number, currency: string, language: "en" | "de"): string {
  return new Intl.NumberFormat(language === "de" ? "de-DE" : "en-US", {
    style: "currency",
    currency,
  }).format(amount);
}

function looksGerman(query: string): boolean {
  return /(welche|rechnung|rechnungen|diesen monat|uberfallig|ueberfaellig|bezahlen|fallig|faellig|noch|prufung|vertrag|vertrage)/.test(
    query,
  );
}

function normalizeQuery(query: string): string {
  return query
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss");
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
