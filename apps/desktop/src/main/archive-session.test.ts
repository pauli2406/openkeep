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

function createRepository(
  stored: StoredArchiveSession | StoredArchiveSession[] | null = null,
  initialActiveProfileId?: string | null,
) {
  const profiles = new Map<string, StoredArchiveSession>();
  const storedProfiles = stored
    ? Array.isArray(stored)
      ? stored
      : [stored]
    : [];
  for (const entry of storedProfiles) {
    profiles.set(entry.profile.id, entry);
  }
  let lastActiveProfileId =
    initialActiveProfileId === undefined
      ? storedProfiles[0]?.profile.id ?? null
      : initialActiveProfileId;
  const repository: ArchiveProfileRepository = {
    assertSecureStorageAvailable: vi.fn(async () => {}),
    snapshot: vi.fn(async () => ({
      profiles: [...profiles.values()].map((entry) => entry.profile),
      lastActiveProfileId,
    })),
    load: vi.fn(async (profileId) => profiles.get(profileId) ?? null),
    save: vi.fn(async (next) => {
      profiles.set(next.profile.id, next);
      lastActiveProfileId = next.profile.id;
    }),
    setActive: vi.fn(async (profileId) => {
      if (!profiles.has(profileId)) {
        throw new Error("missing profile");
      }
      lastActiveProfileId = profileId;
    }),
    rename: vi.fn(async (profileId, label) => {
      const current = profiles.get(profileId);
      if (!current) {
        throw new Error("missing profile");
      }
      const profile = { ...current.profile, label };
      profiles.set(profileId, { ...current, profile });
      return profile;
    }),
    remove: vi.fn(async (profileId) => {
      profiles.delete(profileId);
      if (lastActiveProfileId === profileId) {
        lastActiveProfileId = [...profiles.keys()][0] ?? null;
      }
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

function siblingSession(
  id: string,
  label: string,
  serverUrl: string,
): StoredArchiveSession {
  return {
    profile: { id, label, serverUrl, allowInsecureHttp: false },
    credentials: { apiToken: `${label}-token` },
  };
}

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
    expect(repository.save).toHaveBeenCalledOnce();
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
    expect(repository.save).not.toHaveBeenCalled();
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

  it("edits a profile by stable ID while allowing a separate archive to be added", async () => {
    const repository = createRepository(storedSession);
    const service = createArchiveSessionService(
      vi.fn()
        .mockResolvedValueOnce(jsonResponse(health))
        .mockResolvedValueOnce(jsonResponse(user))
        .mockResolvedValueOnce(jsonResponse(health))
        .mockResolvedValueOnce(jsonResponse(user)),
      repository,
      () => "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    );

    await expect(
      service.connect({
        profileId: storedSession.profile.id,
        serverUrl: "https://replacement.example.com",
        apiToken: "replacement-token",
      }),
    ).resolves.toMatchObject({
      status: "connected",
      profile: { id: storedSession.profile.id },
    });
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: expect.objectContaining({ id: storedSession.profile.id }),
      }),
    );

    await expect(
      service.connect({
        serverUrl: "https://replacement.example.com",
        apiToken: "second-token",
      }),
    ).resolves.toMatchObject({
      status: "connected",
      profile: { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
    });
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
    expect(service.getActiveSession()).toMatchObject(storedSession);
  });

  it("restores the last active profile when multiple archives exist", async () => {
    const work = siblingSession(
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      "Work",
      "https://work.example.com",
    );
    const repository = createRepository(
      [storedSession, work],
      work.profile.id,
    );
    const service = createArchiveSessionService(
      vi.fn()
        .mockResolvedValueOnce(jsonResponse(health))
        .mockResolvedValueOnce(jsonResponse(user)),
      repository,
      () => "unused",
    );

    await expect(service.restore()).resolves.toMatchObject({
      status: "connected",
      profile: { id: work.profile.id },
    });
    expect(repository.load).toHaveBeenCalledWith(work.profile.id);
  });

  it("aborts the previous profile transport before activating another archive", async () => {
    const work = siblingSession(
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      "Work",
      "https://work.example.com",
    );
    const repository = createRepository([storedSession, work]);
    const fetchRequest = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(health))
      .mockResolvedValueOnce(jsonResponse(user))
      .mockResolvedValueOnce(jsonResponse(health))
      .mockResolvedValueOnce(jsonResponse(user));
    const service = createArchiveSessionService(fetchRequest, repository, () => "unused");

    await service.restore();
    const previousSignal = service.getActiveSession()!.signal;
    await expect(service.activate(work.profile.id)).resolves.toMatchObject({
      status: "connected",
      profile: { id: work.profile.id },
    });

    expect(previousSignal.aborted).toBe(true);
    expect(service.getActiveSession()?.profile.id).toBe(work.profile.id);
  });

  it("removes only a failing profile and keeps the current archive available", async () => {
    const rejected = siblingSession(
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      "Rejected",
      "https://rejected.example.com",
    );
    const repository = createRepository([storedSession, rejected]);
    const fetchRequest = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(health))
      .mockResolvedValueOnce(jsonResponse(user))
      .mockResolvedValueOnce(jsonResponse(health))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    const service = createArchiveSessionService(fetchRequest, repository, () => "unused");

    await service.restore();
    await expect(service.activate(rejected.profile.id)).resolves.toMatchObject({
      status: "disconnected",
      reason: "invalid-credentials",
    });

    expect(repository.remove).toHaveBeenCalledWith(rejected.profile.id);
    expect(repository.remove).not.toHaveBeenCalledWith(storedSession.profile.id);
    expect(service.getActiveSession()?.profile.id).toBe(storedSession.profile.id);
  });

  it("prevents a superseded profile check from winning a concurrent switch", async () => {
    const slow = siblingSession(
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      "Slow",
      "https://slow.example.com",
    );
    const fast = siblingSession(
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      "Fast",
      "https://fast.example.com",
    );
    const repository = createRepository([slow, fast], null);
    const fetchRequest = vi.fn((input: string | Request, init?: RequestInit) => {
      if (String(input).includes("slow.example.com")) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        });
      }
      return Promise.resolve(
        String(input).endsWith("/api/health")
          ? jsonResponse(health)
          : jsonResponse(user),
      );
    });
    const service = createArchiveSessionService(fetchRequest, repository, () => "unused");

    const slowActivation = service.activate(slow.profile.id);
    await Promise.resolve();
    const fastActivation = service.activate(fast.profile.id);

    await expect(fastActivation).resolves.toMatchObject({
      status: "connected",
      profile: { id: fast.profile.id },
    });
    await expect(slowActivation).resolves.toMatchObject({
      status: "disconnected",
      reason: "superseded",
    });
    expect(service.getActiveSession()?.profile.id).toBe(fast.profile.id);
    expect(repository.setActive).toHaveBeenCalledTimes(1);
    expect(repository.setActive).toHaveBeenCalledWith(fast.profile.id);
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
    expect(repository.remove).toHaveBeenCalledWith(storedSession.profile.id);
  });

  it("resolves to the storage error when removing a rejected credential fails", async () => {
    const repository = createRepository(storedSession);
    (repository.remove as ReturnType<typeof vi.fn>).mockRejectedValue(
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
    expect(repository.remove).not.toHaveBeenCalled();
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
    expect(repository.remove).toHaveBeenCalledWith(storedSession.profile.id);
    expect(active.getActiveSession()).toBeNull();
  });

  it("aborts active archive work without deleting the profile during process cleanup", async () => {
    const repository = createRepository(storedSession);
    const service = createArchiveSessionService(
      vi.fn().mockResolvedValueOnce(jsonResponse(health)).mockResolvedValueOnce(jsonResponse(user)),
      repository,
      () => "unused",
    );
    await service.restore();
    const signal = service.getActiveSession()!.signal;

    service.dispose();

    expect(signal.aborted).toBe(true);
    expect(service.getActiveSession()).toBeNull();
    expect(repository.remove).not.toHaveBeenCalled();
  });
});
