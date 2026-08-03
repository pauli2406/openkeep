import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
  Key,
  Plus,
  Trash2,
  Copy,
  CheckCircle,
  AlertCircle,
  Loader2,
  } from "lucide-react";
import { format } from "date-fns";
import { useI18n } from "@/lib/i18n";
import { ApiToken, CreateTokenResponse } from "./shared";

export function ApiTokensSection() {
  const { t } = useI18n();
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
      const { data, error } = await api.GET("/api/auth/tokens", {});
      if (error) throw new Error(t("settings.failedToFetchTokens"));
      return (data ?? []) as ApiToken[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (params: { name: string; expiresAt?: string }) => {
      const body: { name: string; expiresAt?: string } = { name: params.name };
      if (params.expiresAt) {
        body.expiresAt = params.expiresAt;
      }
      const { data, error } = await api.POST("/api/auth/tokens", {
        body,
      });
      if (error) throw new Error(t("settings.failedToCreateToken"));
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
      const { error } = await api.DELETE("/api/auth/tokens/{id}", {
        params: { path: { id } },
      });
      if (error) throw new Error(t("settings.failedToDeleteToken"));
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

  const tokens = tokensQuery.data ?? [];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Key className="h-5 w-5" />
              {t("settings.apiTokensTitle")}
            </CardTitle>
            <CardDescription>
              {t("settings.apiTokensDescription")}
            </CardDescription>
          </div>
          <Dialog open={createDialogOpen} onOpenChange={handleDialogClose}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4" />
                {t("settings.createToken")}
              </Button>
            </DialogTrigger>
            <DialogContent>
              {generatedToken ? (
                <>
                  <DialogHeader>
                    <DialogTitle>{t("settings.tokenCreated")}</DialogTitle>
                    <DialogDescription>
                      {t("settings.tokenCreatedDescription")}
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
                          <CheckCircle className="h-4 w-4 text-[var(--ok-green)]" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    <div className="flex items-center gap-2 rounded-md border border-[var(--ok-amber)]/30 bg-[var(--ok-amber-soft)] px-3 py-2 text-sm text-[var(--ok-amber)]">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      {t("settings.tokenShownOnce")}
                    </div>
                  </div>
                  <DialogFooter>
                    <Button onClick={() => handleDialogClose(false)}>
                      {t("settings.done")}
                    </Button>
                  </DialogFooter>
                </>
              ) : (
                <>
                  <DialogHeader>
                    <DialogTitle>{t("settings.createApiToken")}</DialogTitle>
                    <DialogDescription>
                      {t("settings.createApiTokenDescription")}
                    </DialogDescription>
                  </DialogHeader>
                  <form onSubmit={handleCreate} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="token-name">{t("settings.name")}</Label>
                      <Input
                        id="token-name"
                        value={tokenName}
                        onChange={(e) => setTokenName(e.target.value)}
                        placeholder={t("settings.tokenNamePlaceholder")}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="token-expiry">
                        {t("settings.expiryOptional")}
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
                        {t("settings.createTokenFailed")}
                      </p>
                    )}
                    <DialogFooter>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => handleDialogClose(false)}
                      >
                        {t("settings.cancel")}
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
                            {t("settings.creating")}
                          </>
                        ) : (
                          t("settings.create")
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
            {t("settings.loadTokensFailed")}
          </div>
        )}

        {tokensQuery.data && tokens.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Key className="h-8 w-8 text-muted-foreground/40" />
            <p className="mt-2 text-sm text-muted-foreground">
              {t("settings.noApiTokens")}
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
                        {t("settings.lastUsed")}:{" "}
                        <span className="ok-num">{format(new Date(token.lastUsedAt), "MMM d, yyyy")}</span>
                      </span>
                    )}
                    {!token.lastUsedAt && <span>{t("settings.neverUsed")}</span>}
                    {token.expiresAt && (
                      <span>
                        {t("settings.expires")}:{" "}
                        <span className="ok-num">{format(new Date(token.expiresAt), "MMM d, yyyy")}</span>
                      </span>
                    )}
                    {!token.expiresAt && <span>{t("settings.noExpiry")}</span>}
                  </div>
                </div>

                {deleteConfirmId === token.id ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {t("settings.deleteConfirm")}
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
                        t("settings.yes")
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDeleteConfirmId(null)}
                    >
                      {t("settings.no")}
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
                    <span className="sr-only">{t("settings.delete")}</span>
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

