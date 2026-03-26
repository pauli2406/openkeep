import { useEffect, useState } from "react";
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
import { api, getApiErrorMessage } from "@/lib/api";
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
  Shield,
  Server,
  CheckCircle,
  AlertCircle,
  Loader2,
  Activity,
  Layers,
  RefreshCw,
  Edit2,
  Download,
  Upload,
  Tags,
  Users,
  FileType,
  Check,
  X,
  FolderSearch,
  Brain,
} from "lucide-react";
import { format } from "date-fns";
import { useAuth } from "@/hooks/use-auth";
import { useI18n, type AppLanguage } from "@/lib/i18n";

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

interface CreateTokenResponse {
  token: string;
  id: string;
  name: string;
}

type TaxonomyEntity = Tag | Correspondent | DocumentType;
type TaxonomyKind = "tags" | "correspondents" | "document-types";
type Translate = ReturnType<typeof useI18n>["t"];

async function listTaxonomy(kind: TaxonomyKind, t: Translate): Promise<TaxonomyEntity[]> {
  switch (kind) {
    case "tags": {
      const { data, error } = await api.GET("/api/taxonomies/tags", {});
      if (error) {
        throw new Error(getApiErrorMessage(error, t("settings.failedToLoadTags")));
      }
      return (data ?? []) as Tag[];
    }
    case "correspondents": {
      const { data, error } = await api.GET("/api/taxonomies/correspondents", {});
      if (error) {
        throw new Error(getApiErrorMessage(error, t("settings.failedToLoadCorrespondents")));
      }
      return (data ?? []) as Correspondent[];
    }
    case "document-types": {
      const { data, error } = await api.GET("/api/taxonomies/document-types", {});
      if (error) {
        throw new Error(getApiErrorMessage(error, t("settings.failedToLoadDocumentTypes")));
      }
      return (data ?? []) as DocumentType[];
    }
  }
}

async function createTaxonomy(kind: TaxonomyKind, name: string, t: Translate): Promise<void> {
  switch (kind) {
    case "tags": {
      const { error } = await api.POST("/api/taxonomies/tags", { body: { name } });
      if (error) {
        throw new Error(getApiErrorMessage(error, t("settings.failedToCreateTag")));
      }
      return;
    }
    case "correspondents": {
      const { error } = await api.POST("/api/taxonomies/correspondents", { body: { name } });
      if (error) {
        throw new Error(getApiErrorMessage(error, t("settings.failedToCreateCorrespondent")));
      }
      return;
    }
    case "document-types": {
      const { error } = await api.POST("/api/taxonomies/document-types", { body: { name } });
      if (error) {
        throw new Error(getApiErrorMessage(error, t("settings.failedToCreateDocumentType")));
      }
      return;
    }
  }
}

async function updateTaxonomy(kind: TaxonomyKind, id: string, name: string, t: Translate): Promise<void> {
  switch (kind) {
    case "tags": {
      const { error } = await api.PATCH("/api/taxonomies/tags/{id}", {
        params: { path: { id } },
        body: { name },
      });
      if (error) {
        throw new Error(getApiErrorMessage(error, t("settings.failedToUpdateTag")));
      }
      return;
    }
    case "correspondents": {
      const { error } = await api.PATCH("/api/taxonomies/correspondents/{id}", {
        params: { path: { id } },
        body: { name },
      });
      if (error) {
        throw new Error(getApiErrorMessage(error, t("settings.failedToUpdateCorrespondent")));
      }
      return;
    }
    case "document-types": {
      const { error } = await api.PATCH("/api/taxonomies/document-types/{id}", {
        params: { path: { id } },
        body: { name },
      });
      if (error) {
        throw new Error(getApiErrorMessage(error, t("settings.failedToUpdateDocumentType")));
      }
      return;
    }
  }
}

async function deleteTaxonomy(kind: TaxonomyKind, id: string, t: Translate): Promise<void> {
  switch (kind) {
    case "tags": {
      const { error } = await api.DELETE("/api/taxonomies/tags/{id}", {
        params: { path: { id } },
      });
      if (error) {
        throw new Error(getApiErrorMessage(error, t("settings.failedToDeleteTag")));
      }
      return;
    }
    case "correspondents": {
      const { error } = await api.DELETE("/api/taxonomies/correspondents/{id}", {
        params: { path: { id } },
      });
      if (error) {
        throw new Error(getApiErrorMessage(error, t("settings.failedToDeleteCorrespondent")));
      }
      return;
    }
    case "document-types": {
      const { error } = await api.DELETE("/api/taxonomies/document-types/{id}", {
        params: { path: { id } },
      });
      if (error) {
        throw new Error(getApiErrorMessage(error, t("settings.failedToDeleteDocumentType")));
      }
      return;
    }
  }
}

async function mergeTaxonomy(kind: TaxonomyKind, id: string, targetId: string, t: Translate): Promise<void> {
  switch (kind) {
    case "tags": {
      const { error } = await api.POST("/api/taxonomies/tags/{id}/merge", {
        params: { path: { id } },
        body: { targetId },
      });
      if (error) {
        throw new Error(getApiErrorMessage(error, t("settings.failedToMergeTag")));
      }
      return;
    }
    case "correspondents": {
      const { error } = await api.POST("/api/taxonomies/correspondents/{id}/merge", {
        params: { path: { id } },
        body: { targetId },
      });
      if (error) {
        throw new Error(getApiErrorMessage(error, t("settings.failedToMergeCorrespondent")));
      }
      return;
    }
    case "document-types": {
      const { error } = await api.POST("/api/taxonomies/document-types/{id}/merge", {
        params: { path: { id } },
        body: { targetId },
      });
      if (error) {
        throw new Error(getApiErrorMessage(error, t("settings.failedToMergeDocumentType")));
      }
      return;
    }
  }
}

function SettingsPage() {
  const { t } = useI18n();

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t("settings.title")}</h1>
        <p className="text-muted-foreground">
          {t("settings.subtitle")}
        </p>
      </div>

      {/* User Profile */}
      <UserProfileSection />

      <Separator />

      <LanguagePreferencesSection />

      <Separator />

      {/* API Tokens */}
      <ApiTokensSection />

      <Separator />

      <TaxonomyManagementSection />

      <Separator />

      <ArchiveOperationsSection />

      <Separator />

      {/* Processing Activity */}
      <ProcessingActivitySection />

      <Separator />

      {/* AI & Providers */}
      <AiProvidersSection />

      <Separator />

      {/* System Health */}
      <SystemHealthSection />
    </div>
  );
}

function LanguagePreferencesSection() {
  const auth = useAuth();
  const { t } = useI18n();
  const [preferences, setPreferences] = useState(
    auth.user?.preferences ?? {
      uiLanguage: "en" as const,
      aiProcessingLanguage: "en" as const,
      aiChatLanguage: "en" as const,
    },
  );
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"default" | "destructive">("default");

  useEffect(() => {
    if (auth.user?.preferences) {
      setPreferences(auth.user.preferences);
    }
  }, [auth.user?.preferences]);

  async function handleSave() {
    setIsSaving(true);
    setStatusMessage(null);

    try {
      await auth.updatePreferences(preferences);
      setStatusTone("default");
      setStatusMessage(t("settings.preferencesSaved"));
    } catch (error) {
      setStatusTone("destructive");
      setStatusMessage(
        error instanceof Error ? error.message : t("settings.preferencesSaveFailed"),
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Brain className="h-5 w-5" />
          {t("settings.languagePreferences")}
        </CardTitle>
        <CardDescription>{t("settings.languagePreferencesDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label>{t("settings.uiLanguage")}</Label>
            <Select
              value={preferences.uiLanguage}
              onValueChange={(value: "en" | "de") =>
                setPreferences((current) => ({ ...current, uiLanguage: value }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">{t("settings.english")}</SelectItem>
                <SelectItem value="de">{t("settings.german")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t("settings.aiProcessingLanguage")}</Label>
            <Select
              value={preferences.aiProcessingLanguage}
              onValueChange={(value: "en" | "de") =>
                setPreferences((current) => ({ ...current, aiProcessingLanguage: value }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">{t("settings.english")}</SelectItem>
                <SelectItem value="de">{t("settings.german")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t("settings.aiChatLanguage")}</Label>
            <Select
              value={preferences.aiChatLanguage}
              onValueChange={(value: "en" | "de") =>
                setPreferences((current) => ({ ...current, aiChatLanguage: value }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">{t("settings.english")}</SelectItem>
                <SelectItem value="de">{t("settings.german")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={() => void handleSave()} disabled={isSaving}>
            {isSaving ? t("settings.saving") : t("settings.savePreferences")}
          </Button>
          {statusMessage ? (
            <p className={`text-sm ${statusTone === "destructive" ? "text-destructive" : "text-muted-foreground"}`}>
              {statusMessage}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function UserProfileSection() {
  const auth = useAuth();
  const { t } = useI18n();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Shield className="h-5 w-5" />
          {t("settings.userProfile")}
        </CardTitle>
        <CardDescription>{t("settings.accountInfo")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              {t("settings.displayName")}
            </Label>
            <p className="text-sm font-medium">
              {auth.user?.displayName ?? t("settings.unknown")}
            </p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{t("settings.email")}</Label>
            <p className="text-sm font-medium">
              {auth.user?.email ?? t("settings.unknown")}
            </p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{t("settings.role")}</Label>
            <div>
              {auth.user?.isOwner ? (
                <Badge variant="default">{t("settings.owner")}</Badge>
              ) : (
                <Badge variant="secondary">{t("settings.user")}</Badge>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ApiTokensSection() {
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
                          <CheckCircle className="h-4 w-4 text-emerald-500" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
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
                        {format(new Date(token.lastUsedAt), "MMM d, yyyy")}
                      </span>
                    )}
                    {!token.lastUsedAt && <span>{t("settings.neverUsed")}</span>}
                    {token.expiresAt && (
                      <span>
                        {t("settings.expires")}:{" "}
                        {format(new Date(token.expiresAt), "MMM d, yyyy")}
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

function TaxonomyManagementSection() {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Layers className="h-5 w-5" />
          {t("settings.taxonomyManagement")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("settings.taxonomyManagementDescription")}
        </p>
      </div>

      <div className="space-y-4">
        <TaxonomySection
          kind="tags"
          title={t("settings.tags")}
          description={t("settings.tagsDescription")}
        />
        <TaxonomySection
          kind="correspondents"
          title={t("settings.correspondents")}
          description={t("settings.correspondentsDescription")}
        />
        <TaxonomySection
          kind="document-types"
          title={t("settings.documentTypes")}
          description={t("settings.documentTypesDescription")}
        />
      </div>
    </div>
  );
}

function TaxonomySection({
  kind,
  title,
  description,
}: {
  kind: TaxonomyKind;
  title: string;
  description: string;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [mergeSourceId, setMergeSourceId] = useState<string | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState<string>("");

  const listQuery = useQuery({
    queryKey: ["taxonomies", kind],
    queryFn: () => listTaxonomy(kind, t),
  });

  const createMutation = useMutation({
    mutationFn: (name: string) => createTaxonomy(kind, name, t),
    onSuccess: () => {
      setNewName("");
      queryClient.invalidateQueries({ queryKey: ["taxonomies", kind] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (params: { id: string; name: string }) =>
      updateTaxonomy(kind, params.id, params.name, t),
    onSuccess: () => {
      setEditingId(null);
      setEditingName("");
      queryClient.invalidateQueries({ queryKey: ["taxonomies", kind] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteTaxonomy(kind, id, t),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["taxonomies", kind] });
    },
  });

  const mergeMutation = useMutation({
    mutationFn: (params: { id: string; targetId: string }) =>
      mergeTaxonomy(kind, params.id, params.targetId, t),
    onSuccess: () => {
      setMergeSourceId(null);
      setMergeTargetId("");
      queryClient.invalidateQueries({ queryKey: ["taxonomies", kind] });
    },
  });

  const items = listQuery.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!newName.trim()) {
              return;
            }
            createMutation.mutate(newName.trim());
          }}
        >
          <Input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder={t("settings.createItemPlaceholder")}
          />
          <Button
            type="submit"
            disabled={createMutation.isPending || !newName.trim()}
          >
            {createMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Plus className="h-4 w-4" />
                {t("settings.add")}
              </>
            )}
          </Button>
        </form>

        {createMutation.isError && (
          <p className="text-sm text-destructive">
            {createMutation.error instanceof Error
              ? createMutation.error.message
              : t("settings.createItemFailed")}
          </p>
        )}

        {listQuery.isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {listQuery.isError && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {t("settings.loadItemsFailed")}
          </div>
        )}

        {listQuery.isSuccess && items.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {t("settings.noItemsCreated")}
          </p>
        )}

        {items.length > 0 && (
          <div className="space-y-2">
            {items.map((item) => (
              <div key={item.id} className="rounded-lg border p-3">
                {editingId === item.id ? (
                  <div className="space-y-3">
                    <Input
                      value={editingName}
                      onChange={(event) => setEditingName(event.target.value)}
                      aria-label={`${title} ${t("settings.nameSuffix")}`}
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() =>
                          updateMutation.mutate({
                            id: item.id,
                            name: editingName.trim(),
                          })
                        }
                        disabled={updateMutation.isPending || !editingName.trim()}
                      >
                        {updateMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          t("settings.save")
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditingId(null);
                          setEditingName("");
                        }}
                      >
                        {t("settings.cancel")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{item.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.slug}
                        {"description" in item && item.description
                          ? ` · ${item.description}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditingId(item.id);
                          setEditingName(item.name);
                        }}
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                        {t("settings.edit")}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setMergeSourceId(item.id);
                          setMergeTargetId(
                            items.find((candidate) => candidate.id !== item.id)?.id ?? "",
                          );
                        }}
                        disabled={items.length < 2}
                      >
                        {t("settings.merge")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => deleteMutation.mutate(item.id)}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                        {t("settings.delete")}
                      </Button>
                    </div>
                  </div>
                )}

                {mergeSourceId === item.id && editingId !== item.id && (
                  <div className="mt-3 space-y-3 rounded-md border bg-muted/30 p-3">
                    <div className="space-y-2">
                      <Label>{t("settings.mergeInto")}</Label>
                      <Select value={mergeTargetId} onValueChange={setMergeTargetId}>
                        <SelectTrigger>
                          <SelectValue placeholder={t("settings.selectTarget")} />
                        </SelectTrigger>
                        <SelectContent>
                          {items
                            .filter((candidate) => candidate.id !== item.id)
                            .map((candidate) => (
                              <SelectItem key={candidate.id} value={candidate.id}>
                                {candidate.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() =>
                          mergeMutation.mutate({
                            id: item.id,
                            targetId: mergeTargetId,
                          })
                        }
                        disabled={mergeMutation.isPending || !mergeTargetId}
                      >
                        {mergeMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          t("settings.confirmMerge")
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setMergeSourceId(null);
                          setMergeTargetId("");
                        }}
                      >
                        {t("settings.cancel")}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {(updateMutation.isError || deleteMutation.isError || mergeMutation.isError) && (
          <p className="text-sm text-destructive">
            {updateMutation.error instanceof Error
              ? updateMutation.error.message
              : deleteMutation.error instanceof Error
                ? deleteMutation.error.message
                : mergeMutation.error instanceof Error
                  ? mergeMutation.error.message
                  : t("settings.updateItemFailed")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ArchiveOperationsSection() {
  const { t } = useI18n();
  const [snapshotText, setSnapshotText] = useState("");
  const [importMode, setImportMode] = useState<"replace" | "merge">("replace");
  const [watchDryRun, setWatchDryRun] = useState(true);
  const [lastImportResult, setLastImportResult] = useState<string | null>(null);
  const [watchResult, setWatchResult] = useState<WatchFolderScanResponse | null>(null);

  const exportMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.GET("/api/archive/export", {});
      if (error) {
        throw new Error(getApiErrorMessage(error, t("settings.failedToExportArchive")));
      }
      return data as ArchiveSnapshot;
    },
    onSuccess: (data) => {
      setSnapshotText(JSON.stringify(data, null, 2));
    },
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      const snapshot = JSON.parse(snapshotText) as ArchiveSnapshotType;
      const { data, error } = await api.POST("/api/archive/import", {
        body: {
          mode: importMode,
          snapshot,
        },
      });
      if (error) {
        throw new Error(getApiErrorMessage(error, t("settings.failedToImportArchive")));
      }
      return data as ArchiveImportResult;
    },
    onSuccess: (data) => {
      setLastImportResult(JSON.stringify(data, null, 2));
    },
  });

  const watchMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST("/api/archive/watch-folder/scan", {
        body: { dryRun: watchDryRun },
      });
      if (error) {
        throw new Error(getApiErrorMessage(error, t("settings.failedToScanWatchFolder")));
      }
      return data as WatchFolderScanResponse;
    },
    onSuccess: (data) => {
      setWatchResult(data);
    },
  });

  const watchImportedCount =
    watchResult?.summary.imported ?? 0;
  const watchDuplicateCount =
    watchResult?.summary.duplicate ?? 0;
  const watchUnsupportedCount =
    watchResult?.summary.unsupported ?? 0;
  const watchFailedCount =
    watchResult?.summary.failed ?? 0;
  const watchPlannedCount =
    watchResult?.summary.planned ?? 0;
  const watchProblemItems =
    watchResult?.items.filter(
      (item) => item.action !== "imported" && item.action !== "duplicate",
    ) ?? [];
  const watchReviewDocumentQueries = useQueries({
    queries: (watchResult?.items ?? [])
      .filter((item) => item.documentId)
      .map((item) => ({
        queryKey: ["watch-folder-scan-document", item.documentId],
        queryFn: async () => {
          const { data, error } = await api.GET("/api/documents/{id}", {
            params: { path: { id: item.documentId! } },
          });
          if (error) {
            throw new Error(getApiErrorMessage(error, t("settings.failedToLoadScanResultDetails")));
          }
          return data as Document;
        },
      })),
  });
  const watchReviewDocuments = new Map(
    watchReviewDocumentQueries
      .map((query) => query.data)
      .filter((doc): doc is Document => Boolean(doc))
      .map((doc) => [doc.id, doc]),
  );
  const watchReviewDocumentStates = new Map(
    (watchResult?.items ?? [])
      .filter((item) => item.documentId)
      .map((item, index) => [item.documentId!, watchReviewDocumentQueries[index]]),
  );
  return (
    <Card>
      <CardHeader>
          <CardTitle className="text-lg">{t("settings.archivePortability")}</CardTitle>
          <CardDescription>
            {t("settings.archivePortabilityDescription")}
          </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => exportMutation.mutate()} disabled={exportMutation.isPending}>
            {exportMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {t("settings.exportSnapshot")}
          </Button>
          <Button
            variant={watchDryRun ? "outline" : "secondary"}
            onClick={() => setWatchDryRun((value) => !value)}
          >
            {watchDryRun ? t("settings.dryRunEnabled") : t("settings.dryRunDisabled")}
          </Button>
          <Button
            variant="outline"
            onClick={() => watchMutation.mutate()}
            disabled={watchMutation.isPending}
          >
            {watchMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {t("settings.scanWatchFolder")}
          </Button>
        </div>

        {exportMutation.isError && (
          <p className="text-sm text-destructive">
            {exportMutation.error instanceof Error
              ? exportMutation.error.message
              : t("settings.exportArchiveFailed")}
          </p>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="archive-snapshot">{t("settings.snapshotJson")}</Label>
            <Select
              value={importMode}
              onValueChange={(value: "replace" | "merge") => setImportMode(value)}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="replace">{t("settings.replace")}</SelectItem>
                <SelectItem value="merge">{t("settings.merge")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <textarea
            id="archive-snapshot"
            value={snapshotText}
            onChange={(event) => setSnapshotText(event.target.value)}
            placeholder={t("settings.snapshotPlaceholder")}
            className="min-h-56 w-full rounded-md border bg-background px-3 py-2 text-sm font-mono outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => importMutation.mutate()}
              disabled={importMutation.isPending || !snapshotText.trim()}
            >
              {importMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              {t("settings.importSnapshot")}
            </Button>
          </div>
          {importMutation.isError && (
            <p className="text-sm text-destructive">
              {importMutation.error instanceof Error
                ? importMutation.error.message
                : t("settings.importArchiveFailed")}
            </p>
          )}
        </div>

        {lastImportResult && (
          <div className="space-y-2">
            <Label>{t("settings.lastImportResult")}</Label>
            <pre className="overflow-auto rounded-md border bg-muted/50 p-3 text-xs font-mono">
              {lastImportResult}
            </pre>
          </div>
        )}

        {watchResult && (
          <div className="space-y-3 rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">{t("settings.watchFolderScan")}</p>
              <p className="text-xs text-muted-foreground">
                {t("settings.path")}: {watchResult.configuredPath}
               </p>
            </div>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <QueueCard
                label={t("settings.imported")}
                value={watchImportedCount}
                active={watchImportedCount > 0}
              />
              <QueueCard
                label={t("settings.duplicates")}
                value={watchDuplicateCount}
                active={watchDuplicateCount > 0}
              />
              <QueueCard
                label={t("settings.unsupported")}
                value={watchUnsupportedCount}
                active={watchUnsupportedCount > 0}
                variant="warning"
              />
              <QueueCard
                label={t("settings.failures")}
                value={watchFailedCount}
                active={watchFailedCount > 0}
                variant="warning"
              />
              <QueueCard
                label={watchResult.dryRun ? t("settings.planned") : t("settings.total")}
                value={watchResult.dryRun ? watchPlannedCount : watchResult.summary.total}
                active={(watchResult.dryRun ? watchPlannedCount : watchResult.summary.total) > 0}
              />
            </div>
            {watchResult.items.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    {t("settings.currentScanResults")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {watchResult.items.length} {t(watchResult.items.length === 1 ? "settings.itemOne" : "settings.itemOther")}
                  </p>
                </div>
                <div className="space-y-2">
                  {watchResult.items.map((item) => (
                    <div
                      key={`${item.path}:${item.action}:${item.reason}`}
                      className="rounded-md border bg-background/60 p-3"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant={watchFolderActionVariant(item.action)}>
                              {formatWatchFolderAction(item.action)}
                            </Badge>
                            <span className="break-all text-sm font-medium">{item.path}</span>
                          </div>
                          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            <span>{t("settings.reason")}: {formatWatchFolderReason(item.reason)}</span>
                            {item.mimeType && <span>MIME: {item.mimeType}</span>}
                            {item.destinationPath && (
                              <span>{t("settings.destination")}: {item.destinationPath}</span>
                            )}
                          </div>
                          {item.detail && (
                            <p className="text-xs text-muted-foreground">{item.detail}</p>
                          )}
                        </div>
                        {item.documentId && (
                          <div className="flex flex-col items-stretch gap-2 sm:items-end">
                            <Button asChild size="sm" variant="outline">
                              <Link
                                to="/documents/$documentId"
                                params={{ documentId: item.documentId }}
                              >
                                {t("settings.openDocument")}
                              </Link>
                            </Button>
                          </div>
                        )}
                      </div>
                      {item.documentId && (
                        <details className="mt-3 rounded-md border bg-muted/20 px-3 py-2">
                          <summary className="cursor-pointer text-sm font-medium text-foreground">
                            {t("settings.inspectExtractedFields")}
                          </summary>
                          <div className="mt-3">
                            <WatchFolderFieldReview
                              document={watchReviewDocuments.get(item.documentId) ?? null}
                              isLoading={watchReviewDocumentStates.get(item.documentId)?.isLoading ?? false}
                              isError={watchReviewDocumentStates.get(item.documentId)?.isError ?? false}
                            />
                          </div>
                        </details>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {watchProblemItems.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  {t("settings.currentScanIssues")}
                </p>
                <div className="space-y-2">
                  {watchProblemItems.map((item) => (
                    <div
                      key={`${item.path}:${item.reason}`}
                      className="rounded-md border bg-muted/30 p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant={
                            item.action === "failed" || item.action === "unsupported"
                              ? "destructive"
                              : "secondary"
                          }
                        >
                          {item.action}
                        </Badge>
                        <span className="text-sm font-medium">{item.path}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <span>{t("settings.reason")}: {formatWatchFolderReason(item.reason)}</span>
                        {item.failureCode && (
                          <span>{t("settings.code")}: {item.failureCode}</span>
                        )}
                        {item.mimeType && <span>MIME: {item.mimeType}</span>}
                        {item.destinationPath && (
                          <span>{t("settings.destination")}: {item.destinationPath}</span>
                        )}
                      </div>
                      {item.detail && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          {item.detail}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {watchResult.history.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  {t("settings.recentScans")}
                </p>
                <div className="space-y-2">
                  {watchResult.history.map((entry) => (
                    <div
                      key={entry.scannedAt}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2"
                    >
                      <div>
                        <p className="text-sm font-medium">
                          {format(new Date(entry.scannedAt), "MMM d, yyyy HH:mm")}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {entry.dryRun ? t("settings.dryRunEnabled") : t("settings.liveScan")}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <span>I: {entry.imported}</span>
                        <span>D: {entry.duplicate}</span>
                        <span>U: {entry.unsupported}</span>
                        <span>F: {entry.failed}</span>
                        <span>P: {entry.planned}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {watchMutation.isError && (
          <p className="text-sm text-destructive">
            {watchMutation.error instanceof Error
              ? watchMutation.error.message
              : t("settings.failedToScanWatchFolder")}
          </p>
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
  const { language, t } = useI18n();
  const statusQuery = useQuery({
    queryKey: ["health", "status"],
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/health/status");
      if (!response.ok || error || !data) {
        throw error ?? new Error(t("settings.failedToFetchStatus"));
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
              {t("settings.processingActivity")}
            </CardTitle>
            <CardDescription>
              {t("settings.processingActivityDescription")}
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
            {t("settings.failedToLoadProcessingStatus")}
          </div>
        )}

        {data && (
          <>
            {/* Queue depths + Document counts */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <QueueCard
                label={t("settings.ocrQueue")}
                value={data.queues.processing.depth}
                active={data.queues.processing.depth > 0}
              />
              <QueueCard
                label={t("settings.embedQueue")}
                value={data.queues.embedding.depth}
                active={data.queues.embedding.depth > 0}
              />
              <QueueCard
                label={t("settings.totalDocs")}
                value={totalDocs}
                active={false}
              />
              <QueueCard
                label={t("settings.pendingReview")}
                value={data.documents.pendingReview}
                active={data.documents.pendingReview > 0}
                variant="warning"
              />
            </div>

            {/* Document status breakdown */}
            {Object.keys(data.documents.byStatus).length > 0 && (
              <div>
                <p className="mb-2 text-sm font-medium">{t("settings.documentsByStatus")}</p>
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
              <p className="mb-2 text-sm font-medium">{t("settings.recentJobs")}</p>
              {data.recentJobs.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  {t("settings.noProcessingJobs")}
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
                          {formatJobTime(job.createdAt, language, t)}
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

function formatWatchFolderReason(reason: string): string {
  return reason
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function formatWatchFolderAction(
  action: WatchFolderScanResponse["items"][number]["action"],
): string {
  return action.charAt(0).toUpperCase() + action.slice(1);
}

function formatWatchFolderFieldLabel(field: string): string {
  return field
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatWatchFolderDate(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return format(new Date(value), "MMM d, yyyy");
  } catch {
    return value;
  }
}

function getWatchFolderFieldValue(document: Document, field: string): string | null {
  switch (field) {
    case "correspondent":
      return document.correspondent?.name ?? null;
    case "issueDate":
      return formatWatchFolderDate(document.issueDate);
    case "dueDate":
      return formatWatchFolderDate(document.dueDate);
    case "expiryDate":
      return formatWatchFolderDate(document.expiryDate);
    case "amount":
      return document.amount !== null
        ? `${document.amount.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })} ${document.currency ?? ""}`.trim()
        : null;
    case "currency":
      return document.currency ?? null;
    case "referenceNumber":
      return document.referenceNumber ?? null;
    case "holderName":
      return document.holderName ?? null;
    case "issuingAuthority":
      return document.issuingAuthority ?? null;
    default:
      return null;
  }
}

function watchFolderActionVariant(
  action: WatchFolderScanResponse["items"][number]["action"],
): "secondary" | "success" | "destructive" | "outline" {
  switch (action) {
    case "imported":
      return "success";
    case "duplicate":
      return "secondary";
    case "unsupported":
    case "failed":
      return "destructive";
    case "planned":
      return "outline";
  }
}

function WatchFolderFieldReview({
  document,
  isLoading,
  isError,
}: {
  document: Document | null;
  isLoading: boolean;
  isError: boolean;
}) {
  const { t } = useI18n();
  if (isLoading) {
    return <p className="text-sm text-muted-foreground">{t("settings.loadingExtractedFields")}</p>;
  }

  if (isError) {
    return <p className="text-sm text-destructive">{t("settings.failedToLoadExtractedFields")}</p>;
  }

  if (!document) {
    return <p className="text-sm text-muted-foreground">{t("settings.noExtractedFieldsYet")}</p>;
  }

  const requiredFields =
    document.metadata.reviewEvidence?.requiredFields ?? document.documentType?.requiredFields ?? [];

  if (requiredFields.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("settings.keyFieldExtractionUnavailable")}
      </p>
    );
  }

  const missingFields = new Set(
    document.metadata.reviewEvidence?.missingFields ??
      requiredFields.filter((field) => !getWatchFolderFieldValue(document, field)),
  );
  const foundFields = requiredFields
    .map((field) => ({ field, value: getWatchFolderFieldValue(document, field) }))
    .filter((entry) => !missingFields.has(entry.field) && entry.value !== null);

  return (
    <div className="space-y-3">
      {document.metadata.reviewEvidence?.confidence != null && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>
            {t("settings.confidence")}:{" "}
            <span className={confidenceTextClass(document.metadata.reviewEvidence.confidence)}>
              {(document.metadata.reviewEvidence.confidence * 100).toFixed(0)}%
            </span>
          </span>
          {document.metadata.reviewEvidence.confidenceThreshold != null && (
            <span>
              {t("settings.threshold")}: {(document.metadata.reviewEvidence.confidenceThreshold * 100).toFixed(0)}%
            </span>
          )}
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-md border bg-background/70 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("settings.foundValues")}
          </p>
          <div className="mt-2 space-y-2">
            {foundFields.length > 0 ? (
              foundFields.map(({ field, value }) => (
                <div key={field} className="rounded-md border bg-muted/20 px-3 py-2">
                  <p className="text-xs text-muted-foreground">
                    {formatWatchFolderFieldLabel(field)}
                  </p>
                  <p className="text-sm font-medium text-foreground">{value}</p>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">{t("settings.noKeyFieldsFound")}</p>
            )}
          </div>
        </div>
        <div className="rounded-md border bg-background/70 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("settings.missingKeyFields")}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {missingFields.size > 0 ? (
              Array.from(missingFields).map((field) => (
                <Badge key={field} variant="warning">
                  {formatWatchFolderFieldLabel(field)}
                </Badge>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">{t("settings.noneMissing")}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function confidenceTextClass(confidence: number): string {
  if (confidence >= 0.8) return "font-medium text-emerald-600";
  if (confidence >= 0.5) return "font-medium text-amber-600";
  return "font-medium text-red-600";
}

function formatJobTime(dateStr: string, language: AppLanguage, t: Translate): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return `${diffSec}${t("settings.secondsAgo")}`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}${t("settings.minutesAgo")}`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}${t("settings.hoursAgo")}`;
    return format(date, language === "de" ? "d. MMM, HH:mm" : "MMM d, HH:mm");
  } catch {
    return dateStr;
  }
}

// --- AI & Providers ---

const CHAT_PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  gemini: "Gemini",
  mistral: "Mistral",
};

const EMBEDDING_PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  "google-gemini": "Google Gemini",
  voyage: "Voyage AI",
  mistral: "Mistral",
};

const PARSE_PROVIDER_LABELS: Record<string, string> = {
  "local-ocr": "Local OCR",
  "google-document-ai-enterprise-ocr": "Google Doc AI Enterprise",
  "google-document-ai-gemini-layout-parser": "Google Doc AI Gemini",
  "amazon-textract": "Amazon Textract",
  "azure-ai-document-intelligence": "Azure Document Intelligence",
  "mistral-ocr": "Mistral OCR",
};

function resolveChatProvider(cfg: ProviderConfig): {
  name: string;
  model: string | undefined;
  configured: boolean;
} | null {
  if (cfg.activeChatProvider) {
    const providerConfig = {
      openai: { hasKey: cfg.hasOpenAiKey, model: cfg.openaiModel },
      gemini: { hasKey: cfg.hasGeminiKey, model: cfg.geminiModel },
      mistral: { hasKey: cfg.hasMistralKey, model: cfg.mistralModel },
    }[cfg.activeChatProvider];

    if (providerConfig?.hasKey) {
      return {
        name: CHAT_PROVIDER_LABELS[cfg.activeChatProvider] ?? cfg.activeChatProvider,
        model: providerConfig.model,
        configured: true,
      };
    }
  }

  if (cfg.hasOpenAiKey) {
    return { name: "OpenAI", model: cfg.openaiModel, configured: true };
  }
  if (cfg.hasGeminiKey) {
    return { name: "Gemini", model: cfg.geminiModel, configured: true };
  }
  if (cfg.hasMistralKey) {
    return { name: "Mistral", model: cfg.mistralModel, configured: true };
  }
  return null;
}

function AiProvidersSection() {
  const { language, t } = useI18n();
  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/health");
      if (!response.ok || error || !data) {
        throw error ?? new Error(t("settings.failedToFetchHealth"));
      }
      return data as HealthResponse;
    },
    refetchInterval: 30000,
  });

  const providersQuery = useQuery({
    queryKey: ["health", "providers"],
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/health/providers");
      if (!response.ok || error || !data) {
        throw error ?? new Error(t("settings.failedToFetchProviders"));
      }
      return data as HealthProvidersResponse;
    },
    refetchInterval: 30000,
  });

  const cfg = healthQuery.data?.provider as ProviderConfig | undefined;
  const activeChat = cfg ? resolveChatProvider(cfg) : null;

  // All chat providers with their key status
  const chatProviders = cfg
    ? [
        { id: "openai", label: "OpenAI", model: cfg.openaiModel, hasKey: cfg.hasOpenAiKey },
        { id: "gemini", label: "Gemini", model: cfg.geminiModel, hasKey: cfg.hasGeminiKey },
        { id: "mistral", label: "Mistral", model: cfg.mistralModel, hasKey: cfg.hasMistralKey },
      ]
    : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Brain className="h-5 w-5" />
          {t("settings.aiProviders")}
        </CardTitle>
        <CardDescription>
          {t("settings.aiProvidersDescription")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {healthQuery.isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("settings.loadingProviderConfiguration")}
          </div>
        )}

        {healthQuery.isError && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            {t("settings.unableToLoadProviderConfiguration")}
          </div>
        )}

        {cfg && (
          <>
            {/* Active Chat Model */}
            <div>
              <p className="mb-2 text-sm font-medium">{t("settings.chatModel")}</p>
              {activeChat ? (
                <div className="flex items-center justify-between rounded-md border px-3 py-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-emerald-500" />
                    <span className="text-sm font-medium">{activeChat.name}</span>
                    {activeChat.model && (
                      <Badge variant="secondary">{activeChat.model}</Badge>
                    )}
                  </div>
                  <Badge variant="success">{t("settings.active")}</Badge>
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
                  <AlertCircle className="h-4 w-4" />
                  {t("settings.noChatProviderConfigured")}
                </div>
              )}
            </div>

            {/* All Chat Providers */}
            <div>
              <p className="mb-2 text-sm font-medium">{t("settings.chatProviders")}</p>
              <div className="space-y-2">
                {chatProviders.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between rounded-md border px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      {p.hasKey ? (
                        <CheckCircle className="h-4 w-4 text-emerald-500" />
                      ) : (
                        <AlertCircle className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className="text-sm">{p.label}</span>
                      {p.hasKey && p.model && (
                        <Badge variant="outline">{p.model}</Badge>
                      )}
                    </div>
                    <Badge variant={p.hasKey ? "success" : "secondary"}>
                      {p.hasKey ? t("settings.configured") : t("settings.notConfigured")}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>

            <Separator />

            {/* Embedding Providers */}
            {providersQuery.data && (
              <div>
                <p className="mb-2 text-sm font-medium">{t("settings.embeddingProviders")}</p>
                <div className="space-y-2">
                  {providersQuery.data.embeddingProviders.map((ep) => (
                    <div
                      key={ep.id}
                      className="flex items-center justify-between rounded-md border px-3 py-2"
                    >
                      <div className="flex items-center gap-2">
                        {ep.available ? (
                          <CheckCircle className="h-4 w-4 text-emerald-500" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className="text-sm">
                          {EMBEDDING_PROVIDER_LABELS[ep.id] ?? ep.id}
                        </span>
                        {ep.model && (
                          <Badge variant="outline">{ep.model}</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {ep.id === cfg.activeEmbeddingProvider && (
                          <Badge variant="success">{t("settings.active")}</Badge>
                        )}
                        <Badge variant={ep.available ? "success" : "secondary"}>
                          {ep.available ? t("settings.available") : t("settings.notConfigured")}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Separator />

            {/* Parse Providers */}
            {providersQuery.data && (
              <div>
                <p className="mb-2 text-sm font-medium">{t("settings.parseProviders")}</p>
                <div className="space-y-2">
                  {providersQuery.data.parseProviders.map((pp) => (
                    <div
                      key={pp.id}
                      className="flex items-center justify-between rounded-md border px-3 py-2"
                    >
                      <div className="flex items-center gap-2">
                        {pp.available ? (
                          <CheckCircle className="h-4 w-4 text-emerald-500" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className="text-sm">
                          {PARSE_PROVIDER_LABELS[pp.id] ?? pp.id}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {pp.id === cfg.activeParseProvider && (
                          <Badge variant="success">{t("settings.active")}</Badge>
                        )}
                        {pp.id === cfg.fallbackParseProvider && (
                          <Badge variant="warning">{t("settings.fallback")}</Badge>
                        )}
                        <Badge variant={pp.available ? "success" : "secondary"}>
                          {pp.available ? t("settings.available") : t("settings.notConfigured")}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Processing mode */}
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{t("settings.processingMode")}</span>
              <Badge variant="outline">{cfg.mode}</Badge>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// --- System Health ---

function SystemHealthSection() {
  const { t } = useI18n();
  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/health");
      if (!response.ok || error || !data) {
        throw error ?? new Error(t("settings.failedToFetchHealth"));
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
        throw error ?? new Error(t("settings.failedToFetchReadiness"));
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
          {t("settings.systemHealth")}
        </CardTitle>
        <CardDescription>{t("settings.systemHealthDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Health status */}
        {healthQuery.isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("settings.checkingHealth")}
          </div>
        )}

        {healthQuery.isError && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            {t("settings.unableToReachServer")}
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
                {t("settings.server")}:{" "}
                <span className="capitalize">{healthQuery.data.status}</span>
              </p>
            </div>
          </div>
        )}

        {/* Readiness checks */}
        {readinessQuery.isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("settings.runningReadinessChecks")}
          </div>
        )}

        {readinessQuery.data && readinessQuery.data.checks && (
          <>
            <Separator />
            <div>
              <p className="mb-2 text-sm font-medium">{t("settings.readinessChecks")}</p>
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
                        {healthy ? t("settings.ok") : t("settings.fail")}
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
