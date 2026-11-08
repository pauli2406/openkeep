import { createFileRoute } from "@tanstack/react-router";
import { ExplorerSurface } from "@/components/explorer/explorer-surface";
import { parseExplorerSearch } from "@/lib/explorer";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/documents/")({
  validateSearch: (search: Record<string, unknown>) => parseExplorerSearch(search),
  component: DocumentsExplorerPage,
});

function DocumentsExplorerPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { t } = useI18n();

  return (
    <ExplorerSurface
      title={t("root.nav.documents")}
      search={search}
      onSearchChange={(next) =>
        navigate({
          search: next,
          replace: true,
        })
      }
      openDocument={(documentId) =>
        navigate({
          to: "/documents/$documentId",
          params: { documentId },
        })
      }
    />
  );
}
