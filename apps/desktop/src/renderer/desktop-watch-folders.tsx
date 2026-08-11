import { useCallback, useEffect, useId, useRef, useState } from "react";
import type {
  DesktopBridge,
  DesktopWatchFolder,
  DesktopWatchFolderEvent,
  DesktopWatchFoldersSnapshot,
} from "../shared/desktop-api";

function FolderGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.5 6.5h6l2 2.5h9v9.5h-17z" />
      <path d="M3.5 6.5v-1.5h5l1.5 1.5" />
    </svg>
  );
}

const STATE_LABELS: Record<DesktopWatchFolder["state"], string> = {
  watching: "Watching",
  paused: "Paused",
  waiting: "Waiting for the archive",
  missing: "Folder missing",
  unreadable: "Cannot read folder",
};

const OUTCOME_LABELS: Record<DesktopWatchFolderEvent["outcome"], string> = {
  imported: "Imported",
  duplicate: "Already filed",
  retrying: "Retrying",
  failed: "Failed",
  unsupported: "Not a document",
};

function formatTime(at: number) {
  return new Date(at).toLocaleString();
}

export function DesktopWatchFolders({
  bridge = window.openkeepDesktop,
}: {
  bridge?: Pick<DesktopBridge, "watchFolders">;
}) {
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<DesktopWatchFoldersSnapshot | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await bridge.watchFolders.list());
    } catch {
      setMessage("Watch folders could not be loaded.");
    }
  }, [bridge]);

  useEffect(() => {
    void refresh();
    return bridge.watchFolders.onChanged(() => void refresh());
  }, [bridge, refresh]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function run(operation: () => Promise<DesktopWatchFoldersSnapshot>) {
    setBusy(true);
    setMessage("");
    try {
      setSnapshot(await operation());
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "That change could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function addFolder() {
    setBusy(true);
    setMessage("");
    try {
      const result = await bridge.watchFolders.add();
      if (result.status === "added") setSnapshot(result.snapshot);
      if (result.status === "failed") setMessage(result.message);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "That folder could not be watched.",
      );
    } finally {
      setBusy(false);
    }
  }

  const folders = snapshot?.folders ?? [];
  const active = folders.filter((folder) => folder.state === "watching").length;

  return (
    <div className="desktop-watch-folders" ref={rootRef}>
      <button
        type="button"
        className="desktop-watch-folders__trigger"
        aria-label="Watch folders"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        <FolderGlyph />
        {folders.length > 0 ? (
          <span className="desktop-watch-folders__badge">{folders.length}</span>
        ) : null}
      </button>
      {open ? (
        <section
          id={panelId}
          className="desktop-watch-folders__panel"
          aria-label="Watch folders"
        >
          <header>
            <span>Watch folders</span>
            <strong>
              {folders.length === 0
                ? "None"
                : `${active}/${folders.length} watching`}
            </strong>
          </header>
          <p className="desktop-watch-folders__hint">
            OpenKeep imports new PDF, JPEG, PNG, TIFF, and HEIC files from these
            folders on this computer into this archive, and never changes or
            removes the originals.
          </p>
          <ul className="desktop-watch-folders__list">
            {folders.map((folder) => (
              <li key={folder.id} data-state={folder.state}>
                <div className="desktop-watch-folders__row">
                  <span className="desktop-watch-folders__identity">
                    <strong>{folder.label}</strong>
                    <small title={folder.path}>{folder.path}</small>
                  </span>
                  <span className="desktop-watch-folders__state">
                    {STATE_LABELS[folder.state]}
                  </span>
                </div>
                {folder.message ? (
                  <p className="desktop-watch-folders__notice">{folder.message}</p>
                ) : null}
                <div className="desktop-watch-folders__counts">
                  <span>{folder.counts.imported} imported</span>
                  <span>{folder.counts.duplicate} already filed</span>
                  <span>{folder.counts.failed} failed</span>
                </div>
                <div className="desktop-watch-folders__actions">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        bridge.watchFolders.setPaused({
                          folderId: folder.id,
                          paused: folder.state !== "paused",
                        }),
                      )
                    }
                  >
                    {folder.state === "paused" ? "Resume" : "Pause"}
                  </button>
                  <button
                    type="button"
                    aria-expanded={expandedId === folder.id}
                    onClick={() =>
                      setExpandedId((current) =>
                        current === folder.id ? null : folder.id,
                      )
                    }
                  >
                    {expandedId === folder.id ? "Hide history" : "History"}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        bridge.watchFolders.remove({ folderId: folder.id }),
                      )
                    }
                  >
                    Stop watching
                  </button>
                </div>
                {expandedId === folder.id ? (
                  <ol
                    className="desktop-watch-folders__history"
                    aria-label={`Recent activity in ${folder.label}`}
                  >
                    {folder.history.length === 0 ? (
                      <li>Nothing imported from this folder yet.</li>
                    ) : (
                      folder.history.map((event) => (
                        <li key={event.id} data-outcome={event.outcome}>
                          <span>{event.name}</span>
                          <span>{OUTCOME_LABELS[event.outcome]}</span>
                          <small>{formatTime(event.at)}</small>
                          {event.message ? <small>{event.message}</small> : null}
                        </li>
                      ))
                    )}
                  </ol>
                ) : null}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="desktop-watch-folders__add"
            disabled={busy}
            onClick={() => void addFolder()}
          >
            Add folder…
          </button>
          {message ? (
            <p className="desktop-watch-folders__error" role="alert">
              {message}
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
