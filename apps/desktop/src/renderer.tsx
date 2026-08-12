import "@openkeep/web/styles.css";
import "./renderer/desktop-bootstrap.css";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { App as WebApp } from "@openkeep/web/app";
import { ConnectionScreen } from "./renderer/connection-screen";

export function DesktopApp() {
  const [connected, setConnected] = useState(false);

  return connected ? <WebApp /> : <ConnectionScreen onConnected={() => setConnected(true)} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DesktopApp />
  </StrictMode>,
);
