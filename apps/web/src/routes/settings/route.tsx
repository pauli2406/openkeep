import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { BrainCircuit, SlidersHorizontal, Tags } from "lucide-react";
import { Page, PageHeader } from "@/components/layout/page";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/settings")({
  component: SettingsShell,
});

/**
 * The settings shell. A left nav on wide screens and a scrolling pill row on
 * phones; each destination renders into the content column.
 */
function SettingsShell() {
  const { t } = useI18n();
  const { pathname } = useLocation();

  const items = [
    { to: "/settings", label: t("settingsNav.general"), icon: SlidersHorizontal, exact: true },
    { to: "/settings/taxonomy", label: t("settingsNav.taxonomy"), icon: Tags, exact: false },
    { to: "/settings/providers", label: t("settingsNav.providers"), icon: BrainCircuit, exact: false },
  ];

  return (
    <Page>
      <PageHeader title={t("settings.title")} description={t("settings.subtitle")} />
      <div className="grid items-start gap-5 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-8">
        <nav
          aria-label={t("settings.title")}
          className="-mx-4 flex gap-1 overflow-x-auto px-4 md:-mx-8 md:px-8 lg:sticky lg:top-8 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0"
        >
          {items.map((item) => {
            const active = item.exact
              ? pathname === item.to || pathname === `${item.to}/`
              : pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 max-sm:[&_svg]:hidden [&_svg]:size-4 [&_svg]:shrink-0",
                  active
                    ? "bg-brand-soft font-medium text-brand-soft-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <item.icon />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="min-w-0">
          <Outlet />
        </div>
      </div>
    </Page>
  );
}
