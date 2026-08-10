export const APP_SCHEME = "openkeep";
export const APP_HOST = "app";
export const APP_URL = `${APP_SCHEME}://${APP_HOST}/`;

export type NavigationDecision = "allow" | "external" | "deny";

const APPLICATION_ROUTES = [
  /^\/$/,
  /^\/(?:login|setup|profile|review|search|upload)\/?$/,
  /^\/settings(?:\/(?:providers|taxonomy)?)?\/?$/,
  /^\/documents(?:\/[^/]+)?\/?$/,
  /^\/correspondents\/[^/]+\/?$/,
];

export function isApplicationRoute(pathname: string): boolean {
  return APPLICATION_ROUTES.some((route) => route.test(pathname));
}

export function isTrustedRendererUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === `${APP_SCHEME}:` &&
      url.host === APP_HOST &&
      !url.username &&
      !url.password &&
      isApplicationRoute(url.pathname)
    );
  } catch {
    return false;
  }
}

export function classifyNavigation(value: string): NavigationDecision {
  if (isTrustedRendererUrl(value)) {
    return "allow";
  }

  try {
    const url = new URL(value);
    if (
      (url.protocol === "https:" || url.protocol === "mailto:") &&
      !url.username &&
      !url.password
    ) {
      return "external";
    }
  } catch {
    // Invalid URLs are denied below.
  }

  return "deny";
}

export function assertTrustedIpcSender(
  senderUrl: string,
  isMainFrame: boolean,
  isKnownWindow: boolean,
): void {
  if (!isKnownWindow || !isMainFrame || !isTrustedRendererUrl(senderUrl)) {
    throw new Error("Rejected an IPC request from an untrusted renderer.");
  }
}
