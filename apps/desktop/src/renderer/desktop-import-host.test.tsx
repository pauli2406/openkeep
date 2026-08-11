import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type {
  DesktopBridge,
  DesktopImportBatch,
  DesktopProfileSummary,
  DesktopSessionState,
} from "../shared/desktop-api";
import { DesktopImportHost } from "./desktop-import-host";

const home: DesktopProfileSummary = {
  id: "profile-home",
  label: "Home",
  serverUrl: "https://home.test",
};
const work: DesktopProfileSummary = {
  id: "profile-work",
  label: "Work",
  serverUrl: "https://work.test",
};

function incoming(profileId: string | null = null): DesktopImportBatch {
  return {
    id: "batch-one",
    source: "open-with",
    profileId,
    files: [
      {
        id: "file-one",
        name: "invoice.pdf",
        mimeType: "application/pdf",
        size: 6,
      },
    ],
    rejected: [],
  };
}

function connected(profile: DesktopProfileSummary): DesktopSessionState {
  return {
    status: "connected",
    profile,
    user: {
      id: "user-one",
      email: "owner@example.test",
      displayName: "Owner",
      isOwner: true,
      twoFactorEnabled: false,
      preferences: {
        uiLanguage: "en",
        aiProcessingLanguage: "en",
        aiChatLanguage: "en",
      },
      createdAt: "2026-08-11T00:00:00.000Z",
    },
  };
}

function bridge({
  profiles,
  pending,
}: {
  profiles: DesktopProfileSummary[];
  pending: DesktopBridge["imports"]["pending"];
}): DesktopBridge {
  return {
    session: {
      restore: async () => connected(home),
      connect: async () => connected(home),
      retry: async () => connected(home),
      signOut: async () => ({ status: "disconnected", reason: "signed-out" }),
    },
    profiles: {
      list: vi.fn(async () => ({ profiles, activeProfileId: home.id })),
      activate: vi.fn(async ({ profileId }) =>
        connected(profiles.find((profile) => profile.id === profileId)!),
      ),
      rename: vi.fn(async () => ({ profiles, activeProfileId: home.id })),
      remove: vi.fn(async (): Promise<DesktopSessionState> => ({
        status: "disconnected",
        reason: "no-profile",
      })),
    },
    imports: {
      pick: vi.fn(async () => ({ files: [], rejected: [] })),
      pending,
      assign: vi.fn(async ({ batchId, profileId }) => ({
        ...incoming(profileId),
        id: batchId,
      })),
      consume: vi.fn(async () => ({
        files: [
          {
            ...incoming(home.id).files[0]!,
            bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]),
          },
        ],
        rejected: [],
      })),
      onChanged: vi.fn(() => () => undefined),
    },
    save: {
      request: vi.fn(async () => ({ status: "cancelled" as const })),
    },
    lifecycle: {
      getSettings: vi.fn(async () => ({ closeBehavior: "tray" as const, trayAvailable: true })),
      setCloseBehavior: vi.fn(),
    },
    runtime: {
      getInfo: async () => ({ platform: "darwin", version: "test" }),
    },
  };
}

describe("desktop open-with host", () => {
  it("asks for an archive and assigns the batch before switching profiles", async () => {
    const desktop = bridge({
      profiles: [home, work],
      pending: vi.fn(async () => ({ batches: [incoming()] })),
    });

    render(
      <DesktopImportHost
        activeProfile={home}
        bridge={desktop}
        pipeline={{ publish: vi.fn() }}
        navigateToImport={vi.fn()}
      >
        <main>Archive</main>
      </DesktopImportHost>,
    );

    expect(await screen.findByRole("heading", { name: "Choose an archive" })).toBeInTheDocument();
    expect(screen.getByText("invoice.pdf")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /work.*switch & import/i }));

    expect(desktop.imports.assign).toHaveBeenCalledWith({
      batchId: "batch-one",
      profileId: work.id,
    });
    expect(desktop.profiles.activate).toHaveBeenCalledWith({ profileId: work.id });
  });

  it("auto-assigns a sole profile and publishes the delivery on the import route", async () => {
    window.history.replaceState({}, "", "/upload");
    const pending = vi
      .fn<DesktopBridge["imports"]["pending"]>()
      .mockResolvedValueOnce({ batches: [incoming()] })
      .mockResolvedValueOnce({ batches: [incoming(home.id)] });
    const desktop = bridge({ profiles: [home], pending });
    const publish = vi.fn();

    render(
      <DesktopImportHost
        activeProfile={home}
        bridge={desktop}
        pipeline={{ publish }}
        navigateToImport={vi.fn()}
      >
        <main>Archive</main>
      </DesktopImportHost>,
    );

    await waitFor(() => expect(desktop.imports.consume).toHaveBeenCalledOnce());
    expect(desktop.imports.assign).toHaveBeenCalledWith({
      batchId: "batch-one",
      profileId: home.id,
    });
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ files: [expect.objectContaining({ name: "invoice.pdf" })] }),
    );
  });
});
