import { isTrustedRendererUrl } from "./security";
import type { NotificationTarget } from "./import-notifications";

/**
 * Applies a clicked notification to the right archive and route.
 *
 * Three cases have to behave differently. The target archive is already active:
 * reveal the window and navigate. No archive is active yet — a click during a
 * cold start, or while the chooser is open: remember the intent and apply it only
 * after that profile authenticates, because navigating an unauthenticated shell
 * would land on the connection screen. Another archive is active: ask first.
 * Switching destroys the current window along with anything unfinished in it, so
 * it must never happen silently.
 */
export function createDesktopNotificationRouter({
  activeProfileId,
  confirmSwitch,
  activateProfile,
  navigate,
  showWindow,
  reportError,
}: {
  activeProfileId: () => string | null;
  confirmSwitch: (profileId: string) => Promise<boolean>;
  activateProfile: (profileId: string) => Promise<void>;
  navigate: (url: string) => void;
  showWindow: () => void;
  reportError?: (message: string, error: unknown) => void;
}) {
  let intent: NotificationTarget | null = null;

  function apply(target: NotificationTarget) {
    showWindow();
    navigate(target.url);
  }

  async function open(target: NotificationTarget) {
    if (!isTrustedRendererUrl(target.url)) return;
    const active = activeProfileId();

    if (active === target.profileId) {
      apply(target);
      return;
    }

    if (!active) {
      // Nothing is authenticated yet. Reveal the app so the user sees why it
      // came forward, and wait for the profile to connect.
      intent = target;
      showWindow();
      return;
    }

    if (!(await confirmSwitch(target.profileId))) return;
    intent = target;
    try {
      await activateProfile(target.profileId);
    } catch (error) {
      intent = null;
      reportError?.("OpenKeep could not open the archive for that notification.", error);
    }
  }

  return {
    open,

    /**
     * Consumes a remembered intent for a window that is being created for that
     * profile, so the new window loads the notification's route directly instead
     * of loading the remembered route and navigating a second time. Consuming it
     * once is what keeps a later window from jumping to an old notification.
     */
    takeTarget(profileId: string | null) {
      if (!profileId || !intent || intent.profileId !== profileId) return null;
      const target = intent;
      intent = null;
      return target;
    },

    pendingTarget() {
      return intent;
    },
  };
}

export type DesktopNotificationRouter = ReturnType<
  typeof createDesktopNotificationRouter
>;
