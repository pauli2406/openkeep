import { describe, expect, it, vi } from "vitest";
import {
  MACOS_DOCUMENT_TYPES,
  registerPackagedFileAssociations,
} from "./file-associations";

describe("desktop file associations", () => {
  it("declares every supported document UTI for packaged macOS apps", () => {
    expect(MACOS_DOCUMENT_TYPES[0]?.LSItemContentTypes).toEqual([
      "com.adobe.pdf",
      "public.jpeg",
      "public.png",
      "public.tiff",
      "public.heic",
    ]);
    expect(MACOS_DOCUMENT_TYPES[0]?.CFBundleTypeRole).toBe("Viewer");
  });

  it("registers fixed Windows Open With entries without a shell", async () => {
    const run = vi.fn(async () => undefined);
    await registerPackagedFileAssociations({
      platform: "win32",
      isPackaged: true,
      execPath: "C:\\Program Files\\OpenKeep\\OpenKeep.exe",
      applicationsDirectory: "unused",
      run,
      ensureDirectory: vi.fn(),
      writeText: vi.fn(),
    });

    expect(run).toHaveBeenCalledWith("reg.exe", [
      "ADD",
      "HKCU\\Software\\Classes\\OpenKeep.Document\\shell\\open\\command",
      "/ve",
      "/d",
      '"C:\\Program Files\\OpenKeep\\OpenKeep.exe" "%1"',
      "/f",
    ]);
    expect(run).toHaveBeenCalledTimes(8);
    expect(run.mock.calls.flat().join(" ")).not.toContain("cmd.exe");
  });

  it("writes a Linux desktop entry with supported MIME types and multi-file delivery", async () => {
    const writeText = vi.fn(async (_filePath: string, _contents: string) => undefined);
    const ensureDirectory = vi.fn(async (_directory: string) => undefined);
    await registerPackagedFileAssociations({
      platform: "linux",
      isPackaged: true,
      execPath: "/opt/Open Keep/openkeep",
      applicationsDirectory: "/home/user/.local/share/applications",
      run: vi.fn(async () => undefined),
      ensureDirectory,
      writeText,
    });

    expect(ensureDirectory).toHaveBeenCalledWith(
      "/home/user/.local/share/applications",
    );
    expect(writeText).toHaveBeenCalledWith(
      "/home/user/.local/share/applications/openkeep.desktop",
      expect.stringContaining('Exec="/opt/Open Keep/openkeep" %F'),
    );
    expect(writeText.mock.calls[0]?.[1]).toContain(
      "MimeType=application/pdf;image/jpeg;image/png;image/tiff;image/heic;",
    );
  });

  it("does not mutate associations from an unpackaged development process", async () => {
    const run = vi.fn();
    const writeText = vi.fn();
    await registerPackagedFileAssociations({
      platform: "linux",
      isPackaged: false,
      execPath: "/tmp/electron",
      applicationsDirectory: "/tmp/applications",
      run,
      ensureDirectory: vi.fn(),
      writeText,
    });
    expect(run).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
  });
});
