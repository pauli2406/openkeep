import { describe, expect, it } from "vitest";

import { isSenderAllowed, sniffSupportedType } from "../src/email-ingest/email-ingest.service";

describe("sniffSupportedType", () => {
  const pad = (buffer: Buffer) => Buffer.concat([buffer, Buffer.alloc(16)]);

  it("detects supported formats by their bytes", () => {
    expect(sniffSupportedType(pad(Buffer.from("%PDF-1.7")))).toBe("application/pdf");
    expect(sniffSupportedType(pad(Buffer.from([0xff, 0xd8, 0xff, 0xe0])))).toBe("image/jpeg");
    expect(
      sniffSupportedType(pad(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))),
    ).toBe("image/png");
    expect(sniffSupportedType(pad(Buffer.from([0x49, 0x49, 0x2a, 0x00])))).toBe("image/tiff");
    expect(sniffSupportedType(pad(Buffer.from([0x4d, 0x4d, 0x00, 0x2a])))).toBe("image/tiff");
    const heic = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x18]),
      Buffer.from("ftypheic"),
      Buffer.alloc(8),
    ]);
    expect(sniffSupportedType(heic)).toBe("image/heic");
  });

  it("refuses executables and other bytes regardless of the declared type", () => {
    // A Windows PE renamed to .pdf declares application/pdf but starts MZ.
    expect(sniffSupportedType(pad(Buffer.from("MZ\x90\x00")))).toBeNull();
    expect(sniffSupportedType(pad(Buffer.from("<html><body>")))).toBeNull();
    expect(sniffSupportedType(Buffer.alloc(4))).toBeNull();
  });
});

describe("isSenderAllowed", () => {
  const allowlist = ["vendor.example", "trusted@partner.example"];

  it("matches exact addresses and whole domains, case-insensitively", () => {
    expect(isSenderAllowed("billing@vendor.example", allowlist)).toBe(true);
    expect(isSenderAllowed("Billing@Vendor.EXAMPLE", allowlist)).toBe(true);
    expect(isSenderAllowed("trusted@partner.example", allowlist)).toBe(true);
    expect(isSenderAllowed("other@partner.example", allowlist)).toBe(false);
    expect(isSenderAllowed("evil@stranger.example", allowlist)).toBe(false);
    // A subdomain is not the domain.
    expect(isSenderAllowed("billing@evil.vendor.example", allowlist)).toBe(false);
    expect(isSenderAllowed("", allowlist)).toBe(false);
  });

  it("accepts everyone when no allowlist is configured", () => {
    expect(isSenderAllowed("anyone@anywhere.example", [])).toBe(true);
  });
});
