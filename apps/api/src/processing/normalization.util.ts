const currencyAliases: Record<string, string> = {
  "€": "EUR",
  eur: "EUR",
  euro: "EUR",
  euros: "EUR",
  "$": "USD",
  usd: "USD",
  us$: "USD",
  gbp: "GBP",
  "£": "GBP",
  chf: "CHF",
  fr: "CHF",
};

const monthMap: Record<string, number> = {
  jan: 1,
  january: 1,
  januar: 1,
  feb: 2,
  february: 2,
  februar: 2,
  mar: 3,
  march: 3,
  maerz: 3,
  märz: 3,
  apr: 4,
  april: 4,
  may: 5,
  mai: 5,
  jun: 6,
  june: 6,
  juni: 6,
  jul: 7,
  july: 7,
  juli: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  oktober: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
  dez: 12,
  dezember: 12,
};

export const toUtcDateOnly = (year: number, month: number, day: number): Date | null => {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return parsed;
};

export const parseDateOnly = (raw: string | null | undefined): Date | null => {
  if (!raw?.trim()) {
    return null;
  }

  const normalized = raw.trim().replace(/,\s+/g, " ");
  const isoMatch = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    return toUtcDateOnly(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  }

  const numericMatch = normalized.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (numericMatch) {
    const year =
      numericMatch[3].length === 2 ? Number(`20${numericMatch[3]}`) : Number(numericMatch[3]);
    const first = Number(numericMatch[1]);
    const second = Number(numericMatch[2]);
    const useMonthFirst = normalized.includes("/") && first <= 12;
    const month = useMonthFirst ? first : second;
    const day = useMonthFirst ? second : first;
    return toUtcDateOnly(year, month, day);
  }

  const textualMatch = normalized.match(/^([A-Za-zÄÖÜäöüß.]+)\s+(\d{1,2})\s+(\d{4})$/);
  if (textualMatch) {
    const month = monthMap[textualMatch[1].replace(/\./g, "").toLowerCase()];
    if (!month) {
      return null;
    }

    return toUtcDateOnly(Number(textualMatch[3]), month, Number(textualMatch[2]));
  }

  const monthYearMatch = normalized.match(
    /(?:^|\s)(?:im\s+)?([A-Za-zÄÖÜäöüß.]+)\s+(\d{2}|\d{4})(?:$|\s)/i,
  );
  if (monthYearMatch) {
    const month = monthMap[monthYearMatch[1].replace(/\./g, "").toLowerCase()];
    if (month) {
      const yearText = monthYearMatch[2];
      const year = yearText.length === 2 ? Number(`20${yearText}`) : Number(yearText);
      return toUtcDateOnly(year, month, 1);
    }
  }

  if (/[A-Za-zÄÖÜäöüß]/.test(normalized) && !/\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{1,2}-\d{1,2}/.test(normalized)) {
    return null;
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return toUtcDateOnly(
    parsed.getUTCFullYear(),
    parsed.getUTCMonth() + 1,
    parsed.getUTCDate(),
  );
};

export const dateToIso = (value: Date | null | undefined): string | null =>
  value ? value.toISOString().slice(0, 10) : null;

export const normalizeCurrencyCode = (raw: string | null | undefined): string | null => {
  if (!raw?.trim()) {
    return null;
  }

  const key = raw.trim().toLowerCase();
  return currencyAliases[key] ?? key.toUpperCase().slice(0, 3);
};

export const normalizeAmountValue = (raw: string | null | undefined): number | null => {
  if (!raw?.trim()) {
    return null;
  }

  const compact = raw.trim().replace(/\s+/g, "");
  const hasComma = compact.includes(",");
  const hasDot = compact.includes(".");
  let normalized = compact;

  if (hasComma && hasDot) {
    normalized =
      compact.lastIndexOf(",") > compact.lastIndexOf(".")
        ? compact.replace(/\./g, "").replace(",", ".")
        : compact.replace(/,/g, "");
  } else if (hasComma) {
    normalized = compact.replace(",", ".");
  }

  const value = Number(normalized);
  return Number.isFinite(value) ? Number(value.toFixed(2)) : null;
};

export const computeConfidence = (values: {
  base: number;
  boosts?: number[];
  penalties?: number[];
}): number => {
  const boosts = values.boosts?.reduce((sum, value) => sum + value, 0) ?? 0;
  const penalties = values.penalties?.reduce((sum, value) => sum + value, 0) ?? 0;
  const confidence = values.base + boosts - penalties;
  return Math.max(0, Math.min(1, Number(confidence.toFixed(2))));
};

export const stripDiacritics = (value: string): string =>
  value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");

export const normalizeCorrespondentName = (
  raw: string | null | undefined,
): string | null => {
  if (!raw?.trim()) {
    return null;
  }

  const normalized = stripDiacritics(raw)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return normalized.length > 0 ? normalized.slice(0, 255) : null;
};
