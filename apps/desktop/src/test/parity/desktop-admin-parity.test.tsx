import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  makeHealthProvidersResponse,
  makeHealthResponse,
  makeProcessingStatusResponse,
  makeReadinessResponse,
} from "@/test/fixtures";
import {
  desktopApiUrl,
  desktopParityServer,
  emptyInsights,
} from "./msw-server";
import { renderDesktopArchive } from "./render-desktop-app";

beforeAll(() => desktopParityServer.listen({ onUnhandledRequest: "error" }));
afterEach(() => desktopParityServer.resetHandlers());
afterAll(() => desktopParityServer.close());

const token = (id: string, name: string) => ({
  id,
  name,
  tokenPrefix: `okp_${id.slice(0, 6)}`,
  lastUsedAt: null,
  expiresAt: null,
  createdAt: "2026-08-11T10:00:00.000Z",
});

function generalSettingsHandlers() {
  return [
    http.get(desktopApiUrl("/api/health"), () =>
      HttpResponse.json(makeHealthResponse()),
    ),
    http.get(desktopApiUrl("/api/health/ready"), () =>
      HttpResponse.json(makeReadinessResponse()),
    ),
    http.get(desktopApiUrl("/api/health/status"), () =>
      HttpResponse.json(makeProcessingStatusResponse()),
    ),
    http.get(desktopApiUrl("/api/archive/watch-folder"), () =>
      HttpResponse.json({
        configured: true,
        configuredPath: "/srv/openkeep/inbox",
        lastScan: {
          scannedAt: "2026-08-11T09:00:00.000Z",
          dryRun: true,
          imported: 0,
          duplicate: 1,
          unsupported: 0,
          failed: 0,
          planned: 2,
        },
        lastImport: null,
        history: [],
      }),
    ),
  ];
}

describe("desktop archive administration parity", () => {
  it("shows owner identity and statistics, starts 2FA, manages tokens, and saves exports natively", async () => {
    const setupCalls: unknown[] = [];
    const createCalls: unknown[] = [];
    const savedRequests: unknown[] = [];
    let tokens = [token("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "Desktop connection")];

    desktopParityServer.use(
      http.get(desktopApiUrl("/api/dashboard/insights"), () =>
        HttpResponse.json({
          ...emptyInsights,
          stats: {
            totalDocuments: 24,
            pendingReview: 3,
            documentTypesCount: 5,
            correspondentsCount: 9,
          },
        }),
      ),
      http.get(desktopApiUrl("/api/auth/tokens"), () => HttpResponse.json(tokens)),
      http.post(desktopApiUrl("/api/auth/2fa/setup"), async ({ request }) => {
        setupCalls.push(await request.json());
        return HttpResponse.json({
          secret: "DESKTOPTOTPSECRET",
          otpauthUrl: "otpauth://totp/OpenKeep:owner@example.com",
          qrDataUrl: "data:image/png;base64,cXItY29kZQ==",
          enrollmentToken: "signed-enrollment-token",
        });
      }),
      http.post(desktopApiUrl("/api/auth/tokens"), async ({ request }) => {
        const body = (await request.json()) as { name: string };
        createCalls.push(body);
        const created = token("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", body.name);
        tokens = [...tokens, created];
        return HttpResponse.json({
          ...created,
          token: "okp_desktop.created-secret",
        });
      }),
    );

    const { bridge, user } = renderDesktopArchive({
      route: "/profile",
      bridge: {
        save: {
          request: vi.fn(async (request) => {
            savedRequests.push(request);
            return { status: "saved" as const };
          }),
        },
      },
    });

    expect((await screen.findAllByText("Owner")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("24")).length).toBeGreaterThan(0);
    expect(screen.getByText("Desktop connection")).toBeInTheDocument();
    expect(screen.getByText("Two-Factor Authentication")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Enable" }));
    expect(
      await screen.findByRole("heading", { name: "Set up two-factor authentication" }),
    ).toBeInTheDocument();
    expect(screen.getByText("DESKTOPTOTPSECRET")).toBeInTheDocument();
    expect(setupCalls).toEqual([{}]);
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("button", { name: "Create Token" }));
    const tokenDialog = await screen.findByRole("dialog");
    await user.type(within(tokenDialog).getByLabelText("Name"), "Automation");
    await user.click(within(tokenDialog).getByRole("button", { name: "Create" }));
    expect(await screen.findByText("okp_desktop.created-secret")).toBeInTheDocument();
    expect(createCalls).toEqual([{ name: "Automation" }]);

    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Export archive" }));
    await waitFor(() => {
      expect(savedRequests).toEqual([{ kind: "archive-export" }]);
    });
    expect(bridge.save.request).toBeTypeOf("function");
  });

  it("shows server watch-folder, processing, health, import, and native export behavior", async () => {
    const imports: unknown[] = [];
    const saveRequest = vi.fn(async () => ({ status: "saved" as const }));
    desktopParityServer.use(
      ...generalSettingsHandlers(),
      http.post(desktopApiUrl("/api/archive/import"), async ({ request }) => {
        imports.push(await request.json());
        return HttpResponse.json({
          imported: true,
          mode: "replace",
          documentCount: 0,
          fileCount: 0,
        });
      }),
    );

    const { user } = renderDesktopArchive({
      route: "/settings",
      bridge: { save: { request: saveRequest } },
    });

    expect(await screen.findByText("Language Preferences")).toBeInTheDocument();
    expect(screen.getByText("Archive Portability")).toBeInTheDocument();
    expect(await screen.findByText("Server Watch Folder")).toBeInTheDocument();
    expect(screen.getByText(/\/srv\/openkeep\/inbox/)).toBeInTheDocument();
    expect(await screen.findByText("Processing Activity")).toBeInTheDocument();
    expect(screen.getByText("OCR Queue")).toBeInTheDocument();
    expect(screen.getByText("System Health")).toBeInTheDocument();
    expect(await screen.findByText("Readiness Checks")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Export Snapshot" }));
    await waitFor(() =>
      expect(saveRequest).toHaveBeenCalledWith({ kind: "archive-export" }),
    );

    const snapshot = screen.getByPlaceholderText(
      /export a snapshot or paste one here/i,
    );
    await user.click(snapshot);
    await user.paste(JSON.stringify({ version: 1, documents: [] }));
    await user.click(screen.getByRole("button", { name: "Import Snapshot" }));
    await waitFor(() => expect(imports).toHaveLength(1));
    expect(imports[0]).toMatchObject({ mode: "replace" });
    expect(await screen.findByText("Last Import Result")).toBeInTheDocument();
  });

  it("keeps provider and pipeline administration read-only", async () => {
    desktopParityServer.use(
      http.get(desktopApiUrl("/api/health"), () =>
        HttpResponse.json(makeHealthResponse()),
      ),
      http.get(desktopApiUrl("/api/health/providers"), () =>
        HttpResponse.json(makeHealthProvidersResponse()),
      ),
      http.get(desktopApiUrl("/api/health/status"), () =>
        HttpResponse.json(makeProcessingStatusResponse()),
      ),
    );

    renderDesktopArchive({ route: "/settings/providers" });
    expect(await screen.findByText("Processing queue")).toBeInTheDocument();
    const main = within(screen.getByRole("main"));
    expect(main.getByText("Processing queue")).toBeInTheDocument();
    expect(main.getByText("Parsing")).toBeInTheDocument();
    expect(main.getByText("Embeddings")).toBeInTheDocument();
    expect(main.getAllByText("Local OCR").length).toBeGreaterThan(0);
    expect(main.queryByRole("button", { name: /save|activate|configure/i })).toBeNull();
  });

  it("runs taxonomy mutations through the shared management surface", async () => {
    const createCalls: unknown[] = [];
    const renameCalls: unknown[] = [];
    let tags = [{ id: "tag-1", name: "Invoices", slug: "invoices" }];

    desktopParityServer.use(
      http.get(desktopApiUrl("/api/taxonomies/tags"), () =>
        HttpResponse.json(tags),
      ),
      http.get(desktopApiUrl("/api/taxonomies/correspondents"), () =>
        HttpResponse.json([]),
      ),
      http.get(desktopApiUrl("/api/taxonomies/document-types"), () =>
        HttpResponse.json([]),
      ),
      http.get(desktopApiUrl("/api/documents/facets"), () =>
        HttpResponse.json({
          years: [],
          correspondents: [],
          documentTypes: [],
          tags: [{ id: "tag-1", name: "Invoices", count: 4 }],
          amountRange: { min: null, max: null },
          statuses: [],
        }),
      ),
      http.post(desktopApiUrl("/api/taxonomies/tags"), async ({ request }) => {
        const body = (await request.json()) as { name: string };
        createCalls.push(body);
        tags = [...tags, { id: "tag-2", name: body.name, slug: "urgent" }];
        return HttpResponse.json(tags.at(-1));
      }),
      http.patch(desktopApiUrl("/api/taxonomies/tags/:id"), async ({ params, request }) => {
        const body = (await request.json()) as { name: string };
        renameCalls.push({ id: params.id, ...body });
        tags = tags.map((entry) =>
          entry.id === params.id ? { ...entry, name: body.name } : entry,
        );
        return HttpResponse.json(tags.find((entry) => entry.id === params.id));
      }),
    );

    const { user } = renderDesktopArchive({ route: "/settings/taxonomy" });
    expect(await screen.findByRole("checkbox", { name: "Invoices" })).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("New entry…"), "Urgent");
    await user.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(createCalls).toEqual([{ name: "Urgent" }]));

    await user.click(screen.getByRole("checkbox", { name: "Invoices" }));
    await user.type(screen.getByPlaceholderText("Invoices"), "Bills");
    await user.click(screen.getByRole("button", { name: "Rename" }));
    await waitFor(() =>
      expect(renameCalls).toEqual([{ id: "tag-1", name: "Bills" }]),
    );
  });

  it("surfaces owner authorization failures without exposing the desktop credential", async () => {
    desktopParityServer.use(
      http.get(desktopApiUrl("/api/auth/tokens"), () =>
        HttpResponse.json({ message: "Archive owner access required" }, { status: 403 }),
      ),
    );

    renderDesktopArchive({ route: "/profile" });

    expect(
      await screen.findByText("Archive owner access required"),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("okp_");
    expect(document.body.textContent).not.toContain("Bearer");
  });

  it("starts every administration query and mutation state clean for the next profile", async () => {
    let archive: "alpha" | "beta" = "alpha";
    const requestedArchives: string[] = [];
    desktopParityServer.use(
      http.get(desktopApiUrl("/api/auth/tokens"), () => {
        requestedArchives.push(archive);
        return HttpResponse.json([
          token(
            archive === "alpha"
              ? "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
              : "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
            archive === "alpha" ? "Alpha private token" : "Beta isolated token",
          ),
        ]);
      }),
      http.post(desktopApiUrl("/api/auth/tokens"), () =>
        HttpResponse.json({ message: "Alpha mutation failed" }, { status: 403 }),
      ),
    );

    const alpha = renderDesktopArchive({
      route: "/profile",
      profile: {
        id: "aaaaaaaa-1111-4111-8111-111111111111",
        label: "Alpha archive",
        serverUrl: "https://alpha.example.test",
      },
    });
    expect(await screen.findByText("Alpha private token")).toBeInTheDocument();
    await alpha.user.click(screen.getByRole("button", { name: "Create Token" }));
    const dialog = await screen.findByRole("dialog");
    await alpha.user.type(within(dialog).getByLabelText("Name"), "failed draft");
    await alpha.user.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(await screen.findByText("Alpha mutation failed")).toBeInTheDocument();
    alpha.unmount();

    archive = "beta";
    renderDesktopArchive({
      route: "/profile",
      profile: {
        id: "bbbbbbbb-1111-4111-8111-111111111111",
        label: "Beta archive",
        serverUrl: "https://beta.example.test",
      },
    });

    expect(screen.queryByText("Alpha private token")).not.toBeInTheDocument();
    expect(screen.queryByText("Alpha mutation failed")).not.toBeInTheDocument();
    expect(await screen.findByText("Beta isolated token")).toBeInTheDocument();
    expect(requestedArchives).toContain("beta");
  });
});
