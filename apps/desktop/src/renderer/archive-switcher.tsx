import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ArchiveIcon,
  ChevronsUpDownIcon,
  PlusIcon,
  TriangleAlertIcon,
} from "./desktop-icons";

export type ArchiveSwitcherProfile = {
  id: string;
  label: string;
  serverUrl: string;
};

type ArchiveSwitcherProps = {
  profiles: ArchiveSwitcherProfile[];
  activeProfileId: string;
  busyProfileId?: string;
  onActivate: (id: string) => void | Promise<void>;
  onAdd: () => void;
  onEdit: (profile: ArchiveSwitcherProfile) => void;
  onRemove: (profile: ArchiveSwitcherProfile) => void | Promise<void>;
  /** Span the container with a labelled trigger; the app header keeps it compact. */
  fill?: boolean;
};

function archiveIdentity(profile: ArchiveSwitcherProfile) {
  return `${profile.label} (${profile.serverUrl})`;
}

export function ArchiveSwitcher({
  profiles,
  activeProfileId,
  busyProfileId,
  onActivate,
  onAdd,
  onEdit,
  onRemove,
  fill = false,
}: ArchiveSwitcherProps) {
  const menuId = useId();
  const titleId = useId();
  const descriptionId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [removing, setRemoving] = useState<ArchiveSwitcherProfile | null>(null);

  const activeProfile =
    profiles.find((profile) => profile.id === activeProfileId) ?? profiles[0];

  function closeMenu({ restoreFocus = true } = {}) {
    setMenuOpen(false);
    if (restoreFocus) {
      triggerRef.current?.focus();
    }
  }

  function openMenu() {
    setMenuOpen(true);
  }

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const activeItem = menuRef.current?.querySelector<HTMLButtonElement>(
      '[data-active="true"]',
    );
    const firstItem =
      menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]');
    (activeItem ?? firstItem)?.focus();
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        closeMenu({ restoreFocus: false });
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [menuOpen]);

  useEffect(() => {
    if (!removing) {
      return;
    }

    const previouslyFocused = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setRemoving(null);
        triggerRef.current?.focus();
        return;
      }

      if (event.key === "Tab") {
        const buttons = Array.from(
          dialogRef.current?.querySelectorAll<HTMLButtonElement>("button") ??
            [],
        );
        const first = buttons[0];
        const last = buttons.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [removing]);

  function handleTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (
      event.key === "ArrowDown" ||
      event.key === "Enter" ||
      event.key === " "
    ) {
      event.preventDefault();
      openMenu();
    }
  }

  function handleMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
      return;
    }

    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      return;
    }

    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled)',
      ) ?? [],
    );
    if (items.length === 0) {
      return;
    }

    event.preventDefault();
    const currentIndex = items.indexOf(
      document.activeElement as HTMLButtonElement,
    );
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowUp"
            ? (currentIndex - 1 + items.length) % items.length
            : (currentIndex + 1) % items.length;
    items[nextIndex]?.focus();
  }

  function beginRemoval(profile: ArchiveSwitcherProfile) {
    setMenuOpen(false);
    setRemoving(profile);
  }

  function cancelRemoval() {
    setRemoving(null);
    triggerRef.current?.focus();
  }

  async function confirmRemoval() {
    if (!removing) {
      return;
    }
    const profile = removing;
    await onRemove(profile);
    setRemoving(null);
    triggerRef.current?.focus();
  }

  if (!activeProfile) {
    return (
      <Button
        type="button"
        variant="outline"
        className={cn(fill && "h-11 w-full")}
        onClick={onAdd}
      >
        <ArchiveIcon className="size-4 text-brand" />
        <span>Add an archive</span>
        <PlusIcon className="size-4 text-muted-foreground" />
      </Button>
    );
  }

  return (
    <div className={cn("relative", fill ? "flex w-full" : "inline-flex min-w-0")} ref={rootRef}>
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        className={cn(
          "min-w-0 justify-start shadow-none",
          fill ? "h-auto w-full gap-3 py-2.5 pr-3 pl-2.5 text-left" : "max-w-44 gap-2 pr-2 pl-2.5",
        )}
        aria-haspopup="menu"
        aria-controls={menuOpen ? menuId : undefined}
        aria-expanded={menuOpen}
        onClick={() => (menuOpen ? closeMenu() : openMenu())}
        onKeyDown={handleTriggerKeyDown}
      >
        <span
          className={cn(
            "flex shrink-0 items-center justify-center bg-brand-soft text-brand-soft-foreground",
            fill ? "size-9 rounded-lg" : "size-6 rounded-md",
          )}
        >
          <ArchiveIcon className={fill ? "size-4.5" : "size-3.5"} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={fill ? "text-xs font-normal text-muted-foreground" : "sr-only"}>
            Active archive{" "}
          </span>
          <span className="truncate" title={activeProfile.label}>
            {activeProfile.label}
          </span>
        </span>
        <ChevronsUpDownIcon className="size-4 text-muted-foreground" />
      </Button>

      {menuOpen ? (
        <div
          ref={menuRef}
          id={menuId}
          className="absolute top-full right-0 z-120 mt-2 w-full min-w-[min(360px,calc(100vw-28px))] overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-raised animate-in fade-in-0 slide-in-from-top-1 motion-reduce:animate-none"
          role="menu"
          aria-label="Archive profiles"
          onKeyDown={handleMenuKeyDown}
        >
          <div
            className="flex items-center justify-between border-b px-3.5 py-2.5 text-xs font-medium text-muted-foreground"
            aria-hidden="true"
          >
            <span>Your archives</span>
            <span className="num">{profiles.length}</span>
          </div>
          <div className="flex max-h-[min(390px,54vh)] flex-col gap-0.5 overflow-y-auto p-1.5">
            {profiles.map((profile) => {
              const active = profile.id === activeProfileId;
              const busy = profile.id === busyProfileId;
              const identity = archiveIdentity(profile);
              return (
                <div
                  className={cn(
                    "group/profile grid grid-cols-[minmax(0,1fr)_auto] items-center rounded-lg hover:bg-muted focus-within:bg-muted",
                    active && "bg-brand-soft hover:bg-brand-soft focus-within:bg-brand-soft",
                  )}
                  key={profile.id}
                >
                  <button
                    type="button"
                    className={cn(
                      "grid min-w-0 cursor-pointer grid-cols-[6px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg py-2 pr-2 pl-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                      (busy || active) && "cursor-default",
                    )}
                    role="menuitem"
                    data-active={active}
                    aria-current={active ? "true" : undefined}
                    aria-disabled={busy || active}
                    aria-label={
                      active ? `${identity}, active` : `Switch to ${identity}`
                    }
                    onClick={() => {
                      if (busy || active) {
                        return;
                      }
                      closeMenu({ restoreFocus: false });
                      void onActivate(profile.id);
                    }}
                  >
                    <span
                      className={cn(
                        "size-1.5 rounded-full",
                        active ? "bg-brand" : "bg-muted-foreground/40",
                      )}
                      aria-hidden="true"
                    />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium">{profile.label}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {profile.serverUrl}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "text-xs",
                        active ? "font-medium text-brand" : "text-muted-foreground",
                      )}
                    >
                      {busy ? "Connecting…" : active ? "Active" : "Switch"}
                    </span>
                  </button>
                  <div className="flex gap-0.5 pr-1.5 opacity-0 transition-opacity group-focus-within/profile:opacity-100 group-hover/profile:opacity-100">
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className="text-muted-foreground"
                      role="menuitem"
                      aria-label={`Edit ${identity}`}
                      onClick={() => {
                        closeMenu({ restoreFocus: false });
                        onEdit(profile);
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className="text-muted-foreground hover:text-danger"
                      role="menuitem"
                      aria-label={`Remove ${identity}`}
                      onClick={() => beginRemoval(profile)}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            className="flex w-full cursor-pointer items-center gap-2.5 border-t px-3.5 py-2.5 text-left text-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground"
            role="menuitem"
            onClick={() => {
              closeMenu({ restoreFocus: false });
              onAdd();
            }}
          >
            <PlusIcon className="size-4" />
            Add another archive
          </button>
        </div>
      ) : null}

      {removing ? (
        <div className="fixed inset-0 z-300 grid place-items-center bg-overlay p-6 backdrop-blur-xs">
          <section
            ref={dialogRef}
            className="w-full max-w-md rounded-2xl border bg-popover p-6 text-sm text-popover-foreground shadow-raised"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
          >
            <span
              className="flex size-9 items-center justify-center rounded-lg bg-danger-soft text-danger"
              aria-hidden="true"
            >
              <TriangleAlertIcon className="size-4.5" />
            </span>
            <h2 id={titleId} className="mt-4 text-lg font-semibold tracking-tight wrap-break-word">
              Remove {removing.label}?
            </h2>
            <p id={descriptionId} className="mt-1.5 leading-relaxed text-muted-foreground">
              This removes the saved connection and local data for
              <strong className="font-medium wrap-anywhere text-foreground"> {removing.serverUrl}</strong>. The remote archive and
              every document stored there remain untouched.
            </p>
            <div className="mt-6 grid grid-cols-2 gap-2.5">
              <Button ref={cancelRef} type="button" variant="outline" onClick={cancelRemoval}>
                Keep archive
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => void confirmRemoval()}
              >
                Remove saved archive
              </Button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
