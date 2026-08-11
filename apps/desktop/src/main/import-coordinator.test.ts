import { describe, expect, it, vi } from "vitest";
import type { DesktopImportBatch } from "../shared/desktop-api";
import { createDesktopImportCoordinator } from "./import-coordinator";

function batch(): DesktopImportBatch {
  return {
    id: "batch-one",
    source: "open-with",
    profileId: null,
    files: [
      {
        id: "file-one",
        name: "invoice.pdf",
        mimeType: "application/pdf",
        size: 42,
      },
    ],
    rejected: [],
  };
}

describe("desktop import coordinator", () => {
  it("automatically assigns open-with files when exactly one profile exists", async () => {
    const imports = {
      enqueuePaths: vi.fn(async () => batch()),
      listPending: vi.fn(() => []),
      assign: vi.fn((_batchId: string, profileId: string) => ({
        ...batch(),
        profileId,
      })),
      consume: vi.fn(),
      readPaths: vi.fn(),
    };
    const onChanged = vi.fn();
    const coordinator = createDesktopImportCoordinator({
      imports,
      listProfiles: async () => ({
        profiles: [
          { id: "profile-one", label: "Home", serverUrl: "https://home.test" },
        ],
        activeProfileId: "profile-one",
      }),
      onChanged,
    });

    await coordinator.receivePaths(["/incoming/invoice.pdf"]);

    expect(imports.assign).toHaveBeenCalledWith("batch-one", "profile-one");
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it("requires an explicit valid profile when several archives exist", async () => {
    const imports = {
      enqueuePaths: vi.fn(async () => batch()),
      listPending: vi.fn(() => [batch()]),
      assign: vi.fn((_batchId: string, profileId: string) => ({
        ...batch(),
        profileId,
      })),
      consume: vi.fn(),
      readPaths: vi.fn(),
    };
    const coordinator = createDesktopImportCoordinator({
      imports,
      listProfiles: async () => ({
        profiles: [
          { id: "profile-one", label: "Home", serverUrl: "https://home.test" },
          { id: "profile-two", label: "Work", serverUrl: "https://work.test" },
        ],
        activeProfileId: "profile-one",
      }),
      onChanged: vi.fn(),
    });

    await coordinator.receivePaths(["/incoming/invoice.pdf"]);
    expect(imports.assign).not.toHaveBeenCalled();

    await expect(
      coordinator.assign({ batchId: "batch-one", profileId: "unknown" }),
    ).rejects.toThrow("archive profile");
    await expect(
      coordinator.assign({ batchId: "batch-one", profileId: "profile-two" }),
    ).resolves.toMatchObject({ profileId: "profile-two" });
  });
});
