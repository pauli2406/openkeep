import "@openkeep/web/styles.css";
import "./renderer/desktop-bootstrap.css";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App as WebApp } from "@openkeep/web/app";
import { configureApiAuthMode } from "@openkeep/web/api";
import type { DesktopSessionState } from "./shared/desktop-api";
import { ConnectionScreen } from "./renderer/connection-screen";
import {
  DesktopAuthProvider,
  DesktopSessionContext,
} from "./renderer/desktop-auth-provider";

configureApiAuthMode("main-owned");

export function DesktopApp() {
  const [sessionState, setSessionState] = useState<DesktopSessionState | null>(null);

  useEffect(() => {
    let active = true;
    void window.openkeepDesktop.session.restore().then((state) => {
      if (active) {
        setSessionState(state);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  if (!sessionState) {
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
      <WebApp AuthProvider={DesktopAuthProvider} />
    </DesktopSessionContext.Provider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DesktopApp />
  </StrictMode>,
);
