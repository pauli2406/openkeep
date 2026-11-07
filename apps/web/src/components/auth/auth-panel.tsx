import type { ReactNode } from "react";
import { CheckIcon, FileSearchIcon, MessageSquareQuoteIcon, ServerIcon } from "lucide-react";
import { OpenKeepLogo } from "@/components/brand/openkeep-logo";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export type AuthBrandTruth = { icon: ReactNode; title: string; detail: string };

/**
 * The split every "before the app" screen shares: the gradient brand panel on
 * the left, hidden on phones, and whatever form the screen needs on calm white.
 * It takes its copy as props because the desktop connection screens render
 * outside the i18n provider.
 */
export function AuthSplit({
  headline,
  truths,
  children,
}: {
  headline: string;
  truths: AuthBrandTruth[];
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-svh bg-background text-foreground md:grid-cols-2 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="relative isolate hidden h-svh flex-col gap-10 overflow-hidden bg-gradient-chrome p-10 text-sidebar-foreground md:sticky md:top-0 md:flex lg:p-14">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -top-32 -right-24 -z-10 size-96 rounded-full bg-white/10 blur-3xl"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-40 -left-16 -z-10 size-96 rounded-full bg-white/8 blur-3xl"
        />
        <OpenKeepLogo
          className="text-sidebar-accent-foreground"
          markClassName="ring-1 ring-white/25"
        />
        <div className="my-auto flex max-w-md flex-col gap-9">
          <p className="text-3xl leading-tight font-semibold tracking-tight text-balance text-sidebar-accent-foreground lg:text-4xl lg:leading-tight">
            {headline}
          </p>
          <ul className="flex flex-col gap-5">
            {truths.map((truth) => (
              <li key={truth.title} className="flex gap-3.5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-sidebar-accent text-sidebar-accent-foreground [&_svg]:size-4.5">
                  {truth.icon}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-sidebar-accent-foreground">{truth.title}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-sidebar-foreground/80">
                    {truth.detail}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col gap-8 px-6 py-8 sm:px-10 md:py-10">
        <OpenKeepLogo className="md:hidden" />
        <div className="my-auto w-full max-w-sm self-center">{children}</div>
      </div>
    </div>
  );
}

function AuthSteps({ step, labels }: { step: string; labels?: string[] }) {
  const match = /^(\d+)\s*\/\s*(\d+)$/.exec(step.trim());
  if (!match) {
    return <p className="num text-xs text-muted-foreground">{step}</p>;
  }
  const current = Number(match[1]);
  const total = Number(match[2]);

  return (
    <ol aria-label={step} className="flex items-center gap-2">
      {Array.from({ length: total }, (_, index) => {
        const number = index + 1;
        const done = number < current;
        const active = number === current;
        const label = labels?.[index];
        return (
          <li
            key={number}
            aria-current={active ? "step" : undefined}
            className="flex min-w-0 flex-1 items-center gap-2 last:flex-none"
          >
            <span
              className={cn(
                "num flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors",
                done && "bg-brand-soft text-brand-soft-foreground",
                active && "bg-gradient-action text-primary-foreground shadow-action",
                !done && !active && "bg-muted text-muted-foreground",
              )}
            >
              {done ? <CheckIcon aria-hidden="true" className="size-3.5" /> : number}
            </span>
            {label ? (
              <span
                className={cn(
                  "truncate text-xs font-medium",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {label}
              </span>
            ) : null}
            {number < total ? <span aria-hidden="true" className="h-px min-w-3 flex-1 bg-border" /> : null}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The one auth surface. Login, the 2FA step and first-run setup all render
 * inside it, on the right-hand side of the split.
 */
export function AuthPanel({
  title,
  subtitle,
  step,
  stepLabels,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  /** Progress through a multi-step flow, e.g. "1 / 3". Drawn as a step indicator. */
  step?: string;
  /** A short name per step, shown next to its number. */
  stepLabels?: string[];
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { t } = useI18n();

  return (
    <AuthSplit
      headline={t("auth.brandHeadline")}
      truths={[
        {
          icon: <ServerIcon />,
          title: t("auth.truthHostedTitle"),
          detail: t("auth.truthHostedDetail"),
        },
        {
          icon: <FileSearchIcon />,
          title: t("auth.truthReadTitle"),
          detail: t("auth.truthReadDetail"),
        },
        {
          icon: <MessageSquareQuoteIcon />,
          title: t("auth.truthSourcesTitle"),
          detail: t("auth.truthSourcesDetail"),
        },
      ]}
    >
      {step ? (
        <div className="mb-8">
          <AuthSteps step={step} labels={stepLabels} />
        </div>
      ) : null}
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {subtitle ? <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p> : null}

      <div className="mt-7">{children}</div>

      {footer ? (
        <div className="mt-6 flex items-center justify-center border-t pt-5 text-sm">{footer}</div>
      ) : null}
    </AuthSplit>
  );
}

/** Inline field error, under the field, in red, never a toast. */
export function FieldError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-sm text-danger">
      {children}
    </p>
  );
}
