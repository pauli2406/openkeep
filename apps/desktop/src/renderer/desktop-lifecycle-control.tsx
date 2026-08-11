import { useEffect, useId, useRef, useState } from "react";
import type {
  DesktopBridge,
  DesktopCloseBehavior,
  DesktopLifecycleSettings,
} from "../shared/desktop-api";

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
  bridge?: Pick<DesktopBridge, "lifecycle">;
}) {
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<DesktopLifecycleSettings | null>(null);
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
