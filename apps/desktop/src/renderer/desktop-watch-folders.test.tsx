import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DesktopWatchFolders } from "./desktop-watch-folders";
import type {
  DesktopBridge,
  DesktopWatchFolder,
  DesktopWatchFoldersSnapshot,
} from "../shared/desktop-api";

function folder(overrides: Partial<DesktopWatchFolder> = {}): DesktopWatchFolder {
  return {
    id: "folder-1",
    path: "/Users/keeper/Scans",
    label: "Scans",
    state: "watching",
    counts: { imported: 3, duplicate: 1, failed: 0 },
    history: [
      {
        id: "event-1",
        name: "invoice.pdf",
        outcome: "imported",
        at: Date.parse("2026-08-11T10:00:00.000Z"),
      },
      {
        id: "event-2",
        name: "huge.pdf",
        outcome: "failed",
        message: "The file exceeds the desktop import limit of 64 MiB.",
        at: Date.parse("2026-08-11T09:00:00.000Z"),
      },
    ],
    ...overrides,
  };
}

function createBridge(snapshot: DesktopWatchFoldersSnapshot) {
  const listeners = new Set<() => void>();
  const bridge: Pick<DesktopBridge, "watchFolders"> = {
    watchFolders: {
      list: vi.fn(async () => snapshot),
      add: vi.fn(async () => ({ status: "cancelled" as const })),
      setPaused: vi.fn(async ({ folderId, paused }) => ({
        ...snapshot,
        folders: snapshot.folders.map((entry) =>
          entry.id === folderId
            ? { ...entry, state: paused ? ("paused" as const) : ("watching" as const) }
            : entry,
        ),
      })),
      remove: vi.fn(async () => ({ ...snapshot, folders: [] })),
      onChanged: vi.fn((listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }),
    },
  };
  return { bridge, listeners };
}

async function openPanel(bridge: Pick<DesktopBridge, "watchFolders">) {
  render(<DesktopWatchFolders bridge={bridge} />);
  await userEvent.click(screen.getByRole("button", { name: "Watch folders" }));
}

describe("desktop watch folders", () => {
  it("shows each folder with its state, counts, and inspectable history", async () => {
    const { bridge } = createBridge({ profileId: "home", folders: [folder()] });
    await openPanel(bridge);

    expect(screen.getByText("Scans")).toBeInTheDocument();
    expect(screen.getByText("/Users/keeper/Scans")).toBeInTheDocument();
    expect(screen.getByText("Watching")).toBeInTheDocument();
    expect(screen.getByText("3 imported")).toBeInTheDocument();
    expect(screen.getByText("1 already filed")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "History" }));
    const history = screen.getByRole("list", { name: "Recent activity in Scans" });
    expect(history).toHaveTextContent("invoice.pdf");
    expect(history).toHaveTextContent("Imported");
    expect(history).toHaveTextContent("huge.pdf");
    expect(history).toHaveTextContent("64 MiB");
  });

  it("pauses and resumes one folder", async () => {
    const { bridge } = createBridge({ profileId: "home", folders: [folder()] });
    await openPanel(bridge);

    await userEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(bridge.watchFolders.setPaused).toHaveBeenCalledWith({
      folderId: "folder-1",
      paused: true,
    });
    await screen.findByText("Paused");

    await userEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(bridge.watchFolders.setPaused).toHaveBeenLastCalledWith({
      folderId: "folder-1",
      paused: false,
    });
  });

  it("stops watching a folder without touching its files", async () => {
    const { bridge } = createBridge({ profileId: "home", folders: [folder()] });
    await openPanel(bridge);

    await userEvent.click(screen.getByRole("button", { name: "Stop watching" }));
    expect(bridge.watchFolders.remove).toHaveBeenCalledWith({
      folderId: "folder-1",
    });
    await waitFor(() => {
      expect(screen.queryByText("Scans")).not.toBeInTheDocument();
    });
  });

  it("explains a folder that cannot be read and one waiting for its archive", async () => {
    const { bridge } = createBridge({
      profileId: "home",
      folders: [
        folder({
          id: "folder-missing",
          label: "Stick",
          path: "/Volumes/Stick/Scans",
          state: "missing",
          message: "This folder no longer exists on this computer.",
        }),
        folder({ id: "folder-waiting", label: "Inbox", state: "waiting" }),
      ],
    });
    await openPanel(bridge);

    expect(screen.getByText("Folder missing")).toBeInTheDocument();
    expect(
      screen.getByText("This folder no longer exists on this computer."),
    ).toBeInTheDocument();
    expect(screen.getByText("Waiting for the archive")).toBeInTheDocument();
  });

  it("reloads when main reports imported files", async () => {
    const { bridge, listeners } = createBridge({
      profileId: "home",
      folders: [folder()],
    });
    await openPanel(bridge);
    expect(bridge.watchFolders.list).toHaveBeenCalledTimes(1);

    listeners.forEach((listener) => listener());
    await waitFor(() => {
      expect(bridge.watchFolders.list).toHaveBeenCalledTimes(2);
    });
  });

  it("surfaces a folder that could not be added", async () => {
    const { bridge } = createBridge({ profileId: "home", folders: [] });
    bridge.watchFolders.add = vi.fn(async () => ({
      status: "failed" as const,
      message: "Connect an archive before adding a watch folder.",
    }));
    await openPanel(bridge);

    await userEvent.click(screen.getByRole("button", { name: "Add folder…" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Connect an archive before adding a watch folder.",
    );
  });
});
