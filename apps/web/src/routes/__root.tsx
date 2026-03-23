import { useState } from "react";
import {
  createRootRouteWithContext,
  Outlet,
  Link,
  Navigate,
  useNavigate,
  useLocation,
  redirect,
} from "@tanstack/react-router";
import {
  Archive,
  Search,
  Upload,
  ClipboardCheck,
  Settings,
  LogOut,
  Menu,
  X,
  FileText,
  LayoutDashboard,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth, type RouterContext } from "@/hooks/use-auth";

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/documents", label: "Documents", icon: FileText },
  { to: "/explore", label: "Explore", icon: Sparkles },
  { to: "/review", label: "Review", icon: ClipboardCheck },
  { to: "/search", label: "Search", icon: Search },
  { to: "/upload", label: "Upload", icon: Upload },
] as const;

const bottomNavItems = [
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

function RootComponent() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const publicPaths = ["/login", "/setup"];
  const isPublicRoute = publicPaths.some((path) => location.pathname === path);

  if (auth.isLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!auth.isAuthenticated && isPublicRoute) {
    return <Outlet />;
  }

  if (!auth.isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  function handleLogout() {
    auth.logout();
    navigate({ to: "/" });
  }

  const sidebarContent = (
    <>
      {/* Brand */}
      <div className="flex h-14 items-center gap-2.5 px-5">
        <Archive className="h-5 w-5 text-[color:var(--explorer-rust)]" />
        <span className="font-[var(--font-display)] text-2xl tracking-tight text-[color:var(--explorer-ink)]">
          OpenKeep
        </span>
      </div>

      <Separator />

      {/* Main navigation */}
      <nav className="flex flex-1 flex-col gap-1 px-3 py-3">
        {navItems.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            onClick={() => setMobileMenuOpen(false)}
            className="flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-medium text-[color:var(--explorer-muted)] transition-colors hover:bg-[color:var(--explorer-paper-strong)] hover:text-[color:var(--explorer-ink)]"
            activeProps={{
              className:
                "flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-medium bg-[color:var(--explorer-paper-strong)] text-[color:var(--explorer-ink)] transition-colors",
            }}
            activeOptions={{ exact: item.to === "/" }}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        ))}
      </nav>

      {/* Bottom section */}
      <div className="mt-auto px-3 pb-3">
        <Separator className="mb-3" />
        {bottomNavItems.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            onClick={() => setMobileMenuOpen(false)}
            className="flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-medium text-[color:var(--explorer-muted)] transition-colors hover:bg-[color:var(--explorer-paper-strong)] hover:text-[color:var(--explorer-ink)]"
            activeProps={{
              className:
                "flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-medium bg-[color:var(--explorer-paper-strong)] text-[color:var(--explorer-ink)] transition-colors",
            }}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        ))}
        <Button
          variant="ghost"
          className="w-full justify-start gap-3 rounded-2xl px-3 py-3 text-sm font-medium text-[color:var(--explorer-muted)] hover:bg-[color:var(--explorer-paper-strong)] hover:text-destructive"
          onClick={handleLogout}
        >
          <LogOut className="h-4 w-4" />
          Logout
        </Button>
      </div>
    </>
  );

  return (
    <TooltipProvider>
      <div className="flex h-screen overflow-hidden bg-background">
        {/* Desktop sidebar */}
        <aside className="hidden w-72 flex-col border-r border-[color:var(--explorer-border)] bg-[color:var(--explorer-panel)]/90 backdrop-blur md:flex">
          {sidebarContent}
        </aside>

        {/* Mobile menu overlay */}
        {mobileMenuOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/50 md:hidden"
            onClick={() => setMobileMenuOpen(false)}
          />
        )}

        {/* Mobile sidebar drawer */}
        <aside
          className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-[color:var(--explorer-border)] bg-[color:var(--explorer-panel)] transition-transform duration-200 ease-in-out md:hidden ${
            mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="absolute right-2 top-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMobileMenuOpen(false)}
            >
              <X className="h-5 w-5" />
              <span className="sr-only">Close menu</span>
            </Button>
          </div>
          {sidebarContent}
        </aside>

        {/* Main content area */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Mobile header */}
          <header className="flex h-16 items-center gap-3 border-b border-[color:var(--explorer-border)] bg-[color:var(--explorer-panel)]/90 px-4 md:hidden">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMobileMenuOpen(true)}
            >
              <Menu className="h-5 w-5" />
              <span className="sr-only">Open menu</span>
            </Button>
            <div className="flex items-center gap-2">
              <Archive className="h-4 w-4 text-[color:var(--explorer-rust)]" />
              <span className="font-[var(--font-display)] text-xl text-[color:var(--explorer-ink)]">OpenKeep</span>
            </div>
          </header>

          {/* Page content */}
          <main className="flex-1 overflow-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}

export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: ({ context, location }) => {
    const publicPaths = ["/login", "/setup"];
    const isPublicRoute = publicPaths.some((p) => location.pathname === p);

    if (!context.auth.isAuthenticated && !isPublicRoute) {
      throw redirect({ to: "/login" });
    }
  },
  component: RootComponent,
});
