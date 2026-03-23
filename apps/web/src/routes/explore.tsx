import { createFileRoute } from "@tanstack/react-router";
import { ExplorerSurface } from "@/components/explorer/explorer-surface";
import { parseExplorerSearch } from "@/lib/explorer";

export const Route = createFileRoute("/explore")({
  validateSearch: (search: Record<string, unknown>) => parseExplorerSearch(search),
  component: ExplorePage,
});

function ExplorePage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <ExplorerSurface
      eyebrow="Semantic Galaxy"
      title="Explore"
      description="A full-bleed view into semantic neighborhoods across the archive. Use the left rail to narrow the corpus, then scan clusters and open documents directly from the field."
      search={{ ...search, view: "galaxy" }}
      onSearchChange={(next) =>
        navigate({
          search: { ...next, view: "galaxy" },
          replace: true,
        })
      }
      openDocument={(documentId) =>
        navigate({
          to: "/documents/$documentId",
          params: { documentId },
        })
      }
      allowViewSwitch={false}
      forcedView="galaxy"
    />
  );
}
