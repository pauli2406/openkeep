import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Download, LogOut } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiTokensSection } from "@/components/settings/api-tokens-section";
import { TwoFactorSection } from "@/components/settings/two-factor-section";
import { useAuth } from "@/hooks/use-auth";
import { api } from "@/lib/api";
import { fetchDashboardInsights } from "@/lib/explorer";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/profile")({
  component: ProfilePage,
});

function monthLabel(month: string, language: string): string {
  const [year, monthPart] = month.split("-");
  const date = new Date(Number(year), Number(monthPart) - 1, 1);
  return date.toLocaleDateString(language === "de" ? "de-DE" : "en-GB", {
    month: "short",
    year: "numeric",
  });
}

function archiveAge(firstMonth: string): string {
  const [year, month] = firstMonth.split("-").map(Number);
  const start = new Date(year, month - 1, 1);
  const months = Math.max(0, (Date.now() - start.getTime()) / (30.44 * 86_400_000));
  const years = Math.floor(months / 12);
  const rest = Math.round(months % 12);
  return years > 0 ? `${years}y ${rest}m` : `${rest}m`;
}

function ProfilePage() {
  const { language } = useI18n();
  const auth = useAuth();
  const navigate = useNavigate();

  const copy =
    language === "de"
      ? {
          owner: "Inhaber",
          signOut: "Abmelden",
          documents: "Dokumente",
          since: "seit",
          reviewed: "Von dir geprüft",
          stillOpen: (n: number) => `${n} noch offen`,
          correspondents: "Korrespondenten",
          archiveAge: "Archivalter",
          firstImport: "erster Import",
          yourData: "Deine Daten",
          exportArchive: "Archiv exportieren",
          exportNote:
            "Der Export schreibt Metadaten und das Audit-Log als Snapshot — genug, um das Archiv anderswo wieder aufzubauen.",
        }
      : {
          owner: "Owner",
          signOut: "Sign out",
          documents: "Documents",
          since: "since",
          reviewed: "Reviewed by you",
          stillOpen: (n: number) => `${n} still open`,
          correspondents: "Correspondents",
          archiveAge: "Archive age",
          firstImport: "first import",
          yourData: "Your data",
          exportArchive: "Export archive",
          exportNote:
            "Export writes metadata and the audit log to a snapshot — enough to rebuild the archive elsewhere.",
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
  const firstMonth = insightsQuery.data?.monthlyActivity?.[0]?.month ?? null;
  const reviewed =
    stats != null ? Math.max(0, stats.totalDocuments - stats.pendingReview) : null;

  async function exportArchive() {
    const { data, error } = await api.GET("/api/archive/export", {});
    if (error || !data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "openkeep-archive-export.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-5">
      {/* Identity header */}
      <div className="flex items-center gap-4 rounded-[var(--r-lg)] border bg-card px-4 py-3.5">
        <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-[var(--r-md)] bg-accent text-base font-bold text-accent-foreground">
          {initials}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2">
            <span className="truncate text-base font-semibold">
              {user?.displayName ?? "—"}
            </span>
            {user?.isOwner ? <Badge variant="soft">{copy.owner}</Badge> : null}
          </p>
          <p className="ok-num truncate text-sm text-muted-foreground">{user?.email}</p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            auth.logout();
            navigate({ to: "/" });
          }}
        >
          <LogOut />
          {copy.signOut}
        </Button>
      </div>

      {/* Four numbers */}
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {[
          {
            label: copy.documents,
            value: stats?.totalDocuments?.toLocaleString() ?? "—",
            note: firstMonth
              ? `${copy.since} ${monthLabel(firstMonth, language)}`
              : null,
          },
          {
            label: copy.reviewed,
            value: reviewed?.toLocaleString() ?? "—",
            note: stats ? copy.stillOpen(stats.pendingReview) : null,
          },
          {
            label: copy.correspondents,
            value: stats?.correspondentsCount?.toLocaleString() ?? "—",
            note: null,
          },
          {
            label: copy.archiveAge,
            value: firstMonth ? archiveAge(firstMonth) : "—",
            note: firstMonth
              ? `${copy.firstImport} ${monthLabel(firstMonth, language)}`
              : null,
          },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-[var(--r-lg)] border bg-card px-3 py-2.5"
          >
            <p className="text-xs text-muted-foreground">{stat.label}</p>
            <p className="ok-num mt-0.5 text-xl font-semibold">{stat.value}</p>
            {stat.note ? (
              <p className="text-xs text-muted-foreground">{stat.note}</p>
            ) : null}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-4">
          {/* Existing 2FA enrollment + recovery-code flow, kept as-is */}
          <TwoFactorSection />
          {/* Existing token create dialog with its show-once behaviour */}
          <ApiTokensSection />
        </div>

        {/* Your data */}
        <div className="rounded-[var(--r-lg)] border bg-card">
          <div className="border-b bg-[var(--ok-bar)] px-3.5 py-2">
            <p className="ok-section-title">{copy.yourData}</p>
          </div>
          <div className="space-y-2 px-3.5 py-3">
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => void exportArchive()}
            >
              <Download />
              {copy.exportArchive}
            </Button>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {copy.exportNote}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
