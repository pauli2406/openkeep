import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createNativeSaveService,
  type NativeSaveDialogResult,
} from "./native-save";

const profileId = "11111111-1111-4111-8111-111111111111";
const documentId = "22222222-2222-4222-8222-222222222222";

describe("native save", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "openkeep-native-save-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  function createHarness(responses: Response[]) {
    const abortController = new AbortController();
    const fetchRequest = vi.fn(async (_input: string | Request, _init?: RequestInit) => {
      const response = responses.shift();
      if (!response) throw new Error("Missing response fixture");
      return response;
    });
    const showSaveDialog = vi.fn(
      async (options: { suggestedFilename: string }): Promise<NativeSaveDialogResult> => ({
        cancelled: false,
        filePath: path.join(directory, options.suggestedFilename),
      }),
    );
    const archiveSession = {
      getActiveSession: vi.fn(() => ({
        profile: {
          id: profileId,
          label: "Home",
          serverUrl: "https://archive.example.com",
          allowInsecureHttp: false,
        },
        credentials: {
          apiToken: "api-token",
          cfAccessClientId: "access-id",
          cfAccessClientSecret: "access-secret",
        },
        signal: abortController.signal,
      })),
    };
    return {
      service: createNativeSaveService({
        archiveSession,
        fetchRequest,
        showSaveDialog,
      }),
      fetchRequest,
      showSaveDialog,
      archiveSession,
    };
  }

  it.each([
    {
      label: "original document",
      request: { kind: "document-original" as const, documentId },
      endpoint: `/api/documents/${documentId}/download`,
      disposition: 'attachment; filename="invoice.pdf"',
      mimeType: "application/pdf",
      filename: "invoice.pdf",
      bytes: new Uint8Array([0, 1, 2, 127, 255]),
    },
    {
      label: "searchable PDF",
      request: { kind: "document-searchable" as const, documentId },
      endpoint: `/api/documents/${documentId}/download/searchable`,
      disposition: 'attachment; filename="invoice.unsafe"',
      mimeType: "application/pdf",
      filename: "invoice.pdf",
      bytes: new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]),
    },
    {
      label: "archive export",
      request: { kind: "archive-export" as const },
      endpoint: "/api/archive/export",
      disposition: null,
      mimeType: "application/json",
      filename: "openkeep-archive-export.json",
      bytes: new TextEncoder().encode('{"documents":[{"id":"one"}]}'),
    },
  ])("writes $label byte-for-byte through the native workflow", async (fixture) => {
    const headers = new Headers({ "content-type": fixture.mimeType });
    if (fixture.disposition) {
      headers.set("content-disposition", fixture.disposition);
    }
    const harness = createHarness([
      new Response(fixture.bytes, { status: 200, headers }),
    ]);

    await expect(harness.service.save(profileId, fixture.request)).resolves.toEqual({
      status: "saved",
    });
    await expect(readFile(path.join(directory, fixture.filename))).resolves.toEqual(
      Buffer.from(fixture.bytes),
    );
    expect(harness.showSaveDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        suggestedFilename: fixture.filename,
        mimeType: fixture.mimeType,
      }),
    );
    expect(harness.fetchRequest).toHaveBeenCalledWith(
      `https://archive.example.com${fixture.endpoint}`,
      expect.objectContaining({ method: "GET", redirect: "manual" }),
    );
    const init = harness.fetchRequest.mock.calls[0]![1] as RequestInit;
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer api-token");
    expect(new Headers(init.headers).get("cf-access-client-id")).toBe("access-id");
  });

  it.each([
    {
      disposition: 'attachment; filename="../../payroll?.pdf"',
      expected: "_.._.._payroll_.pdf",
    },
    {
      disposition: 'attachment; filename="CON.pdf"',
      expected: "_CON.pdf",
    },
    {
      disposition:
        "attachment; filename=plain.pdf; filename*=UTF-8''Gutschein%20%C3%BCber%20100%E2%82%AC.pdf",
      expected: "Gutschein über 100€.pdf",
    },
  ])("sanitizes a server filename as $expected", async (fixture) => {
    const harness = createHarness([
      new Response(new Uint8Array([1]), {
        headers: {
          "content-type": "application/pdf",
          "content-disposition": fixture.disposition,
        },
      }),
    ]);

    await harness.service.save(profileId, {
      kind: "document-original",
      documentId,
    });

    expect(harness.showSaveDialog).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedFilename: fixture.expected }),
    );
  });

  it("treats dialog cancellation as a normal no-op and cancels the response", async () => {
    let bodyCancelled = false;
    const response = new Response(
      new ReadableStream({
        pull(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
        },
        cancel() {
          bodyCancelled = true;
        },
      }),
      { headers: { "content-type": "application/pdf" } },
    );
    const harness = createHarness([response]);
    harness.showSaveDialog.mockResolvedValueOnce({ cancelled: true });

    await expect(
      harness.service.save(profileId, { kind: "document-original", documentId }),
    ).resolves.toEqual({ status: "cancelled" });
    expect(bodyCancelled).toBe(true);
    await expect(readdir(directory)).resolves.toEqual([]);
  });

  it("replaces a confirmed destination only after the complete response is durable", async () => {
    const destination = path.join(directory, "invoice.pdf");
    await writeFile(destination, "old bytes");
    const nextBytes = new Uint8Array([9, 8, 7, 6, 5]);
    const harness = createHarness([
      new Response(nextBytes, {
        headers: {
          "content-type": "application/pdf",
          "content-disposition": 'attachment; filename="invoice.pdf"',
        },
      }),
    ]);

    await expect(
      harness.service.save(profileId, { kind: "document-original", documentId }),
    ).resolves.toEqual({ status: "saved" });
    await expect(readFile(destination)).resolves.toEqual(Buffer.from(nextBytes));
    expect((await readdir(directory)).filter((name) => name.endsWith(".part"))).toEqual([]);
  });

  it("removes partial files and returns a sanitized error when a stream fails", async () => {
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          controller.error(new Error(`/private/secret/${profileId}`));
        },
      }),
      {
        headers: {
          "content-type": "application/pdf",
          "content-disposition": 'attachment; filename="partial.pdf"',
        },
      },
    );
    const harness = createHarness([response]);

    const result = await harness.service.save(profileId, {
      kind: "document-original",
      documentId,
    });

    expect(result).toEqual({
      status: "failed",
      message:
        "OpenKeep could not write the selected file. Check the destination and its permissions, then try again.",
    });
    expect(JSON.stringify(result)).not.toContain("/private/secret");
    await expect(readdir(directory)).resolves.toEqual([]);
  });

  it("reports filesystem failures without exposing the selected path", async () => {
    const harness = createHarness([
      new Response(new Uint8Array([1]), {
        headers: { "content-type": "application/pdf" },
      }),
    ]);
    const secretPath = path.join(directory, "missing", "private.pdf");
    harness.showSaveDialog.mockResolvedValueOnce({
      cancelled: false,
      filePath: secretPath,
    });

    const result = await harness.service.save(profileId, {
      kind: "document-original",
      documentId,
    });

    expect(result.status).toBe("failed");
    expect(JSON.stringify(result)).not.toContain(secretPath);
    await expect(readdir(directory)).resolves.toEqual([]);
  });

  it("rejects malformed and cross-profile requests before network or dialog access", async () => {
    const harness = createHarness([]);

    await expect(
      harness.service.save(profileId, {
        kind: "document-original",
        documentId: "../../credentials",
        filePath: "/tmp/owned",
      }),
    ).resolves.toMatchObject({ status: "failed" });
    await expect(
      harness.service.save(profileId, {
        kind: "archive-export",
        filePath: "/tmp/owned",
      }),
    ).resolves.toMatchObject({ status: "failed" });
    await expect(
      harness.service.save("33333333-3333-4333-8333-333333333333", {
        kind: "archive-export",
      }),
    ).resolves.toMatchObject({ status: "failed" });
    expect(harness.fetchRequest).not.toHaveBeenCalled();
    expect(harness.showSaveDialog).not.toHaveBeenCalled();
  });
});
