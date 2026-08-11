import { useState } from "react";
import type {
  DesktopProfileSummary,
  DesktopProfilesSnapshot,
  DesktopSessionState,
} from "../shared/desktop-api";
import { ArchiveSwitcher } from "./archive-switcher";
import { ConnectionScreen } from "./connection-screen";

type ProfileChooserProps = {
  initialState: Exclude<DesktopSessionState, { status: "connected" }>;
  snapshot: DesktopProfilesSnapshot;
  onSnapshotChange: (snapshot: DesktopProfilesSnapshot) => void;
  onStateChange: (state: DesktopSessionState) => void;
};

type Editor =
  | { mode: "add" }
  | { mode: "edit"; profile: DesktopProfileSummary };

export function ProfileChooser({
  initialState,
  snapshot,
  onSnapshotChange,
  onStateChange,
}: ProfileChooserProps) {
  const [busyProfileId, setBusyProfileId] = useState<string>();
  const [editor, setEditor] = useState<Editor | null>(null);
  const [message, setMessage] = useState(
    initialState.status === "unavailable" || initialState.status === "error"
      ? initialState.message
      : "Choose an encrypted archive profile or add another connection.",
  );

  async function refreshProfiles() {
    const next = await window.openkeepDesktop.profiles.list();
    onSnapshotChange(next);
    return next;
  }

  async function activate(profileId: string) {
    setBusyProfileId(profileId);
    setMessage("Verifying archive connection…");
    const result = await window.openkeepDesktop.profiles.activate({ profileId });
    if (result.status === "connected") {
      setMessage(`Opening ${result.profile.label}…`);
      // Main replaces this shell with the profile's isolated BrowserWindow.
      return;
    }
    setBusyProfileId(undefined);
    setMessage(
      result.status === "error" || result.status === "unavailable"
        ? result.message
        : "That archive profile could not be activated.",
    );
    await refreshProfiles();
  }

  async function remove(profile: DesktopProfileSummary) {
    setBusyProfileId(profile.id);
    const result = await window.openkeepDesktop.profiles.remove({
      profileId: profile.id,
    });
    const next = await refreshProfiles();
    setBusyProfileId(undefined);
    if (result.status === "connected") {
      setMessage(`Opening ${result.profile.label}…`);
      return;
    }
    if (next.profiles.length === 0) {
      onStateChange({ status: "disconnected", reason: "no-profile" });
    }
  }

  async function retry() {
    setMessage("Retrying the last archive…");
    const result = await window.openkeepDesktop.session.retry();
    if (result.status === "connected") {
      setMessage(`Opening ${result.profile.label}…`);
      return;
    }
    setMessage(
      result.status === "error" || result.status === "unavailable"
        ? result.message
        : "The stored archive is still unavailable.",
    );
  }

  if (editor) {
    return (
      <ConnectionScreen
        initialState={{ status: "disconnected", reason: "choose-profile" }}
        profile={editor.mode === "edit" ? editor.profile : undefined}
        onStateChange={(state) => {
          if (state.status === "connected") {
            setMessage(`Opening ${state.profile.label}…`);
          }
        }}
        onProfilesChanged={onSnapshotChange}
        onCancel={() => setEditor(null)}
      />
    );
  }

  const selectedProfileId =
    snapshot.activeProfileId ?? snapshot.profiles[0]?.id ?? "";

  return (
    <main className="desktop-connect-shell">
      <section className="desktop-connect-panel" aria-labelledby="profile-chooser-title">
        <div className="desktop-connect-mark" aria-hidden="true">
          <img src="/brand/logo-mark.svg" alt="" />
        </div>
        <div className="desktop-connect-copy">
          <p className="desktop-connect-eyebrow">OPENKEEP · ARCHIVES</p>
          <h1 id="profile-chooser-title">Choose an archive</h1>
          <p>{message}</p>
        </div>
        <div className="desktop-profile-chooser__switcher">
          <ArchiveSwitcher
            profiles={snapshot.profiles}
            activeProfileId={selectedProfileId}
            busyProfileId={busyProfileId}
            onActivate={(profileId) => void activate(profileId)}
            onAdd={() => setEditor({ mode: "add" })}
            onEdit={(profile) => setEditor({ mode: "edit", profile })}
            onRemove={(profile) => remove(profile)}
          />
        </div>
        {initialState.status === "unavailable" ? (
          <div className="desktop-connect-actions">
            <button type="button" onClick={() => void retry()}>
              Retry last archive
            </button>
            <button
              type="button"
              className="desktop-secondary-button"
              onClick={() => setEditor({ mode: "add" })}
            >
              Add archive
            </button>
          </div>
        ) : null}
        <footer>
          <span className="desktop-connect-status-dot" aria-hidden="true" />
          <span>Each profile uses isolated local storage and encrypted credentials</span>
        </footer>
      </section>
    </main>
  );
}
