import { describe, expect, it, vi } from "vitest";
import { createWatchFolderUploader } from "./watch-folder-uploader";
import type { DesktopFetch } from "./connection";
import type { ArchiveSessionService } from "./archive-session";
import type { DesktopImportDelivery } from "../shared/desktop-api";

const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);

function activeSession(profileId = "home") {
  return {
    profile: {
      id: profileId,
      label: "Home",
      serverUrl: "https://archive.example.com",
    },
    credentials: {
      apiToken: "secret-token",
      cfAccessClientId: "cf-id",
      cfAccessClientSecret: "cf-secret",
    },
    signal: new AbortController().signal,
  };
}

function createHarness(options: {
  delivery?: DesktopImportDelivery;
  session?: ReturnType<typeof activeSession> | null;
  respond?: () => Promise<Response>;
}) {
  const readPaths = vi.fn(
    async (): Promise<DesktopImportDelivery> =>
      options.delivery ?? {
        files: [
          { id: "file-1", name: "invoice.pdf", mimeType: "application/pdf", size: bytes.length, bytes },
        ],
        rejected: [],
      },
  );
  const respond =
    options.respond ??
    (async () =>
      new Response(JSON.stringify({ id: "doc-1", duplicateOf: null }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }));
  const fetchRequest = vi.fn<DesktopFetch>(async () => respond());
  const uploader = createWatchFolderUploader({
    imports: { readPaths },
    archiveSession: {
      getActiveSession: () =>
        (options.session === undefined
          ? activeSession()
          : options.session) as ReturnType<
          ArchiveSessionService["getActiveSession"]
        >,
    },
    fetchRequest,
  });
  return { uploader, fetchRequest, readPaths };
}

function upload(
  harness: ReturnType<typeof createHarness>,
  isKnownChecksum: (checksum: string) => boolean = () => false,
) {
  return harness.uploader.upload({
    filePath: "/Users/keeper/Scans/invoice.pdf",
    profileId: "home",
    isKnownChecksum,
  });
}

describe("watch folder uploader", () => {
  it("posts validated bytes to the active archive as a normal document", async () => {
    const harness = createHarness({});
    const result = await upload(harness);

    expect(result).toMatchObject({ status: "imported" });
    const [url, init] = harness.fetchRequest.mock.calls[0]!;
    expect(url).toBe("https://archive.example.com/api/documents");
    expect(init!.method).toBe("POST");
    const headers = init!.headers as Headers;
    expect(headers.get("authorization")).toBe("Bearer secret-token");
    expect(headers.get("cf-access-client-id")).toBe("cf-id");
    expect(init!.body).toBeInstanceOf(FormData);
    expect((init!.body as FormData).get("file")).toBeInstanceOf(File);
  });

  it("does not send content this archive already imported", async () => {
    const harness = createHarness({});
    const first = await upload(harness);
    expect(first.status).toBe("imported");
    const checksum = "checksum" in first ? first.checksum : "";

    const second = await upload(harness, (candidate) => candidate === checksum);
    expect(second).toMatchObject({ status: "duplicate" });
    expect(harness.fetchRequest).toHaveBeenCalledOnce();
  });

  it("reports the archive's own duplicate answer as a duplicate", async () => {
    const harness = createHarness({
      respond: async () =>
        new Response(
          JSON.stringify({ id: "doc-2", duplicateOf: { id: "doc-1" } }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
    });
    await expect(upload(harness)).resolves.toMatchObject({ status: "duplicate" });
  });

  it("waits for the archive rather than failing when it is not connected", async () => {
    const harness = createHarness({ session: null });
    await expect(upload(harness)).resolves.toMatchObject({ status: "retry" });
    expect(harness.fetchRequest).not.toHaveBeenCalled();
  });

  it("retries a server error and abandons a rejected request", async () => {
    const serverError = createHarness({
      respond: async () => new Response("boom", { status: 503 }),
    });
    await expect(upload(serverError)).resolves.toMatchObject({ status: "retry" });

    const rejected = createHarness({
      respond: async () => new Response("nope", { status: 415 }),
    });
    await expect(upload(rejected)).resolves.toMatchObject({ status: "rejected" });

    const throttled = createHarness({
      respond: async () => new Response("slow down", { status: 429 }),
    });
    await expect(upload(throttled)).resolves.toMatchObject({ status: "retry" });
  });

  it("retries an unreachable archive", async () => {
    const harness = createHarness({
      respond: async () => {
        throw new Error("network down");
      },
    });
    await expect(upload(harness)).resolves.toMatchObject({ status: "retry" });
  });

  it("separates a file that is still locked from one that can never be imported", async () => {
    const locked = createHarness({
      delivery: {
        files: [],
        rejected: [
          {
            id: "r1",
            name: "invoice.pdf",
            code: "inaccessible",
            message: "The file is missing, inaccessible, or is not a regular file.",
          },
        ],
      },
    });
    await expect(upload(locked)).resolves.toMatchObject({ status: "retry" });

    const wrongFormat = createHarness({
      delivery: {
        files: [],
        rejected: [
          {
            id: "r2",
            name: "invoice.pdf",
            code: "invalid-format",
            message: "The file contents do not match the filename extension.",
          },
        ],
      },
    });
    await expect(upload(wrongFormat)).resolves.toMatchObject({
      status: "rejected",
    });
  });

  it("treats a successful upload with an unreadable body as imported", async () => {
    const harness = createHarness({
      respond: async () => new Response("not json", { status: 201 }),
    });
    await expect(upload(harness)).resolves.toMatchObject({ status: "imported" });
  });
});
