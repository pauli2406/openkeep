import type {
  ArchiveImportResult,
  ArchiveSnapshot,
  ArchiveSnapshot as ArchiveSnapshotType,
  Category,
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
import { useI18n, type AppLanguage } from "@/lib/i18n";

export type TaxonomyEntity = Tag | Correspondent | DocumentType | Category;
export type TaxonomyKind = "tags" | "correspondents" | "document-types" | "categories";
export type Translate = ReturnType<typeof useI18n>["t"];

export async function listTaxonomy(kind: TaxonomyKind, t: Translate): Promise<TaxonomyEntity[]> {
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
    case "categories": {
      const { data, error } = await api.GET("/api/taxonomies/categories", {});
      if (error) {
        throw new Error(getApiErrorMessage(error, t("settings.failedToLoadCategories")));
      }
      return (data ?? []) as Category[];
    }
  }
}

export async function createTaxonomy(kind: TaxonomyKind, name: string, t: Translate): Promise<void> {
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

export async function updateTaxonomy(kind: TaxonomyKind, id: string, name: string, t: Translate): Promise<void> {
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
    case "categories": {
      const { error } = await api.PATCH("/api/taxonomies/categories/{id}", {
        params: { path: { id } },
        body: { name },
      });
      if (error) {
        throw new Error(getApiErrorMessage(error, t("settings.failedToRenameCategory")));
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

export async function deleteTaxonomy(kind: TaxonomyKind, id: string, t: Translate): Promise<void> {
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
    case "categories": {
      const { error } = await api.DELETE("/api/taxonomies/categories/{id}", {
        params: { path: { id } },
      });
      if (error) {
        throw new Error(getApiErrorMessage(error, t("settings.failedToDeleteCategory")));
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

export async function mergeTaxonomy(kind: TaxonomyKind, id: string, targetId: string, t: Translate): Promise<void> {
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
    case "categories": {
      // Categories have no merge: reassignments are one manual click each,
      // and merging builtins would break the canonical vocabulary.
      throw new Error(t("settings.categoriesNoMerge"));
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
