import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  ArchiveImportResult,
  ArchiveSnapshot,
  Correspondent,
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

async function listTaxonomy(kind: TaxonomyKind): Promise<TaxonomyEntity[]> {
  switch (kind) {
    case "tags": {
      const { data, error } = await api.GET("/api/taxonomies/tags", {});
      if (error) {
        throw new Error(getApiErrorMessage(error, "Failed to load tags"));
      }
      return (data ?? []) as Tag[];
    }
    case "correspondents": {
      const { data, error } = await api.GET("/api/taxonomies/correspondents", {});
      if (error) {
        throw new Error(getApiErrorMessage(error, "Failed to load correspondents"));
      }
      return (data ?? []) as Correspondent[];
    }
    case "document-types": {
      const { data, error } = await api.GET("/api/taxonomies/document-types", {});
      if (error) {
        throw new Error(getApiErrorMessage(error, "Failed to load document types"));
      }
      return (data ?? []) as DocumentType[];
    }
  }
}

async function createTaxonomy(kind: TaxonomyKind, name: string): Promise<void> {
  switch (kind) {
    case "tags": {
      const { error } = await api.POST("/api/taxonomies/tags", { body: { name } });
      if (error) {
        throw new Error(getApiErrorMessage(error, "Failed to create tag"));
      }
      return;
    }
    case "correspondents": {
      const { error } = await api.POST("/api/taxonomies/correspondents", { body: { name } });
      if (error) {
        throw new Error(getApiErrorMessage(error, "Failed to create correspondent"));
      }
      return;
    }
    case "document-types": {
      const { error } = await api.POST("/api/taxonomies/document-types", { body: { name } });
      if (error) {
        throw new Error(getApiErrorMessage(error, "Failed to create document type"));
      }
      return;
    }
  }
}

async function updateTaxonomy(kind: TaxonomyKind, id: string, name: string): Promise<void> {
  switch (kind) {
    case "tags": {
      const { error } = await api.PATCH("/api/taxonomies/tags/{id}", {
        params: { path: { id } },
        body: { name },
      });
      if (error) {
        throw new Error(getApiErrorMessage(error, "Failed to update tag"));
      }
      return;
    }
    case "correspondents": {
      const { error } = await api.PATCH("/api/taxonomies/correspondents/{id}", {
        params: { path: { id } },
        body: { name },
      });
      if (error) {
        throw new Error(getApiErrorMessage(error, "Failed to update correspondent"));
      }
      return;
    }
    case "document-types": {
      const { error } = await api.PATCH("/api/taxonomies/document-types/{id}", {
        params: { path: { id } },
        body: { name },
      });
      if (error) {
        throw new Error(getApiErrorMessage(error, "Failed to update document type"));
      }
      return;
    }
  }
}

async function deleteTaxonomy(kind: TaxonomyKind, id: string): Promise<void> {
  switch (kind) {
    case "tags": {
      const { error } = await api.DELETE("/api/taxonomies/tags/{id}", {
        params: { path: { id } },
      });
      if (error) {
        throw new Error(getApiErrorMessage(error, "Failed to delete tag"));
      }
      return;
    }
    case "correspondents": {
      const { error } = await api.DELETE("/api/taxonomies/correspondents/{id}", {
        params: { path: { id } },
      });
      if (error) {
        throw new Error(getApiErrorMessage(error, "Failed to delete correspondent"));
      }
      return;
    }
    case "document-types": {
      const { error } = await api.DELETE("/api/taxonomies/document-types/{id}", {
        params: { path: { id } },
      });
      if (error) {
        throw new Error(getApiErrorMessage(error, "Failed to delete document type"));
      }
      return;
    }
  }
}

async function mergeTaxonomy(kind: TaxonomyKind, id: string, targetId: string): Promise<void> {
  switch (kind) {
    case "tags": {
      const { error } = await api.POST("/api/taxonomies/tags/{id}/merge", {
        params: { path: { id } },
        body: { targetId },
      });
      if (error) {
        throw new Error(getApiErrorMessage(error, "Failed to merge tag"));
      }
      return;
    }
    case "correspondents": {
      const { error } = await api.POST("/api/taxonomies/correspondents/{id}/merge", {
        params: { path: { id } },
        body: { targetId },
      });
      if (error) {
        throw new Error(getApiErrorMessage(error, "Failed to merge correspondent"));
      }
      return;
    }
    case "document-types": {
      const { error } = await api.POST("/api/taxonomies/document-types/{id}/merge", {
        params: { path: { id } },
        body: { targetId },
      });
      if (error) {
        throw new Error(getApiErrorMessage(error, "Failed to merge document type"));
      }
      return;
    }
  }
}

function SettingsPage() {
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
      const { data, error } = await api.GET("/api/auth/tokens", {});
      if (error) throw new Error("Failed to fetch tokens");
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
      const { error } = await api.DELETE("/api/auth/tokens/{id}", {
        params: { path: { id } },
      });
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

  const tokens = tokensQuery.data ?? [];

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

function TaxonomyManagementSection() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Layers className="h-5 w-5" />
          Taxonomy Management
        </h2>
        <p className="text-sm text-muted-foreground">
          Curate AI-generated labels for tags, correspondents, and document types.
        </p>
      </div>

      <div className="space-y-4">
        <TaxonomySection
          kind="tags"
          title="Tags"
          description="Lightweight categories used across the archive."
        />
        <TaxonomySection
          kind="correspondents"
          title="Correspondents"
          description="Organizations and people detected as senders or counterparties."
        />
        <TaxonomySection
          kind="document-types"
          title="Document Types"
          description="Stable type labels such as invoice, contract, or statement."
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
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [mergeSourceId, setMergeSourceId] = useState<string | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState<string>("");

  const listQuery = useQuery({
    queryKey: ["taxonomies", kind],
    queryFn: () => listTaxonomy(kind),
  });

  const createMutation = useMutation({
    mutationFn: (name: string) => createTaxonomy(kind, name),
    onSuccess: () => {
      setNewName("");
      queryClient.invalidateQueries({ queryKey: ["taxonomies", kind] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (params: { id: string; name: string }) =>
      updateTaxonomy(kind, params.id, params.name),
    onSuccess: () => {
      setEditingId(null);
      setEditingName("");
      queryClient.invalidateQueries({ queryKey: ["taxonomies", kind] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteTaxonomy(kind, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["taxonomies", kind] });
    },
  });

  const mergeMutation = useMutation({
    mutationFn: (params: { id: string; targetId: string }) =>
      mergeTaxonomy(kind, params.id, params.targetId),
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
            placeholder={`Create ${title.slice(0, -1).toLowerCase()}...`}
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
                Add
              </>
            )}
          </Button>
        </form>

        {createMutation.isError && (
          <p className="text-sm text-destructive">
            {createMutation.error instanceof Error
              ? createMutation.error.message
              : `Failed to create ${title.toLowerCase()}.`}
          </p>
        )}

        {listQuery.isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {listQuery.isError && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            Failed to load {title.toLowerCase()}.
          </div>
        )}

        {listQuery.isSuccess && items.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No {title.toLowerCase()} created yet.
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
                      aria-label={`${title} name`}
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
                          "Save"
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
                        Cancel
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
                        Edit
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
                        Merge
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => deleteMutation.mutate(item.id)}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                        Delete
                      </Button>
                    </div>
                  </div>
                )}

                {mergeSourceId === item.id && editingId !== item.id && (
                  <div className="mt-3 space-y-3 rounded-md border bg-muted/30 p-3">
                    <div className="space-y-2">
                      <Label>Merge Into</Label>
                      <Select value={mergeTargetId} onValueChange={setMergeTargetId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select target" />
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
                          "Confirm Merge"
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
                        Cancel
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
                  : `Failed to update ${title.toLowerCase()}.`}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ArchiveOperationsSection() {
  const [snapshotText, setSnapshotText] = useState("");
  const [importMode, setImportMode] = useState<"replace" | "merge">("replace");
  const [watchDryRun, setWatchDryRun] = useState(true);
  const [lastImportResult, setLastImportResult] = useState<string | null>(null);
  const [watchResult, setWatchResult] = useState<WatchFolderScanResponse | null>(null);

  const exportMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.GET("/api/archive/export", {});
      if (error) {
        throw new Error(getApiErrorMessage(error, "Failed to export archive"));
      }
      return data as ArchiveSnapshot;
    },
    onSuccess: (data) => {
      setSnapshotText(JSON.stringify(data, null, 2));
    },
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      const snapshot = JSON.parse(snapshotText) as ArchiveSnapshot;
      const { data, error } = await api.POST("/api/archive/import", {
        body: {
          mode: importMode,
          snapshot,
        },
      });
      if (error) {
        throw new Error(getApiErrorMessage(error, "Failed to import archive"));
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
        throw new Error(getApiErrorMessage(error, "Failed to scan watch folder"));
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Archive Portability</CardTitle>
        <CardDescription>
          Export snapshots, restore them, and trigger watch-folder ingestion.
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
            Export Snapshot
          </Button>
          <Button
            variant={watchDryRun ? "outline" : "secondary"}
            onClick={() => setWatchDryRun((value) => !value)}
          >
            {watchDryRun ? "Dry Run Enabled" : "Dry Run Disabled"}
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
            Scan Watch Folder
          </Button>
        </div>

        {exportMutation.isError && (
          <p className="text-sm text-destructive">
            {exportMutation.error instanceof Error
              ? exportMutation.error.message
              : "Failed to export archive."}
          </p>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="archive-snapshot">Snapshot JSON</Label>
            <Select
              value={importMode}
              onValueChange={(value: "replace" | "merge") => setImportMode(value)}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="replace">Replace</SelectItem>
                <SelectItem value="merge">Merge</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <textarea
            id="archive-snapshot"
            value={snapshotText}
            onChange={(event) => setSnapshotText(event.target.value)}
            placeholder="Export a snapshot or paste one here for import"
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
              Import Snapshot
            </Button>
          </div>
          {importMutation.isError && (
            <p className="text-sm text-destructive">
              {importMutation.error instanceof Error
                ? importMutation.error.message
                : "Failed to import archive."}
            </p>
          )}
        </div>

        {lastImportResult && (
          <div className="space-y-2">
            <Label>Last Import Result</Label>
            <pre className="overflow-auto rounded-md border bg-muted/50 p-3 text-xs font-mono">
              {lastImportResult}
            </pre>
          </div>
        )}

        {watchResult && (
          <div className="space-y-3 rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Watch Folder Scan</p>
              <p className="text-xs text-muted-foreground">
                Path: {watchResult.configuredPath}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <QueueCard
                label="Imported"
                value={watchImportedCount}
                active={watchImportedCount > 0}
              />
              <QueueCard
                label="Duplicates"
                value={watchDuplicateCount}
                active={watchDuplicateCount > 0}
              />
              <QueueCard
                label="Unsupported"
                value={watchUnsupportedCount}
                active={watchUnsupportedCount > 0}
                variant="warning"
              />
              <QueueCard
                label="Failures"
                value={watchFailedCount}
                active={watchFailedCount > 0}
                variant="warning"
              />
              <QueueCard
                label={watchResult.dryRun ? "Planned" : "Total"}
                value={watchResult.dryRun ? watchPlannedCount : watchResult.summary.total}
                active={(watchResult.dryRun ? watchPlannedCount : watchResult.summary.total) > 0}
              />
            </div>
            {watchProblemItems.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Current scan issues
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
                        <span>Reason: {formatWatchFolderReason(item.reason)}</span>
                        {item.failureCode && (
                          <span>Code: {item.failureCode}</span>
                        )}
                        {item.mimeType && <span>MIME: {item.mimeType}</span>}
                        {item.destinationPath && (
                          <span>Destination: {item.destinationPath}</span>
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
                  Recent scans
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
                          {entry.dryRun ? "Dry run" : "Live scan"}
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
              : "Failed to scan watch folder."}
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

function formatWatchFolderReason(reason: string): string {
  return reason
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
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

  const providersQuery = useQuery({
    queryKey: ["health", "providers"],
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/health/providers");
      if (!response.ok || error || !data) {
        throw error ?? new Error("Failed to fetch providers");
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
          AI & Providers
        </CardTitle>
        <CardDescription>
          Configured AI providers for chat, embeddings, and document parsing
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {healthQuery.isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading provider configuration...
          </div>
        )}

        {healthQuery.isError && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            Unable to load provider configuration
          </div>
        )}

        {cfg && (
          <>
            {/* Active Chat Model */}
            <div>
              <p className="mb-2 text-sm font-medium">Chat Model</p>
              {activeChat ? (
                <div className="flex items-center justify-between rounded-md border px-3 py-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-emerald-500" />
                    <span className="text-sm font-medium">{activeChat.name}</span>
                    {activeChat.model && (
                      <Badge variant="secondary">{activeChat.model}</Badge>
                    )}
                  </div>
                  <Badge variant="success">active</Badge>
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
                  <AlertCircle className="h-4 w-4" />
                  No chat provider configured. Set OPENAI_API_KEY, GEMINI_API_KEY, or MISTRAL_API_KEY.
                </div>
              )}
            </div>

            {/* All Chat Providers */}
            <div>
              <p className="mb-2 text-sm font-medium">Chat Providers</p>
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
                      {p.hasKey ? "configured" : "not configured"}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>

            <Separator />

            {/* Embedding Providers */}
            {providersQuery.data && (
              <div>
                <p className="mb-2 text-sm font-medium">Embedding Providers</p>
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
                          <Badge variant="success">active</Badge>
                        )}
                        <Badge variant={ep.available ? "success" : "secondary"}>
                          {ep.available ? "available" : "not configured"}
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
                <p className="mb-2 text-sm font-medium">Parse Providers</p>
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
                          <Badge variant="success">active</Badge>
                        )}
                        {pp.id === cfg.fallbackParseProvider && (
                          <Badge variant="warning">fallback</Badge>
                        )}
                        <Badge variant={pp.available ? "success" : "secondary"}>
                          {pp.available ? "available" : "not configured"}
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
              <span className="text-sm text-muted-foreground">Processing Mode</span>
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
