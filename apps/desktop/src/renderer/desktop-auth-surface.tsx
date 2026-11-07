import type { ReactNode } from "react";
import { AuthSplit } from "@/components/auth/auth-panel";
import { cn } from "@/lib/utils";
import { HardDriveDownloadIcon, LayersIcon, LockKeyholeIcon } from "./desktop-icons";

const TRUTHS = [
  {
    icon: <LockKeyholeIcon />,
    title: "Your operating system guards the keys",
    detail: "API tokens are encrypted on this computer and never enter the web interface.",
  },
  {
    icon: <LayersIcon />,
    title: "Every archive stays apart",
    detail: "Each profile gets its own window, local storage and credentials.",
  },
  {
    icon: <HardDriveDownloadIcon />,
    title: "Still there when the server is not",
    detail: "Documents you have opened stay readable in an offline copy.",
  },
];

/**
 * The login split for the screens shown before an archive is connected. They
 * render outside the shared app and its i18n provider, so the copy lives here.
 */
export function DesktopAuthSurface({
  labelledBy,
  title,
  description,
  footer,
  footerTone,
  children,
}: {
  labelledBy: string;
  title: ReactNode;
  description: ReactNode;
  footer: ReactNode;
  footerTone?: "warning";
  children: ReactNode;
}) {
  return (
    <main>
      <AuthSplit headline="Your archive, at home on this computer." truths={TRUTHS}>
        <section aria-labelledby={labelledBy}>
          <h1 id={labelledBy} className="text-2xl font-semibold tracking-tight wrap-break-word">
            {title}
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground wrap-break-word">{description}</p>
          <div className="mt-7">{children}</div>
          <footer className="mt-7 flex flex-wrap items-center gap-x-2 gap-y-1 border-t pt-4 text-xs text-muted-foreground">
            <span
              aria-hidden="true"
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                footerTone === "warning" ? "bg-warning" : "bg-brand",
              )}
            />
            {footer}
          </footer>
        </section>
      </AuthSplit>
    </main>
  );
}
