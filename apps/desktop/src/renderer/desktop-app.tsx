import { useEffect, useState, type ComponentType } from "react";
import {
  App as WebApp,
  type HostImportAdapter,
} from "@openkeep/web/app";
import { setApiFailureHandler } from "@openkeep/web/api";
import type {
  DesktopProfilesSnapshot,
  DesktopRuntimeInfo,
  DesktopSessionState,
} from "../shared/desktop-api";
import { ConnectionScreen } from "./connection-screen";
import {
  DesktopAuthProvider,
  DesktopSessionContext,
} from "./desktop-auth-provider";
import { DesktopArchiveAccessory } from "./desktop-archive-accessory";
import { createDesktopImportAdapter } from "./desktop-import-adapter";
import { DesktopImportHost } from "./desktop-import-host";
import { ProfileChooser } from "./profile-chooser";

type SharedAppProps = {
  AuthProvider?: ComponentType<{ children: React.ReactNode }>;
  ShellAccessory?: ComponentType;
  hostImports?: HostImportAdapter;
  platform?: string;
};

export function DesktopApp({
  SharedApp = WebApp,
}: {
  SharedApp?: ComponentType<SharedAppProps>;
}) {
  const [sessionState, setSessionState] = useState<DesktopSessionState | null>(
    null,
  );
  const [profiles, setProfiles] = useState<DesktopProfilesSnapshot | null>(
    null,
  );
  const [runtime, setRuntime] = useState<DesktopRuntimeInfo | null>(null);
  const [importPipeline] = useState(() =>
    createDesktopImportAdapter(() => window.openkeepDesktop.imports.pick()),
  );

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
        <section
          className="desktop-connect-panel desktop-connect-loading"
          aria-live="polite"
        >
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
      <DesktopImportHost
        activeProfile={sessionState.profile}
        pipeline={importPipeline}
      >
        <SharedApp
          key={sessionState.profile.id}
          AuthProvider={DesktopAuthProvider}
          ShellAccessory={DesktopArchiveAccessory}
          hostImports={importPipeline.adapter}
          platform={runtime.platform}
        />
      </DesktopImportHost>
    </DesktopSessionContext.Provider>
  );
}
