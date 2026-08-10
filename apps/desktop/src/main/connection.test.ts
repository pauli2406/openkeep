import { describe, expect, it, vi } from "vitest";
import {
  createConnectionService,
  normalizeArchiveUrl,
  resolveArchiveApiUrl,
} from "./connection";

const healthyPayload = {
  status: "ok",
  provider: {
    mode: "local-only",
    activeParseProvider: "local-ocr",
  },
};

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

describe("connection service", () => {
  it("activates an archive only after a valid OpenKeep health response", async () => {
    const fetchRequest = vi.fn(async () =>
      new Response(JSON.stringify(healthyPayload), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const connection = createConnectionService(fetchRequest);

    await expect(connection.checkHealth({ serverUrl: "localhost:3000" })).resolves.toEqual({
      ok: true,
      serverUrl: "https://localhost:3000",
      serverStatus: "ok",
    });
    expect(connection.getActiveArchiveUrl()).toBe("https://localhost:3000");
    expect(fetchRequest).toHaveBeenCalledWith(
      "https://localhost:3000/api/health",
      expect.objectContaining({ method: "GET", signal: expect.any(AbortSignal) }),
    );
  });

  it("does not activate an incompatible server", async () => {
    const connection = createConnectionService(async () =>
      new Response(JSON.stringify({ status: "ok" }), { status: 200 }),
    );

    await expect(connection.checkHealth({ serverUrl: "https://example.com" })).resolves
      .toMatchObject({ ok: false, code: "invalid-response" });
    expect(connection.getActiveArchiveUrl()).toBeNull();
  });

  it("returns sanitized HTTP and network failures", async () => {
    const unhealthy = createConnectionService(async () => new Response("secret", { status: 503 }));
    await expect(unhealthy.checkHealth({ serverUrl: "https://example.com" })).resolves
      .toEqual({
        ok: false,
        code: "unhealthy",
        message: "The server health check returned 503.",
      });

    const unreachable = createConnectionService(async () => {
      throw new Error("certificate and credential details");
    });
    const result = await unreachable.checkHealth({ serverUrl: "https://example.com" });
    expect(result).toMatchObject({ ok: false, code: "unreachable" });
    expect(JSON.stringify(result)).not.toContain("credential details");
  });
});
