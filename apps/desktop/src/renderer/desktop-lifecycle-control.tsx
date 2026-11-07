import { useEffect, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { OFFLINE_CACHE_LIMIT_CHOICES } from "../shared/desktop-api";
import type {
  DesktopBridge,
  DesktopCloseBehavior,
  DesktopLifecycleSettings,
  DesktopNotificationKind,
  DesktopNotificationSettings,
  DesktopOfflineAvailability,
  DesktopUpdatesState,
} from "../shared/desktop-api";
import { MonitorCogIcon } from "./desktop-icons";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes;
  let unit = "B";
  for (const next of units) {
    if (value < 1024) break;
    value /= 1024;
    unit = next;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`;
}

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
    kind: "deadlines",
    title: "Deadline reminders",
    detail: "A document's due date is approaching, due, or overdue.",
  },
  {
    kind: "failed",
    title: "Failed imports",
    detail: "A document could not be processed.",
  },
];

const OPTION_ROW =
  "flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/60 has-data-checked:border-ring/60 has-data-checked:bg-brand-soft has-disabled:cursor-not-allowed has-disabled:opacity-60";

function OptionText({ title, detail }: { title: string; detail: ReactNode }) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="text-sm font-medium">{title}</span>
      <span className="text-xs leading-snug text-muted-foreground">{detail}</span>
    </span>
  );
}

export function DesktopLifecycleControl({
  bridge = window.openkeepDesktop,
  profileId,
}: {
  bridge?: Pick<DesktopBridge, "lifecycle" | "notifications"> & {
    updates?: DesktopBridge["updates"];
    session?: Pick<
      DesktopBridge["session"],
      "offlineAvailability" | "clearOfflineCopy" | "setOfflineCopyLimit"
    >;
  };
  /** The active archive, whose offline copy the panel inspects. */
  profileId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<DesktopLifecycleSettings | null>(null);
  const [notifications, setNotifications] =
    useState<DesktopNotificationSettings | null>(null);
  const [offlineCopy, setOfflineCopy] = useState<
    DesktopOfflineAvailability["profiles"][string] | null
  >(null);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [updates, setUpdates] = useState<DesktopUpdatesState | null>(null);
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
    if (!open || !profileId || !bridge.session) return;
    let active = true;
    void bridge.session
      .offlineAvailability()
      .then((availability) => {
        if (active) setOfflineCopy(availability.profiles[profileId] ?? null);
      })
      .catch(() => {
        // No availability just means nothing to inspect.
      });
    return () => {
      active = false;
    };
  }, [open, profileId, bridge]);

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

  useEffect(() => {
    if (!bridge.updates) return;
    let active = true;
    const refresh = () =>
      bridge.updates!
        .state()
        .then((next) => {
          if (active) setUpdates(next);
        })
        .catch(() => undefined);
    void refresh();
    const unsubscribe = bridge.updates.onChanged(() => void refresh());
    return () => {
      active = false;
      unsubscribe();
    };
  }, [bridge]);

  async function checkForUpdates() {
    if (!bridge.updates) return;
    try {
      setUpdates(await bridge.updates.check());
    } catch {
      setMessage("The update check could not be started.");
    }
  }

  function describeUpdates(state: DesktopUpdatesState): string {
    switch (state.status) {
      case "checking":
        return "Checking for updates…";
      case "downloading":
        return "Downloading the update…";
      case "ready":
        return state.version
          ? `Update ${state.version} is ready to install.`
          : "An update is ready to install.";
      case "upToDate":
        return "OpenKeep is up to date.";
      case "available-manual":
        return `Version ${state.version} is available.`;
      case "unsupported":
        return state.reason;
      case "error":
        return state.message;
      default:
        return "Updates have not been checked yet.";
    }
  }

  async function changeOfflineLimit(nextMaxBytes: number) {
    if (!profileId || !bridge.session) return;
    setBusy(true);
    setMessage("");
    try {
      const availability = await bridge.session.setOfflineCopyLimit({
        profileId,
        maxBytes: nextMaxBytes,
      });
      setOfflineCopy(availability.profiles[profileId] ?? null);
    } catch {
      setMessage("The offline copy limit could not be changed.");
    } finally {
      setBusy(false);
    }
  }

  async function clearOfflineCopy() {
    if (!profileId || !bridge.session) return;
    setBusy(true);
    setMessage("");
    try {
      const availability = await bridge.session.clearOfflineCopy({ profileId });
      setOfflineCopy(availability.profiles[profileId] ?? null);
      setConfirmingClear(false);
    } catch {
      setMessage("The offline copy could not be deleted.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-muted-foreground"
          aria-label="Desktop behavior"
        >
          <MonitorCogIcon className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="max-h-[min(80vh,720px)] w-[min(390px,calc(100vw-28px))] gap-0 overflow-y-auto rounded-xl p-0 shadow-raised"
        aria-label="Desktop behavior"
      >
        <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <span className="text-sm font-medium">Desktop behavior</span>
          <Badge variant={settings?.trayAvailable ? "brand" : "secondary"} className="font-normal">
            {settings?.trayAvailable ? "Tray ready" : "No tray"}
          </Badge>
        </header>
        <div className="flex flex-col gap-4 p-4">
          <fieldset disabled={busy || !settings} className="flex min-w-0 flex-col gap-2">
            <legend className="pb-2 text-xs font-medium text-muted-foreground">
              When the window closes
            </legend>
            <RadioGroup
              value={settings?.closeBehavior ?? ""}
              onValueChange={(value) => void changeCloseBehavior(value as DesktopCloseBehavior)}
            >
              <label className={OPTION_ROW}>
                <RadioGroupItem
                  value="tray"
                  className="mt-0.5"
                  disabled={!settings?.trayAvailable}
                />
                <OptionText
                  title="Keep OpenKeep running"
                  detail="Hide in the system tray so imports and background work can continue."
                />
              </label>
              <label className={OPTION_ROW}>
                <RadioGroupItem value="quit" className="mt-0.5" />
                <OptionText
                  title="Quit OpenKeep"
                  detail="Closing the window stops imports and all background work."
                />
              </label>
            </RadioGroup>
          </fieldset>
          <fieldset disabled={busy || !notifications} className="flex min-w-0 flex-col gap-2">
            <legend className="pb-2 text-xs font-medium text-muted-foreground">
              Notify me about
            </legend>
            {NOTIFICATION_LABELS.map(({ kind, title, detail }) => (
              <label key={kind} className={OPTION_ROW}>
                <Checkbox
                  className="mt-0.5"
                  checked={notifications?.preferences[kind] ?? false}
                  onCheckedChange={(checked) => void changeNotification(kind, checked === true)}
                />
                <OptionText title={title} detail={detail} />
              </label>
            ))}
          </fieldset>
          {updates ? (
            <div className="flex flex-col items-start gap-2 rounded-lg border bg-muted/50 p-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">Updates</span>
                <span role="status" className="text-xs leading-snug text-muted-foreground">
                  {describeUpdates(updates)}
                </span>
              </div>
              {updates.status === "ready" ? (
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => void bridge.updates?.install()}
                >
                  Restart and install
                </Button>
              ) : updates.status === "available-manual" ? (
                <Button asChild variant="outline" size="xs">
                  <a href={updates.url} target="_blank" rel="noreferrer">
                    Open the release page
                  </a>
                </Button>
              ) : updates.status !== "unsupported" ? (
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  disabled={
                    updates.status === "checking" || updates.status === "downloading"
                  }
                  onClick={() => void checkForUpdates()}
                >
                  Check for updates
                </Button>
              ) : null}
            </div>
          ) : null}
          {profileId && offlineCopy ? (
            <div className="flex flex-col items-start gap-2 rounded-lg border bg-muted/50 p-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">Offline copy</span>
                <span className="text-xs leading-snug text-muted-foreground">
                  {offlineCopy.documentCount} document
                  {offlineCopy.documentCount === 1 ? "" : "s"} ·{" "}
                  {formatBytes(offlineCopy.fileStorageBytes)} · last saved{" "}
                  {offlineCopy.lastCachedAt
                    ? new Date(offlineCopy.lastCachedAt).toLocaleString()
                    : "never"}
                </span>
              </div>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Size limit</span>
                <select
                  disabled={busy}
                  className="h-7 rounded-md border border-input bg-background px-1.5 text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
                  value={String(offlineCopy.maxBytes)}
                  onChange={(event) =>
                    void changeOfflineLimit(Number(event.target.value))
                  }
                >
                  {[...OFFLINE_CACHE_LIMIT_CHOICES]
                    .concat(
                      OFFLINE_CACHE_LIMIT_CHOICES.some(
                        (choice) => choice === offlineCopy.maxBytes,
                      )
                        ? []
                        : [offlineCopy.maxBytes as (typeof OFFLINE_CACHE_LIMIT_CHOICES)[number]],
                    )
                    .sort((a, b) => a - b)
                    .map((choice) => (
                      <option key={choice} value={String(choice)}>
                        {formatBytes(choice)}
                      </option>
                    ))}
                </select>
              </label>
              {offlineCopy.quarantined > 0 ? (
                <span role="status" className="text-xs leading-snug text-warning">
                  {offlineCopy.quarantined} damaged{" "}
                  {offlineCopy.quarantined === 1 ? "entry was" : "entries were"}{" "}
                  removed from the copy. Reopen the affected documents online to
                  restore them.
                </span>
              ) : null}
              {confirmingClear ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="basis-full text-xs leading-snug text-danger">
                    Delete the offline copy from this computer? The archive itself is not changed.
                  </span>
                  <Button
                    type="button"
                    variant="destructive"
                    size="xs"
                    disabled={busy}
                    onClick={() => void clearOfflineCopy()}
                  >
                    Delete copy
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() => setConfirmingClear(false)}
                  >
                    Keep
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  disabled={busy}
                  onClick={() => setConfirmingClear(true)}
                >
                  Delete offline copy…
                </Button>
              )}
            </div>
          ) : null}
          {notifications && !notifications.supported ? (
            <p className="text-xs leading-snug text-muted-foreground">
              This system has no notification service available, so OpenKeep cannot
              show them. Import results stay visible in the app.
            </p>
          ) : null}
          {settings && !settings.trayAvailable ? (
            <p className="text-xs leading-snug text-muted-foreground">
              A usable system tray is unavailable, so closing the window quits
              OpenKeep to avoid leaving an invisible process.
            </p>
          ) : null}
          {message ? (
            <p className="text-xs leading-snug text-danger" role="alert">
              {message}
            </p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
