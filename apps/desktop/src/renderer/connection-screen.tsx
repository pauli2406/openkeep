import { useEffect, useState, type FormEvent } from "react";
import type { DesktopBridge } from "../shared/desktop-api";

type ConnectionScreenProps = {
  bridge?: DesktopBridge;
  onConnected: () => void;
};

export function ConnectionScreen({
  bridge = window.openkeepDesktop,
  onConnected,
}: ConnectionScreenProps) {
  const [serverUrl, setServerUrl] = useState("http://localhost:3000");
  const [status, setStatus] = useState<"idle" | "checking" | "error">("idle");
  const [message, setMessage] = useState("");
  const [version, setVersion] = useState("");

  useEffect(() => {
    let active = true;
    void bridge.runtime.getInfo().then((info) => {
      if (active) {
        setVersion(`Desktop ${info.version} · ${info.platform}`);
      }
    });
    return () => {
      active = false;
    };
  }, [bridge]);

  async function connect(event: FormEvent) {
    event.preventDefault();
    if (status === "checking") {
      return;
    }

    setStatus("checking");
    setMessage("");
    const result = await bridge.connection.checkHealth({ serverUrl });
    if (result.ok) {
      onConnected();
      return;
    }

    setStatus("error");
    setMessage(result.message);
  }

  return (
    <main className="desktop-connect-shell">
      <section className="desktop-connect-panel" aria-labelledby="connect-title">
        <div className="desktop-connect-mark" aria-hidden="true">
          <img src="/brand/logo-mark.svg" alt="" />
        </div>

        <div className="desktop-connect-copy">
          <p className="desktop-connect-eyebrow">OPENKEEP · DESKTOP</p>
          <h1 id="connect-title">Open your archive</h1>
          <p>
            Start with the address of the OpenKeep server you already run. This first
            foundation build checks the archive before opening the shared client.
          </p>
        </div>

        <form className="desktop-connect-form" onSubmit={(event) => void connect(event)}>
          <label htmlFor="server-url">Archive address</label>
          <div className="desktop-connect-control">
            <span aria-hidden="true">↗</span>
            <input
              id="server-url"
              name="server-url"
              type="url"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={serverUrl}
              onChange={(event) => setServerUrl(event.target.value)}
              placeholder="https://archive.example.com"
              aria-describedby={message ? "connection-error" : "connection-note"}
              aria-invalid={status === "error"}
              disabled={status === "checking"}
            />
          </div>

          {message ? (
            <p id="connection-error" className="desktop-connect-error" role="alert">
              {message}
            </p>
          ) : (
            <p id="connection-note" className="desktop-connect-note">
              HTTPS is recommended. Localhost is available for development.
            </p>
          )}

          <button type="submit" disabled={status === "checking"}>
            <span>{status === "checking" ? "Checking archive" : "Check and open"}</span>
            <span aria-hidden="true">{status === "checking" ? "···" : "→"}</span>
          </button>
        </form>

        <footer>
          <span className="desktop-connect-status-dot" aria-hidden="true" />
          <span>{version || "Desktop runtime"}</span>
          <span aria-hidden="true">·</span>
          <span>Local, sandboxed interface</span>
        </footer>
      </section>
    </main>
  );
}
