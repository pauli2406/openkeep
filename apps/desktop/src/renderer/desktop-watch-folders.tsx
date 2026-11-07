import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type {
  DesktopBridge,
  DesktopWatchFolder,
  DesktopWatchFolderEvent,
  DesktopWatchFoldersSnapshot,
} from "../shared/desktop-api";
import { FolderSyncIcon, PlusIcon } from "./desktop-icons";

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

const STATE_BADGES: Record<DesktopWatchFolder["state"], "success" | "secondary" | "info" | "danger"> = {
  watching: "success",
  paused: "secondary",
  waiting: "info",
  missing: "danger",
  unreadable: "danger",
};

function formatTime(at: number) {
  return new Date(at).toLocaleString();
}

export function DesktopWatchFolders({
  bridge = window.openkeepDesktop,
}: {
  bridge?: Pick<DesktopBridge, "watchFolders">;
}) {
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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="relative text-muted-foreground"
          aria-label="Watch folders"
        >
          <FolderSyncIcon className="size-4" />
          {folders.length > 0 ? (
            <span className="num absolute top-0.5 right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[10px] font-semibold text-primary-foreground">
              {folders.length}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="max-h-[min(70vh,620px)] w-[min(430px,calc(100vw-28px))] gap-0 overflow-y-auto rounded-xl p-0 shadow-raised"
        aria-label="Watch folders"
      >
        <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <span className="text-sm font-medium">Watch folders</span>
          <span className="num text-xs text-muted-foreground">
            {folders.length === 0
              ? "None"
              : `${active}/${folders.length} watching`}
          </span>
        </header>
        <div className="flex flex-col items-start gap-3 p-4">
          <p className="text-xs leading-relaxed text-muted-foreground">
            OpenKeep imports new PDF, JPEG, PNG, TIFF, and HEIC files from these
            folders on this computer into this archive, and never changes or
            removes the originals.
          </p>
          {folders.length > 0 ? (
            <ul className="flex w-full flex-col gap-2">
              {folders.map((folder) => (
                <li
                  key={folder.id}
                  className={cn(
                    "flex flex-col gap-2 rounded-lg border p-3",
                    (folder.state === "missing" || folder.state === "unreadable") &&
                      "border-destructive/40",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate text-sm font-medium">{folder.label}</span>
                      <span
                        title={folder.path}
                        className="truncate text-left font-mono text-xs text-muted-foreground [direction:rtl]"
                      >
                        <bdi>{folder.path}</bdi>
                      </span>
                    </span>
                    <Badge variant={STATE_BADGES[folder.state]} className="shrink-0 font-normal">
                      {STATE_LABELS[folder.state]}
                    </Badge>
                  </div>
                  {folder.message ? (
                    <p className="text-xs leading-snug text-danger">{folder.message}</p>
                  ) : null}
                  <div className="num flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span>{folder.counts.imported} imported</span>
                    <span>{folder.counts.duplicate} already filed</span>
                    <span>{folder.counts.failed} failed</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
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
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      aria-expanded={expandedId === folder.id}
                      onClick={() =>
                        setExpandedId((current) =>
                          current === folder.id ? null : folder.id,
                        )
                      }
                    >
                      {expandedId === folder.id ? "Hide history" : "History"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          bridge.watchFolders.remove({ folderId: folder.id }),
                        )
                      }
                    >
                      Stop watching
                    </Button>
                  </div>
                  {expandedId === folder.id ? (
                    <ol
                      className="flex flex-col gap-1.5 border-t pt-2"
                      aria-label={`Recent activity in ${folder.label}`}
                    >
                      {folder.history.length === 0 ? (
                        <li className="text-xs text-muted-foreground">
                          Nothing imported from this folder yet.
                        </li>
                      ) : (
                        folder.history.map((event) => (
                          <li
                            key={event.id}
                            className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-0.5 text-xs text-muted-foreground"
                          >
                            <span className="truncate text-foreground">{event.name}</span>
                            <span
                              className={cn(
                                "font-medium",
                                event.outcome === "failed" && "text-danger",
                              )}
                            >
                              {OUTCOME_LABELS[event.outcome]}
                            </span>
                            <small className="col-span-full text-xs">{formatTime(event.at)}</small>
                            {event.message ? (
                              <small className="col-span-full text-xs">{event.message}</small>
                            ) : null}
                          </li>
                        ))
                      )}
                    </ol>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void addFolder()}
          >
            <PlusIcon className="size-3.5" />
            Add folder…
          </Button>
          {message ? (
            <p className="text-xs leading-snug text-danger" role="alert">
              {message}
            </p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
