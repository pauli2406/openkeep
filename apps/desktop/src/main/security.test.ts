import { describe, expect, it } from "vitest";
import {
  assertTrustedIpcSender,
  classifyNavigation,
  isTrustedRendererUrl,
} from "./security";

describe("desktop renderer trust policy", () => {
  it.each([
    "openkeep://app/",
    "openkeep://app/documents",
    "openkeep://app/documents/0191",
    "openkeep://app/settings/providers",
  ])("allows an application route: %s", (value) => {
    expect(isTrustedRendererUrl(value)).toBe(true);
    expect(classifyNavigation(value)).toBe("allow");
  });

  it.each([
    "openkeep://evil/",
    "openkeep://app.evil/",
    "openkeep://user@app/",
    "file:///tmp/index.html",
    "javascript:alert(1)",
    "data:text/html,hello",
  ])("rejects an untrusted renderer URL: %s", (value) => {
    expect(isTrustedRendererUrl(value)).toBe(false);
    expect(classifyNavigation(value)).toBe("deny");
  });

  it("classifies only explicit HTTPS and mail links as external", () => {
    expect(classifyNavigation("https://openkeep.de/docs")).toBe("external");
    expect(classifyNavigation("mailto:hello@openkeep.de")).toBe("external");
    expect(classifyNavigation("http://openkeep.de")).toBe("deny");
  });

  it("requires a known main-frame sender for IPC", () => {
    expect(() => assertTrustedIpcSender("openkeep://app/", true, true)).not.toThrow();
    expect(() => assertTrustedIpcSender("openkeep://app/", false, true)).toThrow();
    expect(() => assertTrustedIpcSender("openkeep://app/", true, false)).toThrow();
    expect(() => assertTrustedIpcSender("https://archive.example.com", true, true)).toThrow();
  });
});
