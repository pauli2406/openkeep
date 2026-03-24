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
    expect(parseDateOnly("im Nov. 25")?.toISOString().slice(0, 10)).toBe("2025-11-01");
  });

  it("does not let free-form month text fall through to native Date parsing", () => {
    expect(parseDateOnly("Fellbach, im Nov. 25")?.toISOString().slice(0, 10)).toBe("2025-11-01");
    expect(parseDateOnly("im unbekannt 25")).toBeNull();
  });

  it("normalizes localized amount formats", () => {
    expect(normalizeAmountValue("1.234,56")).toBe(1234.56);
    expect(normalizeAmountValue("1,234.56")).toBe(1234.56);
    expect(normalizeAmountValue("42,50")).toBe(42.5);
    expect(normalizeAmountValue("12.345,67")).toBe(12345.67);
  });

  it("normalizes currencies to ISO-like codes", () => {
    expect(normalizeCurrencyCode("€")).toBe("EUR");
    expect(normalizeCurrencyCode("usd")).toBe("USD");
    expect(normalizeCurrencyCode("GBP")).toBe("GBP");
  });
});
