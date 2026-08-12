import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDesktopImportService,
  extractOpenWithPaths,
} from "./import-service";

const createdDirectories: string[] = [];

async function fixture(name: string, bytes: number[]) {
  const directory = await mkdtemp(path.join(tmpdir(), "openkeep-import-"));
  createdDirectories.push(directory);
  const filePath = path.join(directory, name);
  await writeFile(filePath, Buffer.from(bytes));
  return filePath;
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    createdDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("desktop import service", () => {
  it("validates supported files, deduplicates paths, and consumes bytes once", async () => {
    const pdf = await fixture("invoice.pdf", [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
    const service = createDesktopImportService({
      createId: (() => {
        let id = 0;
        return () => `id-${++id}`;
      })(),
      maxBytes: 64,
    });

    const batch = await service.enqueuePaths([pdf, pdf], "open-with");

    expect(batch).toMatchObject({
      id: "id-2",
      source: "open-with",
      profileId: null,
      files: [{ id: "id-1", name: "invoice.pdf", mimeType: "application/pdf" }],
      rejected: [],
    });

    service.assign(batch!.id, "profile-one");
    const delivery = await service.consume("profile-one");
    expect(delivery.files).toHaveLength(1);
    expect(Array.from(delivery.files[0]!.bytes)).toEqual([
      0x25, 0x50, 0x44, 0x46, 0x2d, 0x31,
    ]);
    expect(await service.consume("profile-one")).toEqual({ files: [], rejected: [] });
  });

  it("rejects missing, unsupported, oversized, and disguised files without exposing paths", async () => {
    const unsupported = await fixture("notes.txt", [0x74, 0x65, 0x78, 0x74]);
    const oversized = await fixture("large.pdf", [
      0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x00,
    ]);
    const disguised = await fixture("photo.png", [0x25, 0x50, 0x44, 0x46]);
    const missing = path.join(path.dirname(unsupported), "private-name.pdf");
    const service = createDesktopImportService({
      createId: (() => {
        let id = 0;
        return () => `reject-${++id}`;
      })(),
      maxBytes: 6,
    });

    const batch = await service.enqueuePaths(
      [unsupported, oversized, disguised, missing],
      "open-with",
    );

    expect(batch?.files).toEqual([]);
    expect(batch?.rejected.map(({ name, code }) => ({ name, code }))).toEqual([
      { name: "notes.txt", code: "unsupported-format" },
      { name: "large.pdf", code: "oversized" },
      { name: "photo.png", code: "invalid-format" },
      { name: "private-name.pdf", code: "inaccessible" },
    ]);
    expect(JSON.stringify(batch)).not.toContain(path.dirname(unsupported));
  });

  it("keeps batches isolated until an explicit profile assignment", async () => {
    const png = await fixture("scan.png", [
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    const service = createDesktopImportService({
      createId: () => crypto.randomUUID(),
      maxBytes: 64,
    });
    const batch = await service.enqueuePaths([png], "open-with");

    expect(service.listPending("profile-one")).toHaveLength(1);
    expect(await service.consume("profile-one")).toEqual({ files: [], rejected: [] });

    service.assign(batch!.id, "profile-two");
    expect(service.listPending("profile-one")).toHaveLength(0);
    expect(service.listPending("profile-two")).toHaveLength(1);
    expect((await service.consume("profile-two")).files).toHaveLength(1);
  });

  it("extracts file arguments without treating Chromium flags or the app entry as files", () => {
    expect(
      extractOpenWithPaths(
        [
          "/Applications/OpenKeep",
          "--original-process-start-time=42",
          "relative/invoice.pdf",
          "/tmp/scan.png",
        ],
        "/incoming",
        false,
      ),
    ).toEqual(["/incoming/relative/invoice.pdf", "/tmp/scan.png"]);

    expect(
      extractOpenWithPaths(
        ["/path/to/electron", ".", "invoice.pdf"],
        "/workspace/app",
        true,
      ),
    ).toEqual(["/workspace/app/invoice.pdf"]);
  });
});
