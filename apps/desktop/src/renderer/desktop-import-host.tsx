import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { HostImportDelivery } from "@openkeep/web/app";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type {
  DesktopBridge,
  DesktopImportBatch,
  DesktopProfileSummary,
  DesktopSessionState,
} from "../shared/desktop-api";
import { InboxIcon } from "./desktop-icons";

type ImportPipeline = {
  publish: (delivery: HostImportDelivery) => void;
};

function importUrl() {
  return new URL("/upload", window.location.href).href;
}

function navigateToDesktopImport() {
  window.location.assign(importUrl());
}

export function DesktopImportHost({
  activeProfile,
  bridge = window.openkeepDesktop,
  pipeline,
  navigateToImport = navigateToDesktopImport,
  children,
}: {
  activeProfile: DesktopProfileSummary;
  bridge?: DesktopBridge;
  pipeline: ImportPipeline;
  navigateToImport?: () => void;
  children: ReactNode;
}) {
  const [profiles, setProfiles] = useState<DesktopProfileSummary[]>([]);
  const [unassigned, setUnassigned] = useState<DesktopImportBatch | null>(null);
  const [busyProfileId, setBusyProfileId] = useState<string>();
  const [message, setMessage] = useState("");
  const running = useRef(false);
  const refreshAgain = useRef(false);

  const refresh = useCallback(async () => {
    if (running.current) {
      refreshAgain.current = true;
      return;
    }
    running.current = true;
    try {
      do {
        refreshAgain.current = false;
        const [profileSnapshot, importSnapshot] = await Promise.all([
          bridge.profiles.list(),
          bridge.imports.pending(),
        ]);
        setProfiles(profileSnapshot.profiles);

        const awaitingArchive = importSnapshot.batches.find(
          (batch) => batch.profileId === null,
        );
        if (awaitingArchive) {
          if (profileSnapshot.profiles.length === 1) {
            await bridge.imports.assign({
              batchId: awaitingArchive.id,
              profileId: profileSnapshot.profiles[0]!.id,
            });
            refreshAgain.current = true;
          } else {
            setUnassigned(awaitingArchive);
          }
          continue;
        }
        setUnassigned(null);

        const ready = importSnapshot.batches.some(
          (batch) => batch.profileId === activeProfile.id,
        );
        if (!ready) continue;
        if (window.location.pathname !== "/upload") {
          navigateToImport();
          return;
        }
        pipeline.publish(await bridge.imports.consume());
      } while (refreshAgain.current);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "OpenKeep could not prepare the selected files.",
      );
    } finally {
      running.current = false;
    }
  }, [activeProfile.id, bridge, navigateToImport, pipeline]);

  useEffect(() => {
    const unsubscribe = bridge.imports.onChanged(() => void refresh());
    void refresh();
    return unsubscribe;
  }, [bridge, refresh]);

  async function chooseProfile(profileId: string) {
    if (!unassigned) return;
    setBusyProfileId(profileId);
    setMessage("");
    try {
      await bridge.imports.assign({ batchId: unassigned.id, profileId });
      if (profileId === activeProfile.id) {
        setUnassigned(null);
        await refresh();
        return;
      }
      const state: DesktopSessionState = await bridge.profiles.activate({ profileId });
      if (state.status !== "connected") {
        setBusyProfileId(undefined);
        setMessage(
          state.status === "error" || state.status === "unavailable"
            ? state.message
            : "That archive could not be activated.",
        );
      }
      // Successful activation recreates an isolated profile window. Its import
      // host consumes the batch only after that archive has authenticated.
    } catch (error) {
      setBusyProfileId(undefined);
      setMessage(
        error instanceof Error ? error.message : "The archive could not be selected.",
      );
    }
  }

  const itemCount = unassigned
    ? unassigned.files.length + unassigned.rejected.length
    : 0;

  return (
    <>
      {children}
      {unassigned ? (
        <div className="fixed inset-0 z-280 grid place-items-center bg-overlay p-7 backdrop-blur-sm">
          <section
            className="flex max-h-full w-full max-w-xl flex-col overflow-y-auto rounded-2xl border bg-popover p-6 text-sm text-popover-foreground shadow-raised animate-in fade-in-0 zoom-in-95 motion-reduce:animate-none"
            role="dialog"
            aria-modal="true"
            aria-labelledby="desktop-import-title"
          >
            <div className="flex items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand-soft-foreground">
                <InboxIcon className="size-4.5" />
              </span>
              <div className="min-w-0 flex-1 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">Open with OpenKeep</p>
                <p>Incoming documents</p>
              </div>
              <Badge variant="secondary" className="num">
                {itemCount}
              </Badge>
            </div>
            <h2 id="desktop-import-title" className="mt-5 text-xl font-semibold tracking-tight">
              Choose an archive
            </h2>
            <p className="mt-1.5 leading-relaxed text-muted-foreground">
              These files stay local until you choose where they belong. OpenKeep
              will upload them through that archive’s normal processing queue.
            </p>
            <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Incoming files">
              {[...unassigned.files, ...unassigned.rejected].map((file) => (
                <li
                  key={file.id}
                  className="max-w-48 truncate rounded-full border px-2.5 py-1 text-xs text-muted-foreground"
                >
                  {file.name}
                </li>
              ))}
            </ul>
            <div className="mt-5 flex flex-col gap-2">
              {profiles.map((profile) => (
                <Button
                  type="button"
                  variant="outline"
                  key={profile.id}
                  disabled={Boolean(busyProfileId)}
                  className="h-auto w-full justify-between gap-4 py-2.5 text-left font-normal shadow-none"
                  onClick={() => void chooseProfile(profile.id)}
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">{profile.label}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {profile.serverUrl}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-brand">
                    {busyProfileId === profile.id ? <Spinner className="size-3.5" /> : null}
                    {busyProfileId === profile.id
                      ? "Connecting…"
                      : profile.id === activeProfile.id
                        ? "Import here"
                        : "Switch & import"}
                  </span>
                </Button>
              ))}
            </div>
            {message ? (
              <p role="alert" className="mt-3 text-sm text-danger">
                {message}
              </p>
            ) : null}
          </section>
        </div>
      ) : null}
    </>
  );
}
