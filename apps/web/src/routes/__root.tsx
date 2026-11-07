import {
  createRootRouteWithContext,
  Outlet,
  Link,
  Navigate,
  useLocation,
  redirect,
} from "@tanstack/react-router";
import { Moon, Search, Sun, Upload, WifiOff } from "lucide-react";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth, type RouterContext } from "@/hooks/use-auth";
import { Omnibar, openOmnibar } from "@/components/omnibar/omnibar";
import { useI18n } from "@/lib/i18n";
import {
  useOfflineReadOnly,
  usePrimaryModifierLabel,
  useShellAccessory,
} from "@/lib/host-shell";
import { useTheme } from "@/hooks/use-theme";

function RootComponent() {
  const auth = useAuth();
  const { t } = useI18n();
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();
  const ShellAccessory = useShellAccessory();
  const offlineReadOnly = useOfflineReadOnly();
  const primaryModifier = usePrimaryModifierLabel();
  const omnibarShortcut =
    primaryModifier === "⌘" ? "⌘K" : `${primaryModifier}+K`;
  const publicPaths = ["/login", "/setup"];
  const isPublicRoute = publicPaths.some((path) => location.pathname === path);
  const isAuthed = auth.isAuthenticated;

  if (auth.isLoading) {
    return (
      <div className="flex h-svh w-screen items-center justify-center bg-gradient-chrome">
        <div className="flex flex-col items-center gap-3 text-sidebar-foreground">
          <Spinner className="size-6" />
          <p className="text-sm">{t("root.loading")}</p>
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

  return (
    <TooltipProvider>
      <SidebarProvider className="h-svh overflow-hidden">
        <AppSidebar />
        <SidebarInset className="min-h-0 min-w-0 overflow-hidden">
          <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3 md:px-4">
            <SidebarTrigger className="text-muted-foreground" />
            <button
              type="button"
              onClick={openOmnibar}
              className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border bg-muted/60 px-3 text-sm text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-3 focus-visible:ring-ring/50 md:max-w-md"
            >
              <Search className="size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-left">
                {t("root.search.placeholder")}
              </span>
              <Kbd className="hidden sm:inline-flex">{omnibarShortcut}</Kbd>
            </button>

            <div className="ml-auto flex shrink-0 items-center gap-2">
              {ShellAccessory ? <ShellAccessory /> : null}
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground"
                onClick={toggleTheme}
                aria-label={t("root.theme.toggle")}
              >
                {theme === "dark" ? <Sun /> : <Moon />}
              </Button>
              <Button asChild>
                <Link to="/upload">
                  <Upload />
                  <span className="hidden sm:inline">{t("root.nav.import")}</span>
                </Link>
              </Button>
            </div>
          </header>

          {offlineReadOnly ? (
            <div
              role="status"
              className="flex shrink-0 items-center justify-center gap-2 bg-warning-soft px-4 py-1.5 text-xs font-medium text-warning"
            >
              <WifiOff className="size-3.5" />
              <span>{t("root.offlineReadOnly")}</span>
            </div>
          ) : null}

          <main className="min-h-0 flex-1 overflow-auto">
            <Outlet />
          </main>
        </SidebarInset>

        <Omnibar />
        <Toaster />
      </SidebarProvider>
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
