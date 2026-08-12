import { Notification } from "electron";
import type { DesktopNotifier } from "./import-notifications";

/**
 * Electron adapter for native notifications.
 *
 * There is no permission prompt to drive here: on macOS and Windows the system
 * decides whether a notification is shown, and focus, quiet hours, and
 * do-not-disturb are its business rather than ours. A Linux desktop without a
 * notification service reports `isSupported()` false, and the caller simply skips
 * the notification instead of retrying or prompting.
 */
export function createElectronNotifier(): DesktopNotifier {
  return {
    isSupported() {
      return Notification.isSupported();
    },
    show({ title, body, onClick }) {
      const notification = new Notification({ title, body, silent: false });
      notification.on("click", onClick);
      notification.show();
    },
  };
}
