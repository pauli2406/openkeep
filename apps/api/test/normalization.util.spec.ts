import { describe, expect, it } from "vitest";

import {
  normalizeAmountValue,
  normalizeCurrencyCode,
  parseDateOnly,
  tagSlug,
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

  describe("tagSlug", () => {
    it("collapses case and punctuation variants onto one slug", () => {
      expect(tagSlug("Rechnung")).toBe("rechnung");
      expect(tagSlug("rechnung")).toBe("rechnung");
      expect(tagSlug("Rechnung!")).toBe("rechnung");
      expect(tagSlug("Umsatz Steuer")).toBe(tagSlug("umsatz-steuer"));
      expect(tagSlug("  Krankenkasse  ")).toBe("krankenkasse");
    });

    it("hashes names slugify cannot transliterate instead of returning an empty slug", () => {
      // Pinned: migration 0020 rewrites stored empty slugs with the same
      // sha256-over-normalized-name recipe in SQL, so this value must not
      // drift without the migration changing too.
      expect(tagSlug("日本語")).toBe("tag-77710aedc74ecfa3");
      expect(tagSlug("  日本語  ")).toBe("tag-77710aedc74ecfa3");
      expect(tagSlug("🎉")).toMatch(/^tag-[0-9a-f]{16}$/);
      expect(tagSlug("🎉")).not.toBe(tagSlug("日本語"));
    });
  });
});
