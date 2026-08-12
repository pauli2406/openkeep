import { screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { desktopApiUrl, desktopParityServer } from "./msw-server";
import { renderDesktopArchive } from "./render-desktop-app";

/**
 * Renderer behavior of a read-only offline session. The main-process side —
 * cache serving and the reconnect loop — is unit-tested; what parity asserts
 * is that the shared web shell, mounted exactly as Electron mounts it, tells
 * the truth about the mode and disables every mutating surface through the
 * one shared predicate.
 */

beforeAll(() => desktopParityServer.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => desktopParityServer.resetHandlers());
afterAll(() => desktopParityServer.close());

describe("desktop offline session parity", () => {
  it("shows the read-only banner on every route of an offline session", async () => {
    renderDesktopArchive({ route: "/", sessionStatus: "offline" });

    expect(
      await screen.findByText(/Offline copy — read only/i),
    ).toBeInTheDocument();
  });

  it("keeps the banner out of a live session", async () => {
    renderDesktopArchive({ route: "/" });

    await waitFor(() => {
      expect(screen.queryByText(/Offline copy — read only/i)).not.toBeInTheDocument();
    });
  });

  it("replaces the import drop zone with an explanation offline", async () => {
    renderDesktopArchive({ route: "/upload", sessionStatus: "offline" });

    expect(
      await screen.findByText(/Importing needs a live archive connection/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/browse/i, { selector: "span" }),
    ).not.toBeInTheDocument();
  });

  it("disables the ask composer offline", async () => {
    desktopParityServer.use(
      http.get(desktopApiUrl("/api/qa/history"), () => HttpResponse.json([])),
    );
    renderDesktopArchive({ route: "/search", sessionStatus: "offline" });

    const send = await screen.findByRole("button", {
      name: /AI answers need a live archive connection/i,
    });
    expect(send).toBeDisabled();
  });

  it("keeps the offline session out of the failure-handler retry loop", async () => {
    // Every unserved endpoint answers the read-only refusal offline; it must
    // not carry the archive-unavailable header the failure handler reacts to.
    desktopParityServer.use(
      http.get(desktopApiUrl("/api/dashboard/insights"), () =>
        HttpResponse.json(
          { message: "This archive is open read-only from its offline copy." },
          { status: 503, headers: { "x-openkeep-desktop-offline": "read-only" } },
        ),
      ),
    );
    const retry = vi.fn(async () => ({
      status: "disconnected" as const,
      reason: "no-profile" as const,
    }));
    renderDesktopArchive({
      route: "/",
      sessionStatus: "offline",
      bridge: { session: { retry } },
    });

    expect(
      await screen.findByText(/Offline copy — read only/i),
    ).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(retry).not.toHaveBeenCalled();
  });
});
