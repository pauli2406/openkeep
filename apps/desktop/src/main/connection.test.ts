import { describe, expect, it } from "vitest";
import {
  normalizeArchiveUrl,
  resolveArchiveApiUrl,
} from "./connection";

describe("archive URL normalization", () => {
  it("adds HTTPS and preserves a reverse-proxy base path", () => {
    expect(normalizeArchiveUrl(" archive.example.com/openkeep/ ")).toBe(
      "https://archive.example.com/openkeep",
    );
    expect(resolveArchiveApiUrl("https://archive.example.com/openkeep", "/api/health"))
      .toBe("https://archive.example.com/openkeep/api/health");
  });

  it.each([
    "",
    "file:///tmp/archive",
    "https://user:secret@example.com",
    "https://example.com/?token=secret",
    "https://example.com/#private",
  ])("rejects unsafe server URL %s", (value) => {
    expect(() => normalizeArchiveUrl(value)).toThrow();
  });
});
