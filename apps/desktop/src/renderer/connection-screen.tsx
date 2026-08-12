import { useEffect, useState, type FormEvent } from "react";
import type {
  DesktopBridge,
  DesktopProfileSummary,
  DesktopProfilesSnapshot,
  DesktopSessionState,
} from "../shared/desktop-api";

type ConnectionScreenProps = {
  bridge?: DesktopBridge;
  initialState: Exclude<DesktopSessionState, { status: "connected" }>;
  onStateChange: (state: DesktopSessionState) => void;
  profile?: DesktopProfileSummary;
  onCancel?: () => void;
  onProfilesChanged?: (snapshot: DesktopProfilesSnapshot) => void;
};

export function ConnectionScreen({
  bridge = window.openkeepDesktop,
  initialState,
  onStateChange,
  profile,
  onCancel,
  onProfilesChanged,
}: ConnectionScreenProps) {
  const unavailable = initialState.status === "unavailable" ? initialState : null;
  const editingProfile = profile ?? unavailable?.profile;
  const initialServerUrl =
    initialState.status === "disconnected" || initialState.status === "error"
      ? initialState.serverUrl
      : undefined;
  const [editing, setEditing] = useState(!unavailable);
  const [serverUrl, setServerUrl] = useState(
    editingProfile?.serverUrl || initialServerUrl || "http://localhost:3000",
  );
  const [label, setLabel] = useState(editingProfile?.label ?? "");
  const [apiToken, setApiToken] = useState("");
  const [revealToken, setRevealToken] = useState(false);
  const [cfOpen, setCfOpen] = useState(false);
  const [cfAccessClientId, setCfAccessClientId] = useState("");
  const [cfAccessClientSecret, setCfAccessClientSecret] = useState("");
  const [allowInsecureHttp, setAllowInsecureHttp] = useState(false);
  const [status, setStatus] = useState<"idle" | "checking" | "error">(
    initialState.status === "error" ? "error" : "idle",
  );
  const [message, setMessage] = useState(
    initialState.status === "error" ? initialState.message : "",
  );
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
    const result = await bridge.session.connect({
      ...(editingProfile ? { profileId: editingProfile.id } : {}),
      ...(label.trim() ? { label: label.trim() } : {}),
      serverUrl,
      apiToken,
      cfAccessClientId,
      cfAccessClientSecret,
      allowInsecureHttp,
    });
    if (result.status === "connected") {
      setApiToken("");
      setCfAccessClientSecret("");
      onStateChange(result);
      return;
    }

    setStatus("error");
    if (
      result.status === "error" &&
      result.code === "insecure-http-confirmation-required"
    ) {
      setAllowInsecureHttp(true);
    }
    if (result.status === "error" && result.code === "invalid-credentials") {
      setApiToken("");
      setCfAccessClientSecret("");
    }
    setMessage(
      result.status === "error" || result.status === "unavailable"
        ? result.message
        : "The archive connection could not be completed.",
    );
  }

  async function retry() {
    setStatus("checking");
    setMessage("");
    const result = await bridge.session.retry();
    if (result.status === "connected") {
      onStateChange(result);
      return;
    }
    setStatus("error");
    setMessage(
      result.status === "error" || result.status === "unavailable"
        ? result.message
        : "The stored archive connection is no longer valid.",
    );
  }

  async function renameProfile() {
    if (!editingProfile || !label.trim()) {
      return;
    }
    setStatus("checking");
    setMessage("");
    try {
      const snapshot = await bridge.profiles.rename({
        profileId: editingProfile.id,
        label: label.trim(),
      });
      onProfilesChanged?.(snapshot);
      onCancel?.();
    } catch {
      setStatus("error");
      setMessage("OpenKeep could not rename this archive profile.");
    }
  }

  if (unavailable && !editing) {
    return (
      <main className="desktop-connect-shell">
        <section className="desktop-connect-panel" aria-labelledby="connect-title">
          <div className="desktop-connect-mark" aria-hidden="true">
            <img src="/brand/logo-mark.svg" alt="" />
          </div>
          <div className="desktop-connect-copy">
            <p className="desktop-connect-eyebrow">ARCHIVE UNAVAILABLE</p>
            <h1 id="connect-title">We could not reach {unavailable.profile.label}</h1>
            <p>{message || unavailable.message}</p>
          </div>
          <div className="desktop-connect-actions">
            <button type="button" onClick={() => void retry()} disabled={status === "checking"}>
              {status === "checking" ? "Retrying…" : "Retry connection"}
            </button>
            <button type="button" className="desktop-secondary-button" onClick={() => setEditing(true)}>
              Edit connection
            </button>
          </div>
          <footer>
            <span className="desktop-connect-status-dot desktop-connect-status-dot--warning" aria-hidden="true" />
            <span>Credentials remain encrypted for retry</span>
          </footer>
        </section>
      </main>
    );
  }

  return (
    <main className="desktop-connect-shell">
      <section className="desktop-connect-panel" aria-labelledby="connect-title">
        <div className="desktop-connect-mark" aria-hidden="true">
          <img src="/brand/logo-mark.svg" alt="" />
        </div>

        <div className="desktop-connect-copy">
          <p className="desktop-connect-eyebrow">OPENKEEP · DESKTOP</p>
          <h1 id="connect-title">
            {editingProfile ? "Edit archive connection" : "Connect your archive"}
          </h1>
          <p>
            Use an API token from your OpenKeep profile. Credentials are encrypted by
            your operating system and never enter the web interface.
          </p>
        </div>

        <form className="desktop-connect-form" onSubmit={(event) => void connect(event)}>
          <label htmlFor="profile-label">Profile name</label>
          <div className="desktop-connect-control">
            <span aria-hidden="true">Aa</span>
            <input
              id="profile-label"
              name="profile-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Home archive"
              maxLength={120}
              disabled={status === "checking"}
            />
          </div>

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
              onChange={(event) => {
                setServerUrl(event.target.value);
                setAllowInsecureHttp(false);
              }}
              placeholder="https://archive.example.com"
              disabled={status === "checking"}
            />
          </div>

          <div className="desktop-connect-label-row">
            <label htmlFor="api-token">API token</label>
            <button type="button" onClick={() => setRevealToken((current) => !current)}>
              {revealToken ? "Hide" : "Reveal"}
            </button>
          </div>
          <div className="desktop-connect-control">
            <span aria-hidden="true">⌁</span>
            <input
              id="api-token"
              name="api-token"
              type={revealToken ? "text" : "password"}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={apiToken}
              onChange={(event) => setApiToken(event.target.value)}
              placeholder="Paste an OpenKeep API token"
              disabled={status === "checking"}
              required
            />
          </div>

          <details className="desktop-connect-advanced" open={cfOpen} onToggle={(event) => setCfOpen(event.currentTarget.open)}>
            <summary>Cloudflare Access <span>Optional</span></summary>
            <div className="desktop-connect-advanced-fields">
              <label htmlFor="cf-client-id">Client ID</label>
              <input
                id="cf-client-id"
                value={cfAccessClientId}
                onChange={(event) => setCfAccessClientId(event.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                disabled={status === "checking"}
                placeholder="xxxxxxxx.access"
              />
              <label htmlFor="cf-client-secret">Client secret</label>
              <input
                id="cf-client-secret"
                type="password"
                value={cfAccessClientSecret}
                onChange={(event) => setCfAccessClientSecret(event.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                disabled={status === "checking"}
              />
            </div>
          </details>

          {message ? (
            <p id="connection-error" className="desktop-connect-error" role="alert">
              {message}
            </p>
          ) : (
            <p id="connection-note" className="desktop-connect-note">
              HTTPS is recommended. Localhost HTTP is available for development.
            </p>
          )}

          <button type="submit" disabled={status === "checking"}>
            <span>
              {status === "checking"
                ? "Verifying archive"
                : allowInsecureHttp
                  ? "Connect over plaintext HTTP"
                  : "Connect archive"}
            </span>
            <span aria-hidden="true">{status === "checking" ? "···" : "→"}</span>
          </button>
          {editingProfile && label.trim() !== editingProfile.label ? (
            <button
              type="button"
              className="desktop-secondary-button"
              onClick={() => void renameProfile()}
              disabled={status === "checking" || !label.trim()}
            >
              Save profile name only
            </button>
          ) : null}
          {onCancel ? (
            <button
              type="button"
              className="desktop-secondary-button"
              onClick={onCancel}
              disabled={status === "checking"}
            >
              Cancel
            </button>
          ) : null}
        </form>

        <footer>
          <span className="desktop-connect-status-dot" aria-hidden="true" />
          <span>{version || "Desktop runtime"}</span>
          <span aria-hidden="true">·</span>
          <span>OS-encrypted credentials</span>
        </footer>
      </section>
    </main>
  );
}
