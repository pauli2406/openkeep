import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { HostImportDelivery } from "@openkeep/web/app";
import type {
  DesktopBridge,
  DesktopImportBatch,
  DesktopProfileSummary,
  DesktopSessionState,
} from "../shared/desktop-api";

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
        <div className="desktop-import-backdrop">
          <section
            className="desktop-import-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="desktop-import-title"
          >
            <header>
              <span>Incoming documents</span>
              <span>{itemCount.toString().padStart(2, "0")}</span>
            </header>
            <div className="desktop-import-dialog__copy">
              <p className="desktop-import-dialog__eyebrow">Open with OpenKeep</p>
              <h2 id="desktop-import-title">Choose an archive</h2>
              <p>
                These files stay local until you choose where they belong. OpenKeep
                will upload them through that archive’s normal processing queue.
              </p>
            </div>
            <ul className="desktop-import-dialog__files" aria-label="Incoming files">
              {[...unassigned.files, ...unassigned.rejected].map((file) => (
                <li key={file.id}>{file.name}</li>
              ))}
            </ul>
            <div className="desktop-import-dialog__profiles">
              {profiles.map((profile) => (
                <button
                  type="button"
                  key={profile.id}
                  disabled={Boolean(busyProfileId)}
                  onClick={() => void chooseProfile(profile.id)}
                >
                  <span>
                    <strong>{profile.label}</strong>
                    <small>{profile.serverUrl}</small>
                  </span>
                  <span>
                    {busyProfileId === profile.id
                      ? "Connecting…"
                      : profile.id === activeProfile.id
                        ? "Import here"
                        : "Switch & import"}
                  </span>
                </button>
              ))}
            </div>
            {message ? <p className="desktop-import-dialog__error">{message}</p> : null}
          </section>
        </div>
      ) : null}
    </>
  );
}
