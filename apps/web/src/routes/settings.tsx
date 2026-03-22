import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { HealthResponse, ProcessingStatusResponse, ReadinessResponse } from "@openkeep/types";
import { api } from "@/lib/api";
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
import { Separator } from "@/components/ui/separator";
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
  Key,
  Plus,
  Trash2,
  Copy,
  Shield,
  Server,
  CheckCircle,
  AlertCircle,
  Loader2,
  Activity,
  Layers,
  RefreshCw,
} from "lucide-react";
import { format } from "date-fns";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

interface ApiToken {
  id: string;
  name: string;
  tokenPrefix: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

interface TokensResponse {
  tokens: ApiToken[];
}

interface CreateTokenResponse {
  token: string;
  id: string;
  name: string;
}

function SettingsPage() {
  const auth = useAuth();
  const queryClient = useQueryClient();

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Manage your account and system configuration
        </p>
      </div>

      {/* User Profile */}
      <UserProfileSection />

      <Separator />

      {/* API Tokens */}
      <ApiTokensSection />

      <Separator />

      {/* Processing Activity */}
      <ProcessingActivitySection />

      <Separator />

      {/* System Health */}
      <SystemHealthSection />
    </div>
  );
}

function UserProfileSection() {
  const auth = useAuth();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Shield className="h-5 w-5" />
          User Profile
        </CardTitle>
        <CardDescription>Your account information</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              Display Name
            </Label>
            <p className="text-sm font-medium">
              {auth.user?.displayName ?? "Unknown"}
            </p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Email</Label>
            <p className="text-sm font-medium">
              {auth.user?.email ?? "Unknown"}
            </p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Role</Label>
            <div>
              {auth.user?.isOwner ? (
                <Badge variant="default">Owner</Badge>
              ) : (
                <Badge variant="secondary">User</Badge>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ApiTokensSection() {
  const queryClient = useQueryClient();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [tokenName, setTokenName] = useState("");
  const [tokenExpiry, setTokenExpiry] = useState("");
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const tokensQuery = useQuery({
    queryKey: ["auth", "tokens"],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/auth/tokens" as never);
      if (error) throw new Error("Failed to fetch tokens");
      return data as unknown as TokensResponse;
    },
  });

  const createMutation = useMutation({
    mutationFn: async (params: { name: string; expiresAt?: string }) => {
      const body: Record<string, unknown> = { name: params.name };
      if (params.expiresAt) {
        body.expiresAt = params.expiresAt;
      }
      const { data, error } = await api.POST("/api/auth/tokens" as never, {
        body,
      } as never);
      if (error) throw new Error("Failed to create token");
      return data as unknown as CreateTokenResponse;
    },
    onSuccess: (data) => {
      setGeneratedToken(data.token);
      setTokenName("");
      setTokenExpiry("");
      queryClient.invalidateQueries({ queryKey: ["auth", "tokens"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await api.DELETE(
        "/api/auth/tokens/{id}" as never,
        { params: { path: { id } } } as never,
      );
      if (error) throw new Error("Failed to delete token");
    },
    onSuccess: () => {
      setDeleteConfirmId(null);
      queryClient.invalidateQueries({ queryKey: ["auth", "tokens"] });
    },
  });

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!tokenName.trim()) return;
    createMutation.mutate({
      name: tokenName.trim(),
      expiresAt: tokenExpiry || undefined,
    });
  }

  function handleCopy() {
    if (generatedToken) {
      navigator.clipboard.writeText(generatedToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  function handleDialogClose(open: boolean) {
    if (!open) {
      setGeneratedToken(null);
      setTokenName("");
      setTokenExpiry("");
      setCopied(false);
      createMutation.reset();
    }
    setCreateDialogOpen(open);
  }

  const tokens = tokensQuery.data?.tokens ?? [];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Key className="h-5 w-5" />
              API Tokens
            </CardTitle>
            <CardDescription>
              Manage API tokens for programmatic access
            </CardDescription>
          </div>
          <Dialog open={createDialogOpen} onOpenChange={handleDialogClose}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4" />
                Create Token
              </Button>
            </DialogTrigger>
            <DialogContent>
              {generatedToken ? (
                <>
                  <DialogHeader>
                    <DialogTitle>Token Created</DialogTitle>
                    <DialogDescription>
                      Copy this token now. It will not be shown again.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 rounded-md border bg-muted p-3">
                        <code className="break-all text-sm">
                          {generatedToken}
                        </code>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCopy}
                        className="shrink-0"
                      >
                        {copied ? (
                          <CheckCircle className="h-4 w-4 text-emerald-500" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      This token will only be shown once. Store it securely.
                    </div>
                  </div>
                  <DialogFooter>
                    <Button onClick={() => handleDialogClose(false)}>
                      Done
                    </Button>
                  </DialogFooter>
                </>
              ) : (
                <>
                  <DialogHeader>
                    <DialogTitle>Create API Token</DialogTitle>
                    <DialogDescription>
                      Create a new token for API access
                    </DialogDescription>
                  </DialogHeader>
                  <form onSubmit={handleCreate} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="token-name">Name</Label>
                      <Input
                        id="token-name"
                        value={tokenName}
                        onChange={(e) => setTokenName(e.target.value)}
                        placeholder="e.g. CI/CD Pipeline"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="token-expiry">
                        Expiry date (optional)
                      </Label>
                      <Input
                        id="token-expiry"
                        type="date"
                        value={tokenExpiry}
                        onChange={(e) => setTokenExpiry(e.target.value)}
                        min={format(new Date(), "yyyy-MM-dd")}
                      />
                    </div>
                    {createMutation.isError && (
                      <p className="text-sm text-destructive">
                        Failed to create token. Please try again.
                      </p>
                    )}
                    <DialogFooter>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => handleDialogClose(false)}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        disabled={
                          createMutation.isPending || !tokenName.trim()
                        }
                      >
                        {createMutation.isPending ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Creating...
                          </>
                        ) : (
                          "Create"
                        )}
                      </Button>
                    </DialogFooter>
                  </form>
                </>
              )}
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {tokensQuery.isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {tokensQuery.isError && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
            Failed to load tokens.
          </div>
        )}

        {tokensQuery.data && tokens.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Key className="h-8 w-8 text-muted-foreground/40" />
            <p className="mt-2 text-sm text-muted-foreground">
              No API tokens created yet
            </p>
          </div>
        )}

        {tokens.length > 0 && (
          <div className="space-y-3">
            {tokens.map((token) => (
              <div
                key={token.id}
                className="flex items-center justify-between rounded-lg border p-3"
              >
                <div className="space-y-1">
                  <p className="text-sm font-medium">{token.name}</p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="font-mono">{token.tokenPrefix}...</span>
                    {token.lastUsedAt && (
                      <span>
                        Last used:{" "}
                        {format(new Date(token.lastUsedAt), "MMM d, yyyy")}
                      </span>
                    )}
                    {!token.lastUsedAt && <span>Never used</span>}
                    {token.expiresAt && (
                      <span>
                        Expires:{" "}
                        {format(new Date(token.expiresAt), "MMM d, yyyy")}
                      </span>
                    )}
                    {!token.expiresAt && <span>No expiry</span>}
                  </div>
                </div>

                {deleteConfirmId === token.id ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      Delete?
                    </span>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => deleteMutation.mutate(token.id)}
                      disabled={deleteMutation.isPending}
                    >
                      {deleteMutation.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        "Yes"
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDeleteConfirmId(null)}
                    >
                      No
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => setDeleteConfirmId(token.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                    <span className="sr-only">Delete</span>
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// --- Processing Activity & Queue Status ---

function jobStatusVariant(
  status: string,
): "default" | "secondary" | "destructive" | "success" | "warning" {
  switch (status) {
    case "completed":
      return "success";
    case "running":
      return "warning";
    case "queued":
      return "secondary";
    case "failed":
      return "destructive";
    default:
      return "default";
  }
}

function queueLabel(queueName: string): string {
  if (queueName === "document.process") return "OCR / Parse";
  if (queueName === "document.embed") return "Embedding";
  return queueName;
}

function ProcessingActivitySection() {
  const statusQuery = useQuery({
    queryKey: ["health", "status"],
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/health/status");
      if (!response.ok || error || !data) {
        throw error ?? new Error("Failed to fetch status");
      }
      return data as ProcessingStatusResponse;
    },
    refetchInterval: 5000,
  });

  const data = statusQuery.data;

  const totalDocs = data
    ? Object.values(data.documents.byStatus).reduce((a, b) => a + b, 0)
    : 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Activity className="h-5 w-5" />
              Processing Activity
            </CardTitle>
            <CardDescription>
              Queue depths, document status breakdown, and recent jobs
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => statusQuery.refetch()}
            disabled={statusQuery.isFetching}
          >
            <RefreshCw
              className={`h-4 w-4 ${statusQuery.isFetching ? "animate-spin" : ""}`}
            />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {statusQuery.isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {statusQuery.isError && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            Failed to load processing status.
          </div>
        )}

        {data && (
          <>
            {/* Queue depths + Document counts */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <QueueCard
                label="OCR Queue"
                value={data.queues.processing.depth}
                active={data.queues.processing.depth > 0}
              />
              <QueueCard
                label="Embed Queue"
                value={data.queues.embedding.depth}
                active={data.queues.embedding.depth > 0}
              />
              <QueueCard
                label="Total Docs"
                value={totalDocs}
                active={false}
              />
              <QueueCard
                label="Pending Review"
                value={data.documents.pendingReview}
                active={data.documents.pendingReview > 0}
                variant="warning"
              />
            </div>

            {/* Document status breakdown */}
            {Object.keys(data.documents.byStatus).length > 0 && (
              <div>
                <p className="mb-2 text-sm font-medium">Documents by Status</p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(data.documents.byStatus).map(
                    ([status, count]) => (
                      <div
                        key={status}
                        className="flex items-center gap-1.5 rounded-md border px-2.5 py-1"
                      >
                        <div
                          className={`h-2 w-2 rounded-full ${
                            status === "ready"
                              ? "bg-emerald-500"
                              : status === "processing"
                                ? "bg-amber-500 animate-pulse"
                                : status === "pending"
                                  ? "bg-blue-400"
                                  : status === "failed"
                                    ? "bg-red-500"
                                    : "bg-gray-400"
                          }`}
                        />
                        <span className="text-xs font-medium capitalize">
                          {status}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {count}
                        </span>
                      </div>
                    ),
                  )}
                </div>
              </div>
            )}

            <Separator />

            {/* Recent jobs */}
            <div>
              <p className="mb-2 text-sm font-medium">Recent Jobs</p>
              {data.recentJobs.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  No processing jobs yet.
                </p>
              ) : (
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {data.recentJobs.map((job) => (
                    <div
                      key={job.id}
                      className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Badge variant={jobStatusVariant(job.status)}>
                            {job.status}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {queueLabel(job.queueName)}
                          </span>
                        </div>
                        {job.lastError && (
                          <p className="mt-1 truncate text-xs text-destructive">
                            {job.lastError}
                          </p>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-xs text-muted-foreground font-mono">
                          {job.documentId.slice(0, 8)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatJobTime(job.createdAt)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function QueueCard({
  label,
  value,
  active,
  variant,
}: {
  label: string;
  value: number;
  active: boolean;
  variant?: "warning";
}) {
  return (
    <div
      className={`rounded-lg border p-3 text-center transition-colors ${
        active
          ? variant === "warning"
            ? "border-amber-200 bg-amber-50/50"
            : "border-primary/30 bg-primary/5"
          : ""
      }`}
    >
      <p
        className={`text-2xl font-bold tabular-nums ${
          active
            ? variant === "warning"
              ? "text-amber-600"
              : "text-primary"
            : "text-foreground"
        }`}
      >
        {value}
      </p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function formatJobTime(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    return format(date, "MMM d, HH:mm");
  } catch {
    return dateStr;
  }
}

// --- System Health ---

function SystemHealthSection() {
  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/health");
      if (!response.ok || error || !data) {
        throw error ?? new Error("Failed to fetch health");
      }
      return data as HealthResponse;
    },
    refetchInterval: 30000,
  });

  const readinessQuery = useQuery({
    queryKey: ["health", "ready"],
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/health/ready");
      if (!response.ok || error || !data) {
        throw error ?? new Error("Failed to fetch readiness");
      }
      return data as ReadinessResponse;
    },
    refetchInterval: 30000,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Server className="h-5 w-5" />
          System Health
        </CardTitle>
        <CardDescription>Server status and readiness checks</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Health status */}
        {healthQuery.isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking health...
          </div>
        )}

        {healthQuery.isError && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            Unable to reach server
          </div>
        )}

        {healthQuery.data && (
          <div className="flex items-center gap-3">
            <div
              className={`h-3 w-3 rounded-full ${
                healthQuery.data.status === "ok" ||
                healthQuery.data.status === "healthy"
                  ? "bg-emerald-500"
                  : "bg-amber-500"
              }`}
            />
            <div>
              <p className="text-sm font-medium">
                Server:{" "}
                <span className="capitalize">{healthQuery.data.status}</span>
              </p>
            </div>
          </div>
        )}

        {/* Readiness checks */}
        {readinessQuery.isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Running readiness checks...
          </div>
        )}

        {readinessQuery.data && readinessQuery.data.checks && (
          <>
            <Separator />
            <div>
              <p className="mb-2 text-sm font-medium">Readiness Checks</p>
              <div className="space-y-2">
                {Object.entries(readinessQuery.data.checks).map(
                  ([name, healthy]) => (
                    <div
                      key={name}
                      className="flex items-center justify-between rounded-md border px-3 py-2"
                    >
                      <div className="flex items-center gap-2">
                        {healthy ? (
                          <CheckCircle className="h-4 w-4 text-emerald-500" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-destructive" />
                        )}
                        <span className="text-sm capitalize">{name}</span>
                      </div>
                      <Badge variant={healthy ? "success" : "destructive"}>
                        {healthy ? "ok" : "fail"}
                      </Badge>
                    </div>
                  ),
                )}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
