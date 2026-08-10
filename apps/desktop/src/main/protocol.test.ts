import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createAppProtocolHandler, resolveRendererAsset } from "./protocol";

const rendererRoot = path.resolve("/virtual/openkeep-renderer");
const indexPath = path.join(rendererRoot, "index.html");
const assetPath = path.join(rendererRoot, "assets", "app.js");
const fileExists = (filePath: string) => [indexPath, assetPath].includes(filePath);

describe("renderer asset resolver", () => {
  it("serves the index for root and allowlisted client routes", () => {
    expect(resolveRendererAsset(rendererRoot, "openkeep://app/", fileExists))
      .toEqual({ ok: true, filePath: indexPath });
    expect(resolveRendererAsset(rendererRoot, "openkeep://app/documents/123", fileExists))
      .toEqual({ ok: true, filePath: indexPath });
  });

  it("serves exact assets without applying an arbitrary SPA fallback", () => {
    expect(resolveRendererAsset(rendererRoot, "openkeep://app/assets/app.js", fileExists))
      .toEqual({ ok: true, filePath: assetPath });
    expect(resolveRendererAsset(rendererRoot, "openkeep://app/missing.js", fileExists))
      .toEqual({ ok: false, status: 404 });
    expect(resolveRendererAsset(rendererRoot, "openkeep://app/not-a-route", fileExists))
      .toEqual({ ok: false, status: 404 });
  });

  it.each([
    "openkeep://evil/",
    "openkeep://app/%2e%2e/secret",
    "openkeep://app/%252e%252e/secret",
    "openkeep://app/%5csecret",
    "openkeep://app/%00secret",
  ])("rejects an unsafe asset URL: %s", (url) => {
    expect(resolveRendererAsset(rendererRoot, url, fileExists).ok).toBe(false);
  });
});

describe("openkeep protocol handler", () => {
  it("adds the production CSP to application HTML", async () => {
    const handler = createAppProtocolHandler({
      rendererRoot,
      connection: { getActiveArchiveUrl: () => null },
      fileExists,
      fetchRequest: async () => new Response("<html></html>", { status: 200 }),
    });

    const response = await handler(new Request("openkeep://app/"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(response.headers.get("content-security-policy")).not.toContain("bypassCSP");
  });

  it("keeps API traffic out of the static renderer", async () => {
    const fetchRequest = vi.fn(async () => new Response("ok"));
    const disconnected = createAppProtocolHandler({
      rendererRoot,
      connection: { getActiveArchiveUrl: () => null },
      fileExists,
      fetchRequest,
    });
    expect((await disconnected(new Request("openkeep://app/api/health"))).status).toBe(503);
    expect((await disconnected(new Request("openkeep://app/api/documents"))).status).toBe(501);
    expect(fetchRequest).not.toHaveBeenCalled();
  });

  it("forwards only health to the active archive during the foundation slice", async () => {
    const fetchRequest = vi.fn(async () => new Response("ok"));
    const handler = createAppProtocolHandler({
      rendererRoot,
      connection: { getActiveArchiveUrl: () => "https://archive.example.com/base" },
      fileExists,
      fetchRequest,
    });

    const response = await handler(new Request("openkeep://app/api/health"));
    expect(response.status).toBe(200);
    expect(fetchRequest).toHaveBeenCalledWith(
      "https://archive.example.com/base/api/health",
      expect.objectContaining({ method: "GET" }),
    );
  });
});
