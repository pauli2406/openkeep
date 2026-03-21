import { describe, expect, it } from "vitest";

import {
  normalizeAmountValue,
  normalizeCurrencyCode,
  parseDateOnly,
} from "../src/processing/normalization.util";

describe("normalization.util", () => {
  it("parses date-only values into UTC calendar dates", () => {
    expect(parseDateOnly("15.04.2025")?.toISOString().slice(0, 10)).toBe("2025-04-15");
    expect(parseDateOnly("2025-03-02")?.toISOString().slice(0, 10)).toBe("2025-03-02");
  });

  it("normalizes localized amount formats", () => {
    expect(normalizeAmountValue("1.234,56")).toBe(1234.56);
    expect(normalizeAmountValue("1,234.56")).toBe(1234.56);
    expect(normalizeAmountValue("42,50")).toBe(42.5);
  });

  it("normalizes currencies to ISO-like codes", () => {
    expect(normalizeCurrencyCode("€")).toBe("EUR");
    expect(normalizeCurrencyCode("usd")).toBe("USD");
    expect(normalizeCurrencyCode("GBP")).toBe("GBP");
  });
});
