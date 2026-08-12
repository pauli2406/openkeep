import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

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
};

function archiveIdentity(profile: ArchiveSwitcherProfile) {
  return `${profile.label} (${profile.serverUrl})`;
}

function ArchiveGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4.75 7.25h14.5v11H4.75z" />
      <path d="M3.75 4.75h16.5v3.5H3.75zM9 11h6" />
    </svg>
  );
}

function MoreGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="5" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="19" cy="12" r="1.4" />
    </svg>
  );
}

export function ArchiveSwitcher({
  profiles,
  activeProfileId,
  busyProfileId,
  onActivate,
  onAdd,
  onEdit,
  onRemove,
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
      <button
        type="button"
        className="desktop-archive-switcher desktop-archive-switcher--empty"
        onClick={onAdd}
      >
        <span className="desktop-archive-switcher__icon">
          <ArchiveGlyph />
        </span>
        <span>Add an archive</span>
        <span aria-hidden="true">+</span>
      </button>
    );
  }

  return (
    <div className="desktop-archive-switcher-wrap" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="desktop-archive-switcher"
        aria-haspopup="menu"
        aria-controls={menuOpen ? menuId : undefined}
        aria-expanded={menuOpen}
        onClick={() => (menuOpen ? closeMenu() : openMenu())}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="desktop-archive-switcher__icon">
          <ArchiveGlyph />
        </span>
        <span className="desktop-archive-switcher__copy">
          <span className="desktop-archive-switcher__eyebrow">
            Active archive
          </span>
          <strong>{activeProfile.label}</strong>
        </span>
        <span className="desktop-archive-switcher__status" aria-hidden="true" />
        <span className="desktop-archive-switcher__more">
          <MoreGlyph />
        </span>
      </button>

      {menuOpen ? (
        <div
          ref={menuRef}
          id={menuId}
          className="desktop-archive-menu"
          role="menu"
          aria-label="Archive profiles"
          onKeyDown={handleMenuKeyDown}
        >
          <div className="desktop-archive-menu__heading" aria-hidden="true">
            <span>Your archives</span>
            <span>{profiles.length.toString().padStart(2, "0")}</span>
          </div>
          <div className="desktop-archive-menu__profiles">
            {profiles.map((profile) => {
              const active = profile.id === activeProfileId;
              const busy = profile.id === busyProfileId;
              const identity = archiveIdentity(profile);
              return (
                <div
                  className="desktop-archive-menu__profile"
                  data-current={active || undefined}
                  key={profile.id}
                >
                  <button
                    type="button"
                    className="desktop-archive-menu__activate"
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
                      className="desktop-archive-menu__signal"
                      aria-hidden="true"
                    />
                    <span>
                      <strong>{profile.label}</strong>
                      <small>{profile.serverUrl}</small>
                    </span>
                    <span className="desktop-archive-menu__state">
                      {busy ? "Connecting…" : active ? "Active" : "Switch"}
                    </span>
                  </button>
                  <div className="desktop-archive-menu__actions">
                    <button
                      type="button"
                      role="menuitem"
                      aria-label={`Edit ${identity}`}
                      onClick={() => {
                        closeMenu({ restoreFocus: false });
                        onEdit(profile);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="desktop-archive-menu__remove"
                      aria-label={`Remove ${identity}`}
                      onClick={() => beginRemoval(profile)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            className="desktop-archive-menu__add"
            role="menuitem"
            onClick={() => {
              closeMenu({ restoreFocus: false });
              onAdd();
            }}
          >
            <span aria-hidden="true">+</span>
            Add another archive
          </button>
        </div>
      ) : null}

      {removing ? (
        <div className="desktop-archive-dialog-backdrop">
          <section
            ref={dialogRef}
            className="desktop-archive-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
          >
            <span className="desktop-archive-dialog__index" aria-hidden="true">
              REMOVE / PROFILE
            </span>
            <h2 id={titleId}>Remove {removing.label}?</h2>
            <p id={descriptionId}>
              This removes the saved connection and local data for
              <strong> {removing.serverUrl}</strong>. The remote archive and
              every document stored there remain untouched.
            </p>
            <div className="desktop-archive-dialog__actions">
              <button ref={cancelRef} type="button" onClick={cancelRemoval}>
                Keep archive
              </button>
              <button
                type="button"
                className="desktop-archive-dialog__confirm"
                onClick={() => void confirmRemoval()}
              >
                Remove saved archive
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
