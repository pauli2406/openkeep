import "@openkeep/web/styles.css";
import "./renderer/desktop-bootstrap.css";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App as WebApp } from "@openkeep/web/app";
import { configureApiAuthMode } from "@openkeep/web/api";
import type { DesktopSessionState } from "./shared/desktop-api";
import type { DesktopProfilesSnapshot } from "./shared/desktop-api";
import { ConnectionScreen } from "./renderer/connection-screen";
import {
  DesktopAuthProvider,
  DesktopSessionContext,
} from "./renderer/desktop-auth-provider";
import { DesktopArchiveAccessory } from "./renderer/desktop-archive-accessory";
import { ProfileChooser } from "./renderer/profile-chooser";

configureApiAuthMode("main-owned");

export function DesktopApp() {
  const [sessionState, setSessionState] = useState<DesktopSessionState | null>(null);
  const [profiles, setProfiles] = useState<DesktopProfilesSnapshot | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const state = await window.openkeepDesktop.session.restore();
      const snapshot = await window.openkeepDesktop.profiles.list().catch(() => ({
        profiles: [],
        activeProfileId: null,
      }));
      if (active) {
        setSessionState(state);
        setProfiles(snapshot);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (!sessionState || !profiles) {
    return (
      <main className="desktop-connect-shell">
        <section className="desktop-connect-panel desktop-connect-loading" aria-live="polite">
          <span className="desktop-connect-status-dot" aria-hidden="true" />
          <span>Restoring your archive connection…</span>
        </section>
      </main>
    );
  }

  if (sessionState.status !== "connected") {
    if (profiles.profiles.length > 0) {
      return (
        <ProfileChooser
          initialState={sessionState}
          snapshot={profiles}
          onSnapshotChange={setProfiles}
          onStateChange={setSessionState}
        />
      );
    }
    return (
      <ConnectionScreen
        initialState={sessionState}
        onStateChange={setSessionState}
      />
    );
  }

  return (
    <DesktopSessionContext.Provider
      value={{ state: sessionState, setState: setSessionState }}
    >
      <WebApp
        AuthProvider={DesktopAuthProvider}
        ShellAccessory={DesktopArchiveAccessory}
      />
    </DesktopSessionContext.Provider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DesktopApp />
  </StrictMode>,
);
