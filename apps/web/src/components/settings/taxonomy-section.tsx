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
import { api, authFetch, getApiErrorMessage } from "@/lib/api";
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
  Plus,
  Trash2,
  Loader2,
  Layers,
  Edit2,
  } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import {
  type TaxonomyKind,
  createTaxonomy,
  deleteTaxonomy,
  listTaxonomy,
  mergeTaxonomy,
  updateTaxonomy,
} from "./taxonomy-api";

export function TaxonomyManagementSection() {
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

