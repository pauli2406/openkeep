import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  FileText,
  ClipboardCheck,
  Upload,
  Search,
  Calendar,
  Building2,
  Tag,
  FolderOpen,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { format } from "date-fns";

export const Route = createFileRoute("/")({
  component: DashboardPage,
});

interface DocumentListItem {
  id: string;
  title?: string;
  status?: string;
  correspondent?: { id: string; name: string; slug: string } | string | null;
  createdAt?: string;
}

interface FacetsResponse {
  documentTypes: { id: string; name: string; count: number }[];
  correspondents: { id: string; name: string; count: number }[];
}

function getStatusVariant(
  status: string,
): "success" | "warning" | "secondary" | "destructive" {
  switch (status) {
    case "ready":
      return "success";
    case "processing":
      return "warning";
    case "pending":
      return "secondary";
    case "failed":
      return "destructive";
    default:
      return "secondary";
  }
}

function DashboardPage() {
  const documentsQuery = useQuery({
    queryKey: ["documents", "recent"],
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/documents", {
        params: {
          query: {
            sort: "createdAt",
            direction: "desc",
            pageSize: 5,
          },
        },
      });
      if (!response.ok || error || !data) {
        throw new Error("Failed to load recent documents");
      }
      return data;
    },
  });

  const reviewQuery = useQuery({
    queryKey: ["documents", "review", "count"],
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/documents/review", {
        params: {
          query: {
            pageSize: 1,
          },
        },
      });
      if (!response.ok || error || !data) {
        throw new Error("Failed to load review queue");
      }
      return data;
    },
  });

  const facetsQuery = useQuery({
    queryKey: ["documents", "facets"],
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/documents/facets");
      if (!response.ok || error || !data) {
        throw error ?? new Error("Failed to load dashboard facets");
      }
      return data as unknown as FacetsResponse;
    },
  });

  const isLoading =
    documentsQuery.isLoading ||
    reviewQuery.isLoading ||
    facetsQuery.isLoading;

  const hasError =
    documentsQuery.isError || reviewQuery.isError || facetsQuery.isError;

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (hasError) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-4">
        <AlertCircle className="h-8 w-8 text-destructive" />
        <p className="text-sm text-muted-foreground">
          Failed to load dashboard data. Please try again.
        </p>
        <Button
          variant="outline"
          onClick={() => {
            documentsQuery.refetch();
            reviewQuery.refetch();
            facetsQuery.refetch();
          }}
        >
          Retry
        </Button>
      </div>
    );
  }

  const totalDocuments = documentsQuery.data?.total ?? 0;
  const pendingReview = reviewQuery.data?.total ?? 0;
  const documentTypesCount =
    facetsQuery.data?.documentTypes?.length ?? 0;
  const correspondentsCount =
    facetsQuery.data?.correspondents?.length ?? 0;
  const recentDocuments = documentsQuery.data?.items ?? [];

  return (
    <div className="space-y-8 p-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Your document archive at a glance
        </p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total Documents
            </CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalDocuments}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Pending Review
            </CardTitle>
            <ClipboardCheck
              className={`h-4 w-4 ${pendingReview > 0 ? "text-amber-500" : "text-muted-foreground"}`}
            />
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold ${pendingReview > 0 ? "text-amber-600" : ""}`}
            >
              {pendingReview}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Document Types
            </CardTitle>
            <Tag className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{documentTypesCount}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Correspondents
            </CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{correspondentsCount}</div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Documents */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5" />
            Recent Documents
          </CardTitle>
          <CardDescription>Your latest documents</CardDescription>
        </CardHeader>
        <CardContent>
          {recentDocuments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <FileText className="h-10 w-10 text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">
                No documents yet. Upload your first document to get started.
              </p>
              <Button asChild className="mt-4" size="sm">
                <Link to="/upload">
                  <Upload className="h-4 w-4" />
                  Upload Document
                </Link>
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {recentDocuments.map((doc: DocumentListItem) => (
                <Link
                  key={doc.id}
                  to="/documents/$documentId"
                  params={{ documentId: doc.id }}
                  className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-accent"
                >
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-medium">
                      {doc.title || "Untitled Document"}
                    </span>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {doc.correspondent && (
                        <span className="flex items-center gap-1">
                          <Building2 className="h-3 w-3" />
                          {typeof doc.correspondent === "string"
                            ? doc.correspondent
                            : doc.correspondent.name}
                        </span>
                      )}
                      {doc.createdAt && (
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {format(new Date(doc.createdAt), "MMM d, yyyy")}
                        </span>
                      )}
                    </div>
                  </div>
                  {doc.status && (
                    <Badge variant={getStatusVariant(doc.status)}>
                      {doc.status}
                    </Badge>
                  )}
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <div>
        <h2 className="mb-4 text-lg font-semibold">Quick Actions</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card className="transition-colors hover:bg-accent/50">
            <Link to="/upload" className="block">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Upload className="h-5 w-5" />
                  Upload Document
                </CardTitle>
                <CardDescription>
                  Add a new document to your archive
                </CardDescription>
              </CardHeader>
            </Link>
          </Card>

          <Card className="transition-colors hover:bg-accent/50">
            <Link to="/search" className="block">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Search className="h-5 w-5" />
                  Search Archive
                </CardTitle>
                <CardDescription>
                  Find documents in your archive
                </CardDescription>
              </CardHeader>
            </Link>
          </Card>

          <Card className="transition-colors hover:bg-accent/50">
            <Link to="/review" className="block">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ClipboardCheck className="h-5 w-5" />
                  Review Queue
                  {pendingReview > 0 && (
                    <Badge variant="warning" className="ml-auto">
                      {pendingReview}
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription>
                  Review and approve pending documents
                </CardDescription>
              </CardHeader>
            </Link>
          </Card>
        </div>
      </div>
    </div>
  );
}
