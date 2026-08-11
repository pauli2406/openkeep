import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createAppProtocolHandler, resolveRendererAsset } from "./protocol";

const rendererRoot = path.resolve("/virtual/openkeep-renderer");
const indexPath = path.join(rendererRoot, "index.html");
const assetPath = path.join(rendererRoot, "assets", "app.js");
const fileExists = (filePath: string) => [indexPath, assetPath].includes(filePath);
const activeSession = {
  profile: {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    label: "archive.example.com",
    serverUrl: "https://archive.example.com/base",
    allowInsecureHttp: false,
  },
  credentials: {
    apiToken: "desktop-api-token",
    cfAccessClientId: "client.access",
    cfAccessClientSecret: "cloudflare-secret",
  },
  signal: new AbortController().signal,
};

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
    "openkeep://user@app/",
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
      archiveSession: { getActiveSession: () => null },
      fileExists,
      fetchRequest: async () => new Response("<html></html>", { status: 200 }),
    });

    const response = await handler(new Request("openkeep://app/"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(response.headers.get("content-security-policy")).not.toContain("bypassCSP");
  });

  it("keeps API traffic out of the static renderer", async () => {
    const fetchRequest = vi.fn(
      async (_input: string | Request, _init?: RequestInit) => new Response("ok"),
    );
    const disconnected = createAppProtocolHandler({
      rendererRoot,
      archiveSession: { getActiveSession: () => null },
      fileExists,
      fetchRequest,
    });
    expect((await disconnected(new Request("openkeep://app/api/health"))).status).toBe(503);
    const response = await disconnected(new Request("openkeep://app/api/documents"));
    expect(response.status).toBe(503);
    expect(response.headers.get("x-openkeep-desktop-error")).toBe(
      "archive-unavailable",
    );
    expect(fetchRequest).not.toHaveBeenCalled();
  });

  it("never lends active credentials to another profile partition", async () => {
    const fetchRequest = vi.fn(async () => new Response("unexpected"));
    const handler = createAppProtocolHandler({
      rendererRoot,
      profileId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      archiveSession: { getActiveSession: () => activeSession },
      fileExists,
      fetchRequest,
    });

    const response = await handler(new Request("openkeep://app/api/documents"));
    expect(response.status).toBe(503);
    expect(fetchRequest).not.toHaveBeenCalled();
  });

  it("aborts a proxied request when its active profile is switched", async () => {
    const activeController = new AbortController();
    const fetchRequest = vi.fn(
      (_input: string | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
    );
    const handler = createAppProtocolHandler({
      rendererRoot,
      profileId: activeSession.profile.id,
      archiveSession: {
        getActiveSession: () => ({ ...activeSession, signal: activeController.signal }),
      },
      fileExists,
      fetchRequest,
    });

    const response = handler(new Request("openkeep://app/api/search/answer/stream"));
    activeController.abort();
    await expect(response).resolves.toMatchObject({ status: 502 });
  });

  it("forwards authenticated API traffic without renderer-supplied credentials", async () => {
    let forwardedBody = "";
    const fetchRequest = vi.fn(
      async (_input: string | Request, init?: RequestInit) => {
        forwardedBody = await new Response(init?.body).text();
        return new Response("ok");
      },
    );
    const handler = createAppProtocolHandler({
      rendererRoot,
      profileId: activeSession.profile.id,
      archiveSession: { getActiveSession: () => activeSession },
      fileExists,
      fetchRequest,
    });

    const response = await handler(
      new Request("openkeep://app/api/documents?page=2", {
        method: "POST",
        headers: {
          authorization: "Bearer renderer-spoof",
          "cf-access-client-secret": "renderer-spoof",
          "content-type": "application/json",
        },
        body: JSON.stringify({ title: "Upload" }),
        duplex: "half",
      } as RequestInit & { duplex: "half" }),
    );
    expect(response.status).toBe(200);
    expect(fetchRequest).toHaveBeenCalledWith(
      "https://archive.example.com/base/api/documents?page=2",
      expect.objectContaining({
        method: "POST",
        body: expect.anything(),
        redirect: "manual",
      }),
    );
    const headers = new Headers(fetchRequest.mock.calls[0][1]?.headers);
    expect(headers.get("authorization")).toBe("Bearer desktop-api-token");
    expect(headers.get("cf-access-client-id")).toBe("client.access");
    expect(headers.get("cf-access-client-secret")).toBe("cloudflare-secret");
    expect(headers.get("content-type")).toBe("application/json");
    expect(forwardedBody).toBe(JSON.stringify({ title: "Upload" }));
  });

  it("preserves multipart uploads without rebuilding their body or content type", async () => {
    let uploadedBody = "";
    let uploadedContentType = "";
    const fetchRequest = vi.fn(
      async (_input: string | Request, init?: RequestInit) => {
        uploadedContentType = new Headers(init?.headers).get("content-type") ?? "";
        uploadedBody = await new Response(init?.body).text();
        return new Response(null, { status: 201 });
      },
    );
    const handler = createAppProtocolHandler({
      rendererRoot,
      profileId: activeSession.profile.id,
      archiveSession: { getActiveSession: () => activeSession },
      fileExists,
      fetchRequest,
    });
    const boundary = "openkeep-desktop-boundary";
    const multipartBody = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="document"; filename="archive.txt"',
      "Content-Type: text/plain",
      "",
      "desktop-upload",
      `--${boundary}--`,
      "",
    ].join("\r\n");

    const response = await handler(
      new Request("openkeep://app/api/documents/upload", {
        method: "POST",
        headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
        body: multipartBody,
      }),
    );

    expect(response.status).toBe(201);
    expect(uploadedContentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(uploadedBody).toContain("desktop-upload");
    expect(uploadedBody).toContain('filename="archive.txt"');
  });

  it("preserves binary downloads as ordinary responses", async () => {
    const bytes = new Uint8Array([0, 23, 42, 255]);
    const download = new Response(bytes, {
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": 'attachment; filename="document.bin"',
      },
    });
    const handler = createAppProtocolHandler({
      rendererRoot,
      profileId: activeSession.profile.id,
      archiveSession: { getActiveSession: () => activeSession },
      fileExists,
      fetchRequest: vi.fn(async () => download),
    });

    const response = await handler(new Request("openkeep://app/api/documents/42/download"));
    expect(response).toBe(download);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  it("preserves SSE responses as ordinary streaming responses", async () => {
    const sse = new Response("event: token\ndata: hello\n\n", {
      headers: { "content-type": "text/event-stream" },
    });
    const fetchRequest = vi.fn(async () => sse);
    const handler = createAppProtocolHandler({
      rendererRoot,
      profileId: activeSession.profile.id,
      archiveSession: { getActiveSession: () => activeSession },
      fileExists,
      fetchRequest,
    });

    const response = await handler(new Request("openkeep://app/api/search/answer/stream"));
    expect(response).toBe(sse);
    expect(await response.text()).toContain("event: token");
  });

  it.each([
    "/api/search/answer/stream",
    "/api/documents/42/summarize/stream",
    "/api/documents/42/ask/stream",
  ])("forwards every shared answer stream through the active profile: %s", async (route) => {
    const fetchRequest = vi.fn(
      async (_input: string | Request, _init?: RequestInit) =>
        new Response("event: done\ndata: {}\n\n", {
          headers: { "content-type": "text/event-stream" },
        }),
    );
    const handler = createAppProtocolHandler({
      rendererRoot,
      profileId: activeSession.profile.id,
      archiveSession: { getActiveSession: () => activeSession },
      fileExists,
      fetchRequest,
    });

    const response = await handler(
      new Request(`openkeep://app${route}`, { method: "POST", body: "{}" }),
    );
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(fetchRequest.mock.calls[0]?.[0]).toBe(
      `https://archive.example.com/base${route}`,
    );
  });

  it("delivers upstream chunks incrementally without waiting for stream completion", async () => {
    let upstream: ReadableStreamDefaultController<Uint8Array> | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        upstream = controller;
      },
    });
    const handler = createAppProtocolHandler({
      rendererRoot,
      profileId: activeSession.profile.id,
      archiveSession: { getActiveSession: () => activeSession },
      fileExists,
      fetchRequest: vi.fn(async () =>
        new Response(body, {
          headers: { "content-type": "text/event-stream" },
        }),
      ),
    });

    const response = await handler(
      new Request("openkeep://app/api/search/answer/stream"),
    );
    const reader = response.body!.getReader();
    const encoder = new TextEncoder();
    upstream!.enqueue(encoder.encode("event: answer-token\nda"));
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(
      "event: answer-token\nda",
    );
    upstream!.enqueue(encoder.encode('ta: {"text":"now"}\n\n'));
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(
      'ta: {"text":"now"}\n\n',
    );
    upstream!.close();
    expect((await reader.read()).done).toBe(true);
  });

  it("terminates an established stream when its active profile is switched", async () => {
    let forwardedSignal: AbortSignal | undefined;
    let upstream: ReadableStreamDefaultController<Uint8Array> | undefined;
    const profileController = new AbortController();
    const fetchRequest = vi.fn(async (_input: string | Request, init?: RequestInit) => {
      forwardedSignal = init?.signal ?? undefined;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          upstream = controller;
          forwardedSignal?.addEventListener(
            "abort",
            () => controller.error(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        },
      });
      return new Response(body, {
        headers: { "content-type": "text/event-stream" },
      });
    });
    const handler = createAppProtocolHandler({
      rendererRoot,
      profileId: activeSession.profile.id,
      archiveSession: {
        getActiveSession: () => ({ ...activeSession, signal: profileController.signal }),
      },
      fileExists,
      fetchRequest,
    });
    const response = await handler(
      new Request("openkeep://app/api/search/answer/stream"),
    );
    const reader = response.body!.getReader();
    upstream!.enqueue(new TextEncoder().encode("event: answer-token\n"));
    await reader.read();

    profileController.abort();
    expect(forwardedSignal?.aborted).toBe(true);
    await expect(reader.read()).rejects.toMatchObject({ name: "AbortError" });
  });

  it.each([401, 403, 429, 503])(
    "preserves upstream stream error status %i for the shared client",
    async (status) => {
      const upstream = new Response("untrusted upstream details", { status });
      const handler = createAppProtocolHandler({
        rendererRoot,
        profileId: activeSession.profile.id,
        archiveSession: { getActiveSession: () => activeSession },
        fileExists,
        fetchRequest: vi.fn(async () => upstream),
      });
      const response = await handler(
        new Request("openkeep://app/api/search/answer/stream"),
      );
      expect(response).toBe(upstream);
      expect(response.status).toBe(status);
    },
  );

  it("returns a sanitized gateway error without leaking fetch details", async () => {
    const handler = createAppProtocolHandler({
      rendererRoot,
      profileId: activeSession.profile.id,
      archiveSession: { getActiveSession: () => activeSession },
      fileExists,
      fetchRequest: async () => {
        throw new Error("secret token and certificate details");
      },
    });

    const response = await handler(new Request("openkeep://app/api/documents"));
    expect(response.status).toBe(502);
    expect(response.headers.get("x-openkeep-desktop-error")).toBe(
      "archive-unavailable",
    );
    expect(await response.text()).not.toContain("secret token");
  });
});
