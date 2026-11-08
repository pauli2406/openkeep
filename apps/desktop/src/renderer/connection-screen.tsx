import { useEffect, useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type {
  DesktopBridge,
  DesktopProfileSummary,
  DesktopProfilesSnapshot,
  DesktopSessionState,
} from "../shared/desktop-api";
import { DesktopAuthSurface } from "./desktop-auth-surface";
import { ArrowRightIcon, ChevronRightIcon } from "./desktop-icons";

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
      <DesktopAuthSurface
        labelledBy="connect-title"
        title={<>We could not reach {unavailable.profile.label}</>}
        description={message || unavailable.message}
        footerTone="warning"
        footer={<span>Credentials remain encrypted for retry</span>}
      >
        <div className="grid grid-cols-2 gap-2.5">
          <Button type="button" size="lg" onClick={() => void retry()} disabled={status === "checking"}>
            {status === "checking" ? <Spinner /> : null}
            {status === "checking" ? "Retrying…" : "Retry connection"}
          </Button>
          <Button type="button" variant="outline" size="lg" onClick={() => setEditing(true)}>
            Edit connection
          </Button>
        </div>
      </DesktopAuthSurface>
    );
  }

  return (
    <DesktopAuthSurface
      labelledBy="connect-title"
      title={editingProfile ? "Edit archive connection" : "Connect your archive"}
      description="Use an API token from your OpenKeep profile. Credentials are encrypted by your operating system and never enter the web interface."
      footer={
        <>
          <span>{version || "Desktop runtime"}</span>
          <span aria-hidden="true">·</span>
          <span>OS-encrypted credentials</span>
        </>
      }
    >
      <form onSubmit={(event) => void connect(event)}>
        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel htmlFor="profile-label">Profile name</FieldLabel>
            <Input
              id="profile-label"
              name="profile-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Home archive"
              maxLength={120}
              disabled={status === "checking"}
              className="h-10"
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="server-url">Archive address</FieldLabel>
            <Input
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
              className="h-10"
            />
          </Field>

          <Field>
            <div className="flex items-center justify-between gap-2">
              <FieldLabel htmlFor="api-token">API token</FieldLabel>
              <Button
                type="button"
                variant="link"
                size="xs"
                className="h-auto px-0 text-brand"
                onClick={() => setRevealToken((current) => !current)}
              >
                {revealToken ? "Hide" : "Reveal"}
              </Button>
            </div>
            <Input
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
              className="h-10 font-mono placeholder:font-sans"
            />
          </Field>

          <Collapsible open={cfOpen} onOpenChange={setCfOpen} className="rounded-lg border">
            <CollapsibleTrigger className="group/advanced flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50">
              <ChevronRightIcon className="size-4 text-muted-foreground transition-transform group-data-open/advanced:rotate-90" />
              Cloudflare Access
              <Badge variant="secondary" className="ml-auto font-normal">
                Optional
              </Badge>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <FieldGroup className="gap-3 border-t p-3">
                <Field>
                  <FieldLabel htmlFor="cf-client-id">Client ID</FieldLabel>
                  <Input
                    id="cf-client-id"
                    value={cfAccessClientId}
                    onChange={(event) => setCfAccessClientId(event.target.value)}
                    autoCapitalize="none"
                    autoCorrect="off"
                    disabled={status === "checking"}
                    placeholder="xxxxxxxx.access"
                    className="h-9 font-mono"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="cf-client-secret">Client secret</FieldLabel>
                  <Input
                    id="cf-client-secret"
                    type="password"
                    value={cfAccessClientSecret}
                    onChange={(event) => setCfAccessClientSecret(event.target.value)}
                    autoCapitalize="none"
                    autoCorrect="off"
                    disabled={status === "checking"}
                    className="h-9 font-mono"
                  />
                </Field>
              </FieldGroup>
            </CollapsibleContent>
          </Collapsible>

          {message ? (
            <p id="connection-error" className="text-sm text-danger" role="alert">
              {message}
            </p>
          ) : (
            <p id="connection-note" className="text-xs text-muted-foreground">
              HTTPS is recommended. Localhost HTTP is available for development.
            </p>
          )}

          <div className="flex flex-col gap-2">
            <Button type="submit" size="lg" className="w-full" disabled={status === "checking"}>
              {status === "checking" ? <Spinner /> : null}
              {status === "checking"
                ? "Verifying archive"
                : allowInsecureHttp
                  ? "Connect over plaintext HTTP"
                  : "Connect archive"}
              {status === "checking" ? null : <ArrowRightIcon className="size-4" />}
            </Button>
            {editingProfile && label.trim() !== editingProfile.label ? (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => void renameProfile()}
                disabled={status === "checking" || !label.trim()}
              >
                Save profile name only
              </Button>
            ) : null}
            {onCancel ? (
              <Button
                type="button"
                variant="ghost"
                className="w-full text-muted-foreground"
                onClick={onCancel}
                disabled={status === "checking"}
              >
                Cancel
              </Button>
            ) : null}
          </div>
        </FieldGroup>
      </form>
    </DesktopAuthSurface>
  );
}
