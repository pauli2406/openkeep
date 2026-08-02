import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueries, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  ArchiveImportResult,
  ArchiveSnapshot,
  ArchiveSnapshot as ArchiveSnapshotType,
  Correspondent,
  Document,
  DocumentType,
  HealthProvidersResponse,
  HealthResponse,
  ProcessingStatusResponse,
  ProviderConfig,
  ReadinessResponse,
  Tag,
  WatchFolderScanResponse,
} from "@openkeep/types";
import { authFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Copy,
  Shield,
  CheckCircle,
  AlertCircle,
  Loader2,
  } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useI18n, type AppLanguage } from "@/lib/i18n";

async function postAuthJson(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await authFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const json = (text ? JSON.parse(text) : {}) as Record<string, unknown>;
  if (!res.ok) {
    const message = json.message;
    const msg =
      typeof message === "string"
        ? message
        : Array.isArray(message)
          ? (message as string[]).join(", ")
          : "Request failed";
    throw new Error(msg);
  }
  return json;
}

export function TwoFactorSection() {
  const auth = useAuth();
  const enabled = auth.user?.twoFactorEnabled ?? false;

  const [enrollOpen, setEnrollOpen] = useState(false);
  const [step, setStep] = useState<"enrolling" | "codes">("enrolling");
  const [setupData, setSetupData] = useState<{
    secret: string;
    qrDataUrl: string;
    enrollmentToken: string;
  } | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);

  const [disableOpen, setDisableOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [disableCode, setDisableCode] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function startEnrollment() {
    setError("");
    setBusy(true);
    try {
      const data = await postAuthJson("/api/auth/2fa/setup", {});
      setSetupData({
        secret: String(data.secret),
        qrDataUrl: String(data.qrDataUrl),
        enrollmentToken: String(data.enrollmentToken),
      });
      setStep("enrolling");
      setEnrollOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start enrollment");
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnable(e: React.FormEvent) {
    e.preventDefault();
    if (!setupData) return;
    setError("");
    setBusy(true);
    try {
      const data = await postAuthJson("/api/auth/2fa/enable", {
        enrollmentToken: setupData.enrollmentToken,
        code: code.trim(),
      });
      setRecoveryCodes((data.recoveryCodes as string[]) ?? []);
      setStep("codes");
      setCode("");
      await auth.refreshUser();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid authentication code");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDisable(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await postAuthJson("/api/auth/2fa/disable", {
        password,
        code: disableCode.trim(),
      });
      await auth.refreshUser();
      setDisableOpen(false);
      setPassword("");
      setDisableCode("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disable two-factor");
    } finally {
      setBusy(false);
    }
  }

  function handleEnrollOpenChange(open: boolean) {
    if (!open) {
      setEnrollOpen(false);
      setStep("enrolling");
      setSetupData(null);
      setCode("");
      setRecoveryCodes([]);
      setError("");
    }
  }

  function handleDisableOpenChange(open: boolean) {
    setDisableOpen(open);
    if (!open) {
      setPassword("");
      setDisableCode("");
      setError("");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Shield className="h-5 w-5" />
          Two-Factor Authentication
        </CardTitle>
        <CardDescription>
          Protect your account with a time-based one-time code (TOTP) from an
          authenticator app in addition to your password.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            {enabled ? (
              <Badge variant="success">Enabled</Badge>
            ) : (
              <Badge variant="secondary">Disabled</Badge>
            )}
            <span className="text-sm text-muted-foreground">
              {enabled
                ? "Two-factor authentication is active on your account."
                : "Add a second factor for stronger protection."}
            </span>
          </div>

          {enabled ? (
            <Dialog open={disableOpen} onOpenChange={handleDisableOpenChange}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  Disable
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Disable two-factor authentication</DialogTitle>
                  <DialogDescription>
                    Confirm with your password and a current code (or a recovery code).
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={confirmDisable} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="disable-password">Password</Label>
                    <Input
                      id="disable-password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="disable-code">Authentication code</Label>
                    <Input
                      id="disable-code"
                      autoComplete="one-time-code"
                      placeholder="123456"
                      value={disableCode}
                      onChange={(e) => setDisableCode(e.target.value)}
                      required
                    />
                  </div>
                  {error && <p className="text-sm text-destructive">{error}</p>}
                  <DialogFooter>
                    <Button type="submit" variant="destructive" disabled={busy}>
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Disable"}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          ) : (
            <Button size="sm" onClick={() => void startEnrollment()} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Enable"}
            </Button>
          )}
        </div>

        {!enabled && error && !enrollOpen && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        <Dialog open={enrollOpen} onOpenChange={handleEnrollOpenChange}>
          <DialogContent>
            {step === "enrolling" && setupData ? (
              <>
                <DialogHeader>
                  <DialogTitle>Set up two-factor authentication</DialogTitle>
                  <DialogDescription>
                    Scan the QR code with your authenticator app, then enter the
                    6-digit code to confirm.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="flex justify-center">
                    {/* QR is a data URL generated by the server */}
                    <img
                      src={setupData.qrDataUrl}
                      alt="TOTP QR code"
                      className="h-48 w-48 rounded-md border bg-card p-2"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      Or enter this secret manually
                    </Label>
                    <code className="block break-all rounded-md border bg-muted p-2 text-xs">
                      {setupData.secret}
                    </code>
                  </div>
                  <form onSubmit={confirmEnable} className="space-y-3">
                    <div className="space-y-2">
                      <Label htmlFor="enable-code">6-digit code</Label>
                      <Input
                        id="enable-code"
                        autoComplete="one-time-code"
                        placeholder="123456"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        required
                      />
                    </div>
                    {error && <p className="text-sm text-destructive">{error}</p>}
                    <DialogFooter>
                      <Button type="submit" disabled={busy}>
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm & enable"}
                      </Button>
                    </DialogFooter>
                  </form>
                </div>
              </>
            ) : (
              <>
                <DialogHeader>
                  <DialogTitle>Save your recovery codes</DialogTitle>
                  <DialogDescription>
                    Store these somewhere safe. Each code works once and lets you
                    sign in if you lose access to your authenticator.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2 rounded-md border bg-muted p-3 font-mono text-sm">
                    {recoveryCodes.map((rc) => (
                      <span key={rc}>{rc}</span>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 rounded-md border border-[var(--ok-amber)]/30 bg-[var(--ok-amber-soft)] px-3 py-2 text-sm text-[var(--ok-amber)]">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    These codes are shown only once.
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigator.clipboard.writeText(recoveryCodes.join("\n"))}
                  >
                    <Copy className="h-4 w-4" />
                    Copy codes
                  </Button>
                </div>
                <DialogFooter>
                  <Button onClick={() => handleEnrollOpenChange(false)}>
                    <CheckCircle className="h-4 w-4" />
                    Done
                  </Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

