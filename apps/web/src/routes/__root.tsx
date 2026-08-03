import {
  createRootRouteWithContext,
  Outlet,
  Link,
  Navigate,
  useNavigate,
  useLocation,
  redirect,
} from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Search, Upload, Settings, Moon, Sun, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth, type RouterContext } from "@/hooks/use-auth";
import { Omnibar, openOmnibar } from "@/components/omnibar/omnibar";
import { fetchDashboardInsights } from "@/lib/explorer";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/hooks/use-theme";

/** Top-bar tab. `count` is rendered as a mono badge when present. */
function NavTab({
  to,
  label,
  count,
  tone = "dim",
  active,
}: {
  to: string;
  label: string;
  count?: number;
  tone?: "dim" | "amber";
  active: boolean;
}) {
  return (
    <Link
      to={to}
      className={[
        "inline-flex items-center gap-1.5 rounded-[var(--r-md)] px-2.5 py-1.5 text-sm transition-colors",
        active
          ? "bg-accent font-semibold text-accent-foreground"
          : "text-muted-foreground hover:bg-secondary hover:text-foreground",
      ].join(" ")}
    >
      {label}
      {count ? (
        <span
          className={`ok-num text-[10.5px] ${
            tone === "amber" ? "text-[var(--ok-amber)]" : "text-[var(--ok-faint)]"
          }`}
        >
          {count.toLocaleString()}
        </span>
      ) : null}
    </Link>
  );
}

function RootComponent() {
  const auth = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();
  const publicPaths = ["/login", "/setup"];
  const isPublicRoute = publicPaths.some((path) => location.pathname === path);
  const isAuthed = auth.isAuthenticated;

  // Same key as the Today page, so the bar shares its cache.
  const { data: insights } = useQuery({
    queryKey: ["dashboard", "insights"],
    queryFn: fetchDashboardInsights,
    enabled: isAuthed,
    staleTime: 60_000,
  });

  if (auth.isLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
          <p className="text-sm text-muted-foreground">{t("root.loading")}</p>
        </div>
      </div>
    );
  }

  if (!isAuthed && isPublicRoute) {
    return <Outlet />;
  }

  if (!isAuthed) {
    return <Navigate to="/login" replace />;
  }

  const path = location.pathname;
  const initials =
    (auth.user?.displayName ?? auth.user?.email ?? "?")
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join("") || "?";

  return (
    <TooltipProvider>
      <div className="flex h-screen flex-col overflow-hidden bg-background">
        <header className="flex h-12 flex-shrink-0 items-center gap-4 border-b bg-[var(--ok-bar)] px-4">
          <Link to="/" className="flex flex-shrink-0 items-center gap-2 text-foreground">
            <img
              src="/brand/logo-mark.svg"
              alt=""
              aria-hidden="true"
              className="h-5 w-5 rounded-[var(--r-sm)]"
            />
            <span className="hidden text-[13.5px] font-bold tracking-[-0.01em] sm:inline">OpenKeep</span>
          </Link>

          {/* The nav block never shrinks; the search field absorbs the width. */}
          <nav className="flex min-w-0 gap-0.5 overflow-x-auto [scrollbar-width:none] md:flex-shrink-0 [&::-webkit-scrollbar]:hidden">
            <NavTab to="/" label={t("root.nav.today")} active={path === "/"} />
            <NavTab
              to="/documents"
              label={t("root.nav.documents")}
              count={insights?.stats.totalDocuments}
              active={path.startsWith("/documents")}
            />
            <NavTab
              to="/review"
              label={t("root.nav.review")}
              count={insights?.stats.pendingReview}
              tone="amber"
              active={path.startsWith("/review")}
            />
            <NavTab
              to="/search"
              label={t("root.nav.chat")}
              active={path.startsWith("/search")}
            />
          </nav>

          <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2">
            <button
              type="button"
              onClick={openOmnibar}
              className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center gap-2 rounded-[var(--r-md)] border border-input bg-card transition-colors hover:bg-secondary md:w-auto md:min-w-[120px] md:max-w-[300px] md:flex-1 md:flex-shrink md:justify-start md:px-2.5"
            >
              <Search className="h-[13px] w-[13px] flex-shrink-0 text-muted-foreground" />
              <span className="hidden min-w-0 flex-1 truncate text-left text-sm text-[var(--ok-faint)] md:inline">
                {t("root.search.placeholder")}
              </span>
              <kbd className="ok-num hidden flex-shrink-0 rounded-[var(--r-sm)] border px-1 text-[10px] text-muted-foreground md:inline">
                ⌘K
              </kbd>
            </button>

            <Button asChild className="flex-shrink-0">
              <Link to="/upload">
                <Upload />
                <span className="hidden sm:inline">{t("root.nav.import")}</span>
              </Link>
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="flex-shrink-0 text-muted-foreground"
              onClick={toggleTheme}
              aria-label={t("root.theme.toggle")}
            >
              {theme === "dark" ? <Sun /> : <Moon />}
            </Button>

            <Button
              asChild
              variant="ghost"
              size="icon"
              className="flex-shrink-0 text-muted-foreground"
            >
              <Link to="/settings" aria-label={t("root.nav.settings")}>
                <Settings />
              </Link>
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger
                className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-[var(--r-md)] bg-accent text-[11px] font-bold text-accent-foreground"
                aria-label={t("root.nav.profile")}
              >
                {initials}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link to="/profile">
                    <User />
                    {t("root.nav.profile")}
                  </Link>
                </DropdownMenuItem>

              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>

        {/* Global omnibar (Cmd+K) */}
        <Omnibar />
      </div>
    </TooltipProvider>
  );
}

export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: ({ context, location }) => {
    const publicPaths = ["/login", "/setup"];
    const isPublicRoute = publicPaths.some((p) => location.pathname === p);

    // Don't redirect while auth is still loading — the RootComponent
    // already shows a loading spinner during this phase.  Redirecting
    // early loses the original URL because the login route bounces
    // authenticated users back to "/".
    if (context.auth.isLoading) return;

    if (!context.auth.isAuthenticated && !isPublicRoute) {
      throw redirect({ to: "/login" });
    }
  },
  component: RootComponent,
});
