import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Archive, Download, LogOut } from "lucide-react";
import { GradientPanel, Page } from "@/components/layout/page";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiTokensSection } from "@/components/settings/api-tokens-section";
import { SectionCard } from "@/components/settings/shared";
import { TwoFactorSection } from "@/components/settings/two-factor-section";
import { useAuth } from "@/hooks/use-auth";
import { api } from "@/lib/api";
import { fetchDashboardInsights } from "@/lib/explorer";
import { useI18n } from "@/lib/i18n";
import { useHostFileSaver } from "@/lib/host-shell";

export const Route = createFileRoute("/profile")({
  component: ProfilePage,
});


function ProfilePage() {
  const { language } = useI18n();
  const auth = useAuth();
  const navigate = useNavigate();
  const hostFileSaver = useHostFileSaver();
  const [exportError, setExportError] = useState<string | null>(null);

  const copy =
    language === "de"
      ? {
          owner: "Inhaber",
          signOut: "Abmelden",
          documents: "Dokumente",
          reviewed: "Nicht in Prüfung",
          stillOpen: (n: number) => `${n} warten auf Prüfung`,
          correspondents: "Korrespondenten",
          documentTypes: "Dokumententypen",
          yourData: "Deine Daten",
          exportArchive: "Archiv exportieren",
          exportNote:
            "Der Export schreibt Metadaten und das Audit-Log als Snapshot — genug, um das Archiv anderswo wieder aufzubauen.",
          exportFailed: "Der Archivexport konnte nicht gespeichert werden.",
        }
      : {
          owner: "Owner",
          signOut: "Sign out",
          documents: "Documents",
          reviewed: "Not awaiting review",
          stillOpen: (n: number) => `${n} waiting for review`,
          correspondents: "Correspondents",
          documentTypes: "Document types",
          yourData: "Your data",
          exportArchive: "Export archive",
          exportNote:
            "Export writes metadata and the audit log to a snapshot — enough to rebuild the archive elsewhere.",
          exportFailed: "The archive export could not be saved.",
        };

  const insightsQuery = useQuery({
    queryKey: ["dashboard", "insights"],
    queryFn: fetchDashboardInsights,
    staleTime: 60_000,
  });

  const user = auth.user;
  const initials =
    (user?.displayName ?? user?.email ?? "?")
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join("") || "?";

  const stats = insightsQuery.data?.stats;
  // Not "reviewed by you": `not_required` documents are in here too, and the
  // API exposes no resolved-review count. Say what the number is instead.
  const notAwaitingReview =
    stats != null ? Math.max(0, stats.totalDocuments - stats.pendingReview) : null;

  async function exportArchive() {
    setExportError(null);
    if (hostFileSaver) {
      try {
        const result = await hostFileSaver({ kind: "archive-export" });
        if (result.status === "failed") {
          setExportError(result.message);
        }
      } catch {
        setExportError(copy.exportFailed);
      }
      return;
    }

    try {
      const { data, error } = await api.GET("/api/archive/export", {});
      if (error || !data) throw new Error("export-failed");
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "openkeep-archive-export.json";
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setExportError(copy.exportFailed);
    }
  }

  const statTiles = [
    { label: copy.documents, value: stats?.totalDocuments?.toLocaleString() ?? "—", note: null },
    {
      label: copy.reviewed,
      value: notAwaitingReview?.toLocaleString() ?? "—",
      note: stats ? copy.stillOpen(stats.pendingReview) : null,
    },
    {
      label: copy.correspondents,
      value: stats?.correspondentsCount?.toLocaleString() ?? "—",
      note: null,
    },
    {
      label: copy.documentTypes,
      value: stats?.documentTypesCount?.toLocaleString() ?? "—",
      note: null,
    },
  ];

  return (
    <Page>
      <GradientPanel className="p-5 md:p-7">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <Avatar className="size-14 after:border-white/25">
            <AvatarFallback className="bg-white/15 text-lg font-semibold text-white">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1 basis-48">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <h1 className="truncate text-2xl font-semibold tracking-tight">
                {user?.displayName ?? "—"}
              </h1>
              {user?.isOwner ? (
                <span className="rounded-full bg-white/15 px-2 py-0.5 text-xs font-medium">
                  {copy.owner}
                </span>
              ) : null}
            </div>
            <p className="truncate text-sm text-white/85">{user?.email}</p>
          </div>
          <Button
            variant="outline"
            className="border-transparent bg-white/12 text-white hover:bg-white/20 hover:text-white dark:border-transparent dark:bg-white/12 dark:hover:bg-white/20"
            onClick={() => {
              auth.logout();
              navigate({ to: "/" });
            }}
          >
            <LogOut />
            {copy.signOut}
          </Button>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          {statTiles.map((stat) => (
            <div key={stat.label} className="min-w-0 rounded-xl bg-white/12 p-3.5">
              <p className="text-sm font-medium">{stat.label}</p>
              {insightsQuery.isLoading ? (
                <Skeleton className="mt-2 h-8 w-14 bg-white/20" />
              ) : (
                <p className="num mt-1.5 text-3xl font-semibold tracking-tight">{stat.value}</p>
              )}
              {stat.note ? <p className="mt-0.5 text-xs text-white/80">{stat.note}</p> : null}
            </div>
          ))}
        </div>
      </GradientPanel>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-5">
          {/* Existing 2FA enrollment + recovery-code flow */}
          <TwoFactorSection />
          {/* Existing token create dialog with its show-once behaviour */}
          <ApiTokensSection />
        </div>

        <SectionCard headingLevel="h2" icon={<Archive />} title={copy.yourData}>
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">{copy.exportNote}</p>
            <Button variant="outline" className="w-full" onClick={() => void exportArchive()}>
              <Download />
              {copy.exportArchive}
            </Button>
            {exportError ? (
              <p className="text-sm text-destructive" role="alert">
                {exportError}
              </p>
            ) : null}
          </div>
        </SectionCard>
      </div>
    </Page>
  );
}
