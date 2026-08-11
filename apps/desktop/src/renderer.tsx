import "@openkeep/web/styles.css";
import "./renderer/desktop-bootstrap.css";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App as WebApp } from "@openkeep/web/app";
import {
  configureApiAuthMode,
  setApiFailureHandler,
} from "@openkeep/web/api";
import type { DesktopSessionState } from "./shared/desktop-api";
import type { DesktopProfilesSnapshot } from "./shared/desktop-api";
import type { DesktopRuntimeInfo } from "./shared/desktop-api";
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
  const [runtime, setRuntime] = useState<DesktopRuntimeInfo | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [state, snapshot, runtimeInfo] = await Promise.all([
        window.openkeepDesktop.session.restore(),
        window.openkeepDesktop.profiles.list().catch(() => ({
          profiles: [],
          activeProfileId: null,
        })),
        window.openkeepDesktop.runtime.getInfo(),
      ]);
      if (active) {
        setSessionState(state);
        setProfiles(snapshot);
        setRuntime(runtimeInfo);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (sessionState?.status !== "connected") {
      setApiFailureHandler(null);
      return;
    }

    let retrying = false;
    setApiFailureHandler(() => {
      if (retrying) return;
      retrying = true;
      void window.openkeepDesktop.session
        .retry()
        .then(setSessionState)
        .catch(() => {
          setSessionState({
            status: "error",
            code: "unreachable",
            message: "OpenKeep could not re-check the active archive.",
          });
        })
        .finally(() => {
          retrying = false;
        });
    });
    return () => setApiFailureHandler(null);
  }, [sessionState?.status]);

  if (!sessionState || !profiles || !runtime) {
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
        platform={runtime.platform}
      />
    </DesktopSessionContext.Provider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DesktopApp />
  </StrictMode>,
);
