import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createArchiveSessionService,
  requiresInsecureHttpConfirmation,
  type ArchiveProfileRepository,
  type StoredArchiveSession,
} from "./archive-session";

const health = {
  status: "ok",
  provider: { mode: "local-only", activeParseProvider: "local-ocr" },
};

const user = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  email: "owner@example.com",
  displayName: "Archive Owner",
  isOwner: true,
  twoFactorEnabled: false,
  preferences: {
    uiLanguage: "en",
    aiProcessingLanguage: "en",
    aiChatLanguage: "en",
  },
  createdAt: "2026-08-10T00:00:00.000Z",
};

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createRepository(stored: StoredArchiveSession | null = null) {
  let current = stored;
  const repository: ArchiveProfileRepository = {
    assertSecureStorageAvailable: vi.fn(async () => {}),
    loadActive: vi.fn(async () => current),
    saveActive: vi.fn(async (next) => {
      current = next;
    }),
    clear: vi.fn(async () => {
      current = null;
    }),
  };
  return repository;
}

const storedSession: StoredArchiveSession = {
  profile: {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    label: "archive.example.com",
    serverUrl: "https://archive.example.com/base",
    allowInsecureHttp: false,
  },
  credentials: {
    apiToken: "openkeep_secret_token",
    cfAccessClientId: "client.access",
    cfAccessClientSecret: "cf_secret",
  },
};

afterEach(() => vi.useRealTimers());

describe("desktop archive session", () => {
  it("verifies health and current user before persisting and activating", async () => {
    const repository = createRepository();
    const fetchRequest = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(health))
      .mockResolvedValueOnce(jsonResponse(user));
    const service = createArchiveSessionService(fetchRequest, repository, () => storedSession.profile.id);

    const result = await service.connect({
      serverUrl: "https://archive.example.com/base/",
      apiToken: " openkeep_secret_token ",
      cfAccessClientId: "client.access",
      cfAccessClientSecret: "cf_secret",
    });

    expect(result).toEqual({
      status: "connected",
      profile: {
        id: storedSession.profile.id,
        label: "archive.example.com",
        serverUrl: "https://archive.example.com/base",
      },
      user,
    });
    expect(repository.saveActive).toHaveBeenCalledOnce();
    expect(service.getActiveSession()?.credentials.apiToken).toBe("openkeep_secret_token");

    const healthHeaders = new Headers(fetchRequest.mock.calls[0][1]?.headers);
    expect(healthHeaders.get("authorization")).toBeNull();
    expect(healthHeaders.get("cf-access-client-id")).toBe("client.access");
    const meHeaders = new Headers(fetchRequest.mock.calls[1][1]?.headers);
    expect(meHeaders.get("authorization")).toBe("Bearer openkeep_secret_token");
    expect(meHeaders.get("cf-access-client-secret")).toBe("cf_secret");
  });

  it("does not persist or expose rejected credentials", async () => {
    const repository = createRepository();
    const service = createArchiveSessionService(
      vi.fn().mockResolvedValueOnce(jsonResponse(health)).mockResolvedValueOnce(new Response(null, { status: 401 })),
      repository,
      () => storedSession.profile.id,
    );

    const result = await service.connect({
      serverUrl: storedSession.profile.serverUrl,
      apiToken: "super-secret-rejected-token",
    });

    expect(result).toMatchObject({ status: "error", code: "invalid-credentials" });
    expect(JSON.stringify(result)).not.toContain("super-secret-rejected-token");
    expect(repository.saveActive).not.toHaveBeenCalled();
    expect(service.getActiveSession()).toBeNull();
  });

  it("requires an explicit warning for remote plaintext HTTP but allows localhost", async () => {
    expect(requiresInsecureHttpConfirmation("http://archive.example.com")).toBe(true);
    expect(requiresInsecureHttpConfirmation("http://localhost:3000")).toBe(false);
    expect(requiresInsecureHttpConfirmation("http://127.0.0.1:3000")).toBe(false);

    const repository = createRepository();
    const fetchRequest = vi.fn();
    const service = createArchiveSessionService(fetchRequest, repository, () => "id");
    await expect(
      service.connect({ serverUrl: "http://archive.example.com", apiToken: "token" }),
    ).resolves.toMatchObject({
      status: "error",
      code: "insecure-http-confirmation-required",
    });
    expect(fetchRequest).not.toHaveBeenCalled();

    await expect(
      service.connect({
        serverUrl: "http://archive.example.com",
        apiToken: "token",
        allowInsecureHttp: "yes" as unknown as boolean,
      }),
    ).resolves.toMatchObject({
      status: "error",
      code: "insecure-http-confirmation-required",
    });
  });

  it("replaces the single stored connection without accumulating profile IDs", async () => {
    const repository = createRepository(storedSession);
    const service = createArchiveSessionService(
      vi.fn()
        .mockResolvedValueOnce(jsonResponse(health))
        .mockResolvedValueOnce(jsonResponse(user)),
      repository,
      () => {
        throw new Error("an existing profile ID should be reused");
      },
    );

    await expect(
      service.connect({
        serverUrl: "https://replacement.example.com",
        apiToken: "replacement-token",
      }),
    ).resolves.toMatchObject({
      status: "connected",
      profile: { id: storedSession.profile.id },
    });
    expect(repository.saveActive).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: expect.objectContaining({ id: storedSession.profile.id }),
      }),
    );
  });

  it("requires Cloudflare Access credentials as a pair", async () => {
    const service = createArchiveSessionService(vi.fn(), createRepository(), () => "id");
    await expect(
      service.connect({
        serverUrl: "https://archive.example.com",
        apiToken: "token",
        cfAccessClientId: "client.access",
      }),
    ).resolves.toMatchObject({ status: "error", code: "invalid-url" });
  });

  it("restores a valid stored profile after restart", async () => {
    const repository = createRepository(storedSession);
    const fetchRequest = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(health))
      .mockResolvedValueOnce(jsonResponse(user));
    const service = createArchiveSessionService(fetchRequest, repository, () => "unused");

    await expect(service.restore()).resolves.toMatchObject({ status: "connected", user });
    expect(service.getActiveSession()).toEqual(storedSession);
  });

  it("removes stored secrets when restoration proves the token invalid", async () => {
    const repository = createRepository(storedSession);
    const fetchRequest = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(health))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    const service = createArchiveSessionService(fetchRequest, repository, () => "unused");

    await expect(service.restore()).resolves.toMatchObject({
      status: "disconnected",
      reason: "invalid-credentials",
    });
    expect(repository.clear).toHaveBeenCalledOnce();
  });

  it("resolves to the storage error when clearing a rejected credential fails", async () => {
    const repository = createRepository(storedSession);
    (repository.clear as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("keyring locked"),
    );
    const fetchRequest = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(health))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    const service = createArchiveSessionService(fetchRequest, repository, () => "unused");

    // Must resolve, not reject: the renderer awaits this over IPC, and a
    // rejection would leave it on the restoring screen forever.
    await expect(service.restore()).resolves.toMatchObject({
      status: "error",
      code: "secure-storage-unavailable",
    });
  });

  it("keeps stored secrets for retry when the server is unavailable", async () => {
    const repository = createRepository(storedSession);
    const service = createArchiveSessionService(
      vi.fn(async () => {
        throw new Error("network internals and secret details");
      }),
      repository,
      () => "unused",
    );

    const result = await service.restore();
    expect(result).toMatchObject({
      status: "unavailable",
      profile: {
        id: storedSession.profile.id,
        label: storedSession.profile.label,
        serverUrl: storedSession.profile.serverUrl,
      },
    });
    expect(JSON.stringify(result)).not.toContain("network internals");
    expect(repository.clear).not.toHaveBeenCalled();
  });

  it("turns request timeouts into a sanitized unreachable state", async () => {
    vi.useFakeTimers();
    const repository = createRepository();
    const fetchRequest = vi.fn((_input: string | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("timeout internals")));
      }),
    );
    const service = createArchiveSessionService(fetchRequest, repository, () => "id");

    const pending = service.connect({
      serverUrl: "https://archive.example.com",
      apiToken: "token",
    });
    await vi.advanceTimersByTimeAsync(12_001);
    await expect(pending).resolves.toMatchObject({ status: "error", code: "unreachable" });
  });

  it("fails closed when secure storage is unavailable and signs out destructively", async () => {
    const unavailable = createRepository();
    vi.mocked(unavailable.assertSecureStorageAvailable).mockRejectedValue(new Error("basic_text"));
    const service = createArchiveSessionService(vi.fn(), unavailable, () => "id");
    await expect(service.restore()).resolves.toMatchObject({
      status: "error",
      code: "secure-storage-unavailable",
    });

    const repository = createRepository(storedSession);
    const active = createArchiveSessionService(
      vi.fn().mockResolvedValueOnce(jsonResponse(health)).mockResolvedValueOnce(jsonResponse(user)),
      repository,
      () => "unused",
    );
    await active.restore();
    await expect(active.signOut()).resolves.toMatchObject({
      status: "disconnected",
      reason: "signed-out",
    });
    expect(repository.clear).toHaveBeenCalledOnce();
    expect(active.getActiveSession()).toBeNull();
  });
});
