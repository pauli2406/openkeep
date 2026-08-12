import { useCallback, useContext, useEffect, useState } from "react";
import type {
  DesktopProfileSummary,
  DesktopProfilesSnapshot,
  DesktopSessionState,
} from "../shared/desktop-api";
import { ArchiveSwitcher } from "./archive-switcher";
import { ConnectionScreen } from "./connection-screen";
import { DesktopSessionContext } from "./desktop-auth-provider";
import { DesktopLifecycleControl } from "./desktop-lifecycle-control";
import { DesktopWatchFolders } from "./desktop-watch-folders";

type ProfileEditor =
  | { mode: "add" }
  | { mode: "edit"; profile: DesktopProfileSummary };

function useDesktopSession() {
  const session = useContext(DesktopSessionContext);
  if (!session) {
    throw new Error("DesktopArchiveAccessory requires an active desktop session.");
  }
  return session;
}

export function DesktopArchiveAccessory() {
  const session = useDesktopSession();
  const [snapshot, setSnapshot] = useState<DesktopProfilesSnapshot>({
    profiles: [session.state.profile],
    activeProfileId: session.state.profile.id,
  });
  const [busyProfileId, setBusyProfileId] = useState<string>();
  const [editor, setEditor] = useState<ProfileEditor | null>(null);
  const [message, setMessage] = useState("");

  const refreshProfiles = useCallback(async () => {
    const next = await window.openkeepDesktop.profiles.list();
    setSnapshot(next);
    return next;
  }, []);

  useEffect(() => {
    void refreshProfiles().catch(() => {
      setMessage("Archive profiles could not be loaded.");
    });
  }, [refreshProfiles]);

  async function activateProfile(profileId: string) {
    if (profileId === session.state.profile.id) {
      return;
    }
    setBusyProfileId(profileId);
    setMessage("");
    const result = await window.openkeepDesktop.profiles.activate({ profileId });
    if (result.status !== "connected") {
      setBusyProfileId(undefined);
      setMessage(
        result.status === "error" || result.status === "unavailable"
          ? result.message
          : "That archive profile could not be activated.",
      );
      await refreshProfiles();
    }
    // A successful activation is completed by main in a newly isolated
    // BrowserWindow. Keeping this renderer unchanged avoids showing the new
    // identity alongside the previous profile's query cache, even briefly.
  }

  async function removeProfile(profile: DesktopProfileSummary) {
    setBusyProfileId(profile.id);
    setMessage("");
    const result = await window.openkeepDesktop.profiles.remove({
      profileId: profile.id,
    });
    if (
      result.status === "connected" &&
      result.profile.id === session.state.profile.id
    ) {
      session.setState(result);
      await refreshProfiles();
      setBusyProfileId(undefined);
      return;
    }
    if (result.status === "error" || result.status === "unavailable") {
      setMessage(result.message);
      setBusyProfileId(undefined);
      await refreshProfiles();
    }
    // Removing the active profile transitions to a fresh shell/profile window.
  }

  function applyProfileSnapshot(next: DesktopProfilesSnapshot) {
    setSnapshot(next);
    const active = next.profiles.find(
      (profile) => profile.id === session.state.profile.id,
    );
    if (active) {
      session.setState({ ...session.state, profile: active });
    }
  }

  function handleConnectionState(state: DesktopSessionState) {
    if (state.status !== "connected") {
      return;
    }
    setBusyProfileId(state.profile.id);
    // Main recreates the window because a newly added or edited connection has
    // its own persistent partition. Do not install it in this renderer.
  }

  return (
    <>
      <div className="desktop-archive-accessory">
        <ArchiveSwitcher
          profiles={snapshot.profiles}
          activeProfileId={session.state.profile.id}
          busyProfileId={busyProfileId}
          onActivate={(profileId) => void activateProfile(profileId)}
          onAdd={() => setEditor({ mode: "add" })}
          onEdit={(profile) => setEditor({ mode: "edit", profile })}
          onRemove={(profile) => removeProfile(profile)}
        />
        <DesktopWatchFolders />
        <DesktopLifecycleControl profileId={session.state.profile.id} />
        {message ? (
          <span className="desktop-archive-accessory__error" role="alert">
            {message}
          </span>
        ) : null}
      </div>

      {editor ? (
        <div className="desktop-profile-editor" role="dialog" aria-modal="true">
          <ConnectionScreen
            initialState={{ status: "disconnected", reason: "choose-profile" }}
            profile={editor.mode === "edit" ? editor.profile : undefined}
            onStateChange={handleConnectionState}
            onProfilesChanged={applyProfileSnapshot}
            onCancel={() => setEditor(null)}
          />
        </div>
      ) : null}
    </>
  );
}
