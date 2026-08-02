import { createFileRoute } from "@tanstack/react-router";
import { ExplorerSurface } from "@/components/explorer/explorer-surface";
import { parseExplorerSearch } from "@/lib/explorer";

export const Route = createFileRoute("/documents/")({
  validateSearch: (search: Record<string, unknown>) => parseExplorerSearch(search),
  component: DocumentsExplorerPage,
});

function DocumentsExplorerPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <ExplorerSurface
      eyebrow="Archive Explorer"
      title="Documents"
      description=""
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
