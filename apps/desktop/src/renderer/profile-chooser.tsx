import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type {
  DesktopOfflineAvailability,
  DesktopProfileSummary,
  DesktopProfilesSnapshot,
  DesktopSessionState,
} from "../shared/desktop-api";
import { ArchiveSwitcher } from "./archive-switcher";
import { ConnectionScreen } from "./connection-screen";
import { DesktopAuthSurface } from "./desktop-auth-surface";

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
  const [offline, setOffline] = useState<DesktopOfflineAvailability["profiles"]>({});
  const [message, setMessage] = useState(
    initialState.status === "unavailable" || initialState.status === "error"
      ? initialState.message
      : "Choose an encrypted archive profile or add another connection.",
  );

  useEffect(() => {
    let active = true;
    void window.openkeepDesktop.session
      .offlineAvailability()
      .then((availability) => {
        if (active) setOffline(availability.profiles);
      })
      .catch(() => {
        // No availability just means no offline offer.
      });
    return () => {
      active = false;
    };
  }, []);

  async function openOffline(profileId: string) {
    setBusyProfileId(profileId);
    setMessage("Opening the offline copy…");
    try {
      await window.openkeepDesktop.session.openOffline({ profileId });
      // Main replaces this shell with the profile's read-only offline window.
    } catch (error) {
      setBusyProfileId(undefined);
      setMessage(
        error instanceof Error
          ? error.message
          : "The offline copy could not be opened.",
      );
    }
  }

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
    <DesktopAuthSurface
      labelledBy="profile-chooser-title"
      title="Choose an archive"
      description={message}
      footer={<span>Each profile uses isolated local storage and encrypted credentials</span>}
    >
      <div className="flex flex-col gap-3">
        <ArchiveSwitcher
          fill
          profiles={snapshot.profiles}
          activeProfileId={selectedProfileId}
          busyProfileId={busyProfileId}
          onActivate={(profileId) => void activate(profileId)}
          onAdd={() => setEditor({ mode: "add" })}
          onEdit={(profile) => setEditor({ mode: "edit", profile })}
          onRemove={(profile) => remove(profile)}
        />
        {initialState.status === "unavailable" ? (
          <div className="grid grid-cols-2 gap-2.5">
            <Button type="button" size="lg" onClick={() => void retry()}>
              Retry last archive
            </Button>
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => setEditor({ mode: "add" })}
            >
              Add archive
            </Button>
          </div>
        ) : null}
        {offline[selectedProfileId] ? (
          <div className="flex items-center gap-3 rounded-lg border bg-muted/50 p-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={Boolean(busyProfileId)}
              onClick={() => void openOffline(selectedProfileId)}
            >
              Open offline copy
            </Button>
            <span className="min-w-0 text-xs leading-snug text-muted-foreground">
              {offline[selectedProfileId]!.documentCount} document
              {offline[selectedProfileId]!.documentCount === 1 ? "" : "s"} saved on
              this computer — read only
            </span>
          </div>
        ) : null}
      </div>
    </DesktopAuthSurface>
  );
}
