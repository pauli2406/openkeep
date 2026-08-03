import type { ReactNode } from "react";

/**
 * The one auth surface: a centred 360px panel on the app background.
 * Login, the 2FA step and first-run setup all render inside it.
 */
export function AuthPanel({
  title,
  subtitle,
  step,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  /** mono step indicator for multi-step flows, e.g. "1 / 3" */
  step?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--ok-raised)] p-6">
      <div className="w-full max-w-[360px] rounded-[var(--r-lg)] border bg-card p-7 shadow-[0_1px_2px_rgba(20,40,35,0.06)]">
        <div className="mb-5 flex items-center gap-2.5">
          <img
            src="/brand/logo-mark.svg"
            alt=""
            aria-hidden="true"
            className="h-6 w-6 rounded-[var(--r-sm)]"
          />
          <span className="text-[15px] font-bold tracking-[-0.01em]">OpenKeep</span>
          {step ? (
            <span className="ok-num ml-auto text-xs text-muted-foreground">{step}</span>
          ) : null}
        </div>

        <h1 className="text-[19px] font-semibold">{title}</h1>
        {subtitle ? (
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        ) : null}

        <div className="mt-5">{children}</div>

        {footer ? (
          <div className="mt-4 flex items-center justify-between border-t pt-3.5 text-xs">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Inline field error, under the field, in red — never a toast. */
export function FieldError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p className="mt-1 text-xs text-[var(--ok-red)]">{children}</p>;
}
