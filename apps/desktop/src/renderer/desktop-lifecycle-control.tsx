import { useEffect, useId, useRef, useState } from "react";
import type {
  DesktopBridge,
  DesktopCloseBehavior,
  DesktopLifecycleSettings,
  DesktopNotificationKind,
  DesktopNotificationSettings,
} from "../shared/desktop-api";

const NOTIFICATION_LABELS: Array<{
  kind: DesktopNotificationKind;
  title: string;
  detail: string;
}> = [
  {
    kind: "completed",
    title: "Finished imports",
    detail: "A document has been processed and filed.",
  },
  {
    kind: "review",
    title: "Documents needing review",
    detail: "A document was filed but wants your confirmation.",
  },
  {
    kind: "failed",
    title: "Failed imports",
    detail: "A document could not be processed.",
  },
];

function TrayGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 6.5h14v9H5z" />
      <path d="M8 19h8M12 15.5V19M8 3.5h8" />
    </svg>
  );
}

export function DesktopLifecycleControl({
  bridge = window.openkeepDesktop,
}: {
  bridge?: Pick<DesktopBridge, "lifecycle" | "notifications">;
}) {
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<DesktopLifecycleSettings | null>(null);
  const [notifications, setNotifications] =
    useState<DesktopNotificationSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    void bridge.lifecycle.getSettings().then((next) => {
      if (active) setSettings(next);
    }).catch(() => {
      if (active) setMessage("Desktop behavior could not be loaded.");
    });
    return () => { active = false; };
  }, [bridge]);

  useEffect(() => {
    let active = true;
    void bridge.notifications.getSettings().then((next) => {
      if (active) setNotifications(next);
    }).catch(() => {
      if (active) setMessage("Notification settings could not be loaded.");
    });
    return () => { active = false; };
  }, [bridge]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function changeCloseBehavior(closeBehavior: DesktopCloseBehavior) {
    if (!settings || closeBehavior === settings.closeBehavior) return;
    setBusy(true);
    setMessage("");
    try {
      setSettings(await bridge.lifecycle.setCloseBehavior({ closeBehavior }));
    } catch {
      setMessage("Desktop behavior could not be changed.");
    } finally {
      setBusy(false);
    }
  }

  async function changeNotification(kind: DesktopNotificationKind, enabled: boolean) {
    setBusy(true);
    setMessage("");
    try {
      setNotifications(await bridge.notifications.setPreference({ kind, enabled }));
    } catch {
      setMessage("That notification setting could not be changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="desktop-lifecycle-control" ref={rootRef}>
      <button
        type="button"
        className="desktop-lifecycle-control__trigger"
        aria-label="Desktop behavior"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        <TrayGlyph />
      </button>
      {open ? (
        <section
          id={panelId}
          className="desktop-lifecycle-control__panel"
          aria-label="Desktop behavior"
        >
          <header>
            <span>Desktop behavior</span>
            <strong>{settings?.trayAvailable ? "Tray ready" : "No tray"}</strong>
          </header>
          <fieldset disabled={busy || !settings}>
            <legend>When the window closes</legend>
            <label>
              <input
                type="radio"
                name="desktop-close-behavior"
                checked={settings?.closeBehavior === "tray"}
                disabled={!settings?.trayAvailable}
                onChange={() => void changeCloseBehavior("tray")}
              />
              <span>
                <strong>Keep OpenKeep running</strong>
                <small>
                  Hide in the system tray so imports and background work can continue.
                </small>
              </span>
            </label>
            <label>
              <input
                type="radio"
                name="desktop-close-behavior"
                checked={settings?.closeBehavior === "quit"}
                onChange={() => void changeCloseBehavior("quit")}
              />
              <span>
                <strong>Quit OpenKeep</strong>
                <small>
                  Closing the window stops imports and all background work.
                </small>
              </span>
            </label>
          </fieldset>
          <fieldset disabled={busy || !notifications}>
            <legend>Notify me about</legend>
            {NOTIFICATION_LABELS.map(({ kind, title, detail }) => (
              <label key={kind}>
                <input
                  type="checkbox"
                  checked={notifications?.preferences[kind] ?? false}
                  onChange={(event) =>
                    void changeNotification(kind, event.target.checked)
                  }
                />
                <span>
                  <strong>{title}</strong>
                  <small>{detail}</small>
                </span>
              </label>
            ))}
          </fieldset>
          {notifications && !notifications.supported ? (
            <p className="desktop-lifecycle-control__notice">
              This system has no notification service available, so OpenKeep cannot
              show them. Import results stay visible in the app.
            </p>
          ) : null}
          {settings && !settings.trayAvailable ? (
            <p className="desktop-lifecycle-control__notice">
              A usable system tray is unavailable, so closing the window quits
              OpenKeep to avoid leaving an invisible process.
            </p>
          ) : null}
          {message ? <p className="desktop-lifecycle-control__error" role="alert">{message}</p> : null}
        </section>
      ) : null}
    </div>
  );
}
