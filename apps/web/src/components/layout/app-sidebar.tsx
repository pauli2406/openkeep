import { Link, useLocation } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronsUpDown,
  ClipboardCheck,
  Files,
  Landmark,
  MessagesSquare,
  Moon,
  Settings,
  Sun,
  Sunrise,
  User,
} from "lucide-react";
import { OpenKeepLogo } from "@/components/brand/openkeep-logo";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { fetchDashboardInsights } from "@/lib/explorer";
import { useI18n } from "@/lib/i18n";

function initialsOf(name: string) {
  return (
    name
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join("") || "?"
  );
}

export function AppSidebar() {
  const auth = useAuth();
  const { t } = useI18n();
  const { pathname } = useLocation();
  const { theme, toggleTheme } = useTheme();
  const { isMobile, setOpenMobile } = useSidebar();

  // Same key as the Today page, so the sidebar shares its cache.
  const { data: insights } = useQuery({
    queryKey: ["dashboard", "insights"],
    queryFn: fetchDashboardInsights,
    enabled: auth.isAuthenticated,
    staleTime: 60_000,
  });

  const items = [
    { to: "/", label: t("root.nav.today"), icon: Sunrise, active: pathname === "/" },
    {
      to: "/documents",
      label: t("root.nav.documents"),
      icon: Files,
      active: pathname.startsWith("/documents"),
      count: insights?.stats.totalDocuments,
    },
    {
      to: "/review",
      label: t("root.nav.review"),
      icon: ClipboardCheck,
      active: pathname.startsWith("/review"),
      count: insights?.stats.pendingReview,
    },
    {
      to: "/taxes",
      label: t("root.nav.taxes"),
      icon: Landmark,
      active: pathname.startsWith("/taxes"),
    },
    {
      to: "/search",
      label: t("root.nav.chat"),
      icon: MessagesSquare,
      active: pathname.startsWith("/search"),
    },
  ];

  const closeOnMobile = () => setOpenMobile(false);
  const displayName = auth.user?.displayName ?? auth.user?.email ?? "?";

  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader className="px-2.5 pt-3 pb-4">
        <Link
          to="/"
          onClick={closeOnMobile}
          aria-label="OpenKeep"
          className="flex items-center rounded-lg text-sidebar-accent-foreground outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <OpenKeepLogo
            markClassName="ring-1 ring-white/25"
            wordmarkClassName="group-data-[collapsible=icon]:hidden"
          />
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {items.map((item) => (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton asChild isActive={item.active} tooltip={item.label}>
                    <Link to={item.to} onClick={closeOnMobile}>
                      <item.icon />
                      <span>
                        {item.label}
                        {item.count ? <span className="sr-only"> {item.count}</span> : null}
                      </span>
                    </Link>
                  </SidebarMenuButton>
                  {item.count ? (
                    <SidebarMenuBadge
                      aria-hidden="true"
                      className="num text-sidebar-muted"
                    >
                      {item.count.toLocaleString()}
                    </SidebarMenuBadge>
                  ) : null}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="gap-1 pb-3">
        <SidebarMenu className="gap-1">
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={pathname.startsWith("/settings")}
              tooltip={t("root.nav.settings")}
            >
              <Link to="/settings" onClick={closeOnMobile}>
                <Settings />
                <span>{t("root.nav.settings")}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  aria-label={t("root.nav.profile")}
                  className="mt-1 data-[state=open]:bg-sidebar-accent"
                >
                  <Avatar className="size-8 rounded-lg">
                    <AvatarFallback className="rounded-lg bg-white/15 text-xs font-semibold text-sidebar-accent-foreground">
                      {initialsOf(displayName)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="grid flex-1 text-left leading-tight">
                    <span className="truncate text-sm font-medium text-sidebar-accent-foreground">
                      {displayName}
                    </span>
                    {auth.user?.email && auth.user.email !== displayName ? (
                      <span className="truncate text-xs text-sidebar-muted">{auth.user.email}</span>
                    ) : null}
                  </span>
                  <ChevronsUpDown className="ml-auto text-sidebar-muted" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side={isMobile ? "top" : "right"}
                align="end"
                sideOffset={8}
                className="w-56"
              >
                <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
                  {auth.user?.email ?? displayName}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/profile" onClick={closeOnMobile}>
                    <User />
                    {t("root.nav.profile")}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={toggleTheme}>
                  {theme === "dark" ? <Sun /> : <Moon />}
                  {t("root.theme.toggle")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
