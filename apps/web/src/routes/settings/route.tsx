import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/settings")({
  component: SettingsShell,
});

/** The settings shell: a 150px left nav, sections render into the outlet. */
function SettingsShell() {
  const { t } = useI18n();
  const { pathname } = useLocation();

  const items = [
    { to: "/settings", label: t("settingsNav.general"), exact: true },
    { to: "/settings/taxonomy", label: t("settingsNav.taxonomy"), exact: false },
    { to: "/settings/providers", label: t("settingsNav.providers"), exact: false },
  ];

  return (
    <div className="flex h-full min-h-0">
      <nav className="w-[150px] flex-shrink-0 border-r px-2 py-3">
        {items.map((item) => {
          const active = item.exact
            ? pathname === item.to || pathname === `${item.to}/`
            : pathname.startsWith(item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "block rounded-[var(--r-md)] px-2.5 py-1.5 text-sm transition-colors",
                active
                  ? "bg-accent font-semibold text-accent-foreground"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="min-h-0 flex-1 overflow-auto">
        <Outlet />
      </div>
    </div>
  );
}
