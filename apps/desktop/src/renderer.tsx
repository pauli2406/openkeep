import "@openkeep/web/styles.css";
import "./renderer/desktop-bootstrap.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { configureApiAuthMode } from "@openkeep/web/api";
import { DesktopApp } from "./renderer/desktop-app";

configureApiAuthMode("main-owned");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DesktopApp />
  </StrictMode>,
);
