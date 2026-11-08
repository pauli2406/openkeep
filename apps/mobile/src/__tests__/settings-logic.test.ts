/**
 * The decisions behind Settings and Profile, without rendering: what the taxonomy
 * screen may delete and what it says first, which provider counts as active, and
 * what is accepted as an archive snapshot.
 */
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { expiryFromPreset } from "../api/account";
import {
  ARCHIVE_EXPORT_FILENAME,
  parseArchiveSnapshot,
  shareArchiveExport,
  type HealthProviders,
  type ProcessingJob,
  type ProviderConfig,
} from "../api/admin";
import { buildProviderGroups, jobDuration, jobStats } from "../screens/settings/providers-logic";
import {
  MERGE_TARGET_LIMIT,
  affectedCount,
  buildRows,
  canCreate,
  canMerge,
  computeSuggestions,
  countsFor,
  describeDeletion,
  mergeTargetOptions,
  selectionHasBuiltin,
  unusedSweepIds,
  visibleRows,
  type TaxonomyRow,
} from "../screens/settings/taxonomy-logic";

function row(id: string, name: string, count: number | null, builtin = false): TaxonomyRow {
  return { id, name, slug: id, count, builtin, categoryName: null };
}

describe("taxonomy counts", () => {
  it("are unknown, not zero, until the facets arrive", () => {
    const rows = buildRows([{ id: "a", name: "A", slug: "a" }], null);
    expect(rows[0].count).toBeNull();
    // Reading an unknown as 0 would offer to delete the whole taxonomy.
    expect(visibleRows(rows, { filter: "", quick: "unused", suggestions: new Map(), sortKey: "name", sortAsc: true })).toEqual([]);
    expect(unusedSweepIds(rows)).toEqual([]);
  });

  it("read an entry missing from the facets as unused", () => {
    const counts = countsFor(
      "tags",
      {
        tags: [{ id: "a", name: "A", slug: "a", count: 3 }],
        correspondents: [],
        documentTypes: [],
        statuses: [],
        years: [],
      },
      undefined,
    );
    const rows = buildRows(
      [
        { id: "a", name: "A", slug: "a" },
        { id: "b", name: "B", slug: "b" },
      ],
      counts,
    );
    expect(rows.map((entry) => entry.count)).toEqual([3, 0]);
  });

  it("count correspondents for a category", () => {
    const counts = countsFor("categories", undefined, [
      { id: "c1", name: "C1", slug: "c1", categoryId: "housing" },
      { id: "c2", name: "C2", slug: "c2", categoryId: "housing" },
      { id: "c3", name: "C3", slug: "c3", categoryId: null },
    ]);
    expect(counts?.get("housing")).toBe(2);
  });
});

describe("merge suggestions", () => {
  it("point case variants at the busier entry", () => {
    const low = row("low", "Energy", 2);
    const high = row("high", "ENERGY", 9);
    const suggestions = computeSuggestions([low, high]);
    expect(suggestions.get("low")?.id).toBe("high");
    expect(suggestions.has("high")).toBe(false);
  });

  it("pair singular and plural", () => {
    const suggestions = computeSuggestions([row("one", "Invoice", 5), row("many", "Invoices", 1)]);
    expect(suggestions.get("many")?.id).toBe("one");
  });

  it("merge the specific entry into the broader one", () => {
    const suggestions = computeSuggestions([row("broad", "Tax", 1), row("specific", "Tax returns", 9)]);
    expect(suggestions.get("specific")?.id).toBe("broad");
    expect(suggestions.has("broad")).toBe(false);
  });

  it("leave unrelated names alone", () => {
    expect(computeSuggestions([row("a", "Home", 1), row("b", "Homeland", 1)]).size).toBe(0);
  });
});

describe("the list", () => {
  const rows = [row("a", "Apple", 3), row("b", "Berry", 0), row("c", "Cherry", 9)];
  const options = { filter: "", quick: "all" as const, suggestions: new Map(), sortKey: "count" as const, sortAsc: false };

  it("sorts by usage, busiest first, and by name", () => {
    expect(visibleRows(rows, options).map((entry) => entry.id)).toEqual(["c", "a", "b"]);
    expect(
      visibleRows(rows, { ...options, sortKey: "name", sortAsc: true }).map((entry) => entry.id),
    ).toEqual(["a", "b", "c"]);
  });

  it("filters by name and by the quick filters", () => {
    expect(visibleRows(rows, { ...options, filter: "ERR" }).map((entry) => entry.id)).toEqual(["c", "b"]);
    expect(visibleRows(rows, { ...options, quick: "unused" }).map((entry) => entry.id)).toEqual(["b"]);
    expect(
      visibleRows(rows, {
        ...options,
        quick: "duplicates",
        suggestions: new Map([["a", rows[1]]]),
      }).map((entry) => entry.id),
    ).toEqual(["a"]);
  });
});

describe("what may be deleted", () => {
  it("leaves builtin categories out of the unused sweep", () => {
    // In the sweep, the first one refused would stop it with half the work done.
    const rows = [row("builtin", "Other", 0, true), row("custom", "Garden", 0), row("used", "Home", 2)];
    expect(unusedSweepIds(rows)).toEqual(["custom"]);
  });

  it("sees a builtin selected before a filter hid it", () => {
    const rows = [row("builtin", "Other", 0, true), row("custom", "Garden", 0)];
    expect(selectionHasBuiltin(rows, ["builtin", "custom"])).toBe(true);
    expect(selectionHasBuiltin(rows, ["custom"])).toBe(false);
  });

  it("offers no create or merge for categories", () => {
    expect(canCreate("categories")).toBe(false);
    expect(canMerge("categories")).toBe(false);
    for (const kind of ["tags", "correspondents", "document-types"] as const) {
      expect(canCreate(kind)).toBe(true);
      expect(canMerge(kind)).toBe(true);
    }
  });
});

describe("what a deletion says first", () => {
  const rows = [row("a", "A", 3), row("b", "B", 4), row("c", "C", 0), row("d", "D", null)];

  it("adds up the documents affected", () => {
    expect(affectedCount(rows, ["a", "b", "c"])).toBe(7);
    expect(affectedCount(rows, ["c"])).toBe(0);
  });

  it("does not call an unknown count zero", () => {
    expect(affectedCount(rows, ["a", "d"])).toBeNull();
    expect(describeDeletion("tags", null, false).key).toBe("taxonomy.deleteUnknownCount");
  });

  it("names documents, in the right number", () => {
    expect(describeDeletion("tags", 7, false)).toEqual({ key: "taxonomy.bulkDeleteMany", count: 7 });
    expect(describeDeletion("tags", 1, false).key).toBe("taxonomy.bulkDeleteOneDoc");
    expect(describeDeletion("tags", 0, false).key).toBe("taxonomy.bulkDeleteNone");
    expect(describeDeletion("tags", 7, true).key).toBe("taxonomy.deleteOne");
  });

  it("names correspondents for a category, whose count is not documents", () => {
    expect(describeDeletion("categories", 2, false)).toEqual({
      key: "taxonomy.bulkDeleteCorrespondents",
      count: 2,
    });
    expect(describeDeletion("categories", 2, true).key).toBe("taxonomy.bulkDeleteCorrespondents");
  });
});

describe("merge targets", () => {
  const many = Array.from({ length: 120 }, (_, index) => row(`r${index}`, `Entry ${index}`, index));

  it("never offer a source", () => {
    const { items } = mergeTargetOptions(many, { sourceIds: ["r0", "r1"], selectedId: null, query: "" });
    expect(items.some((entry) => entry.id === "r0" || entry.id === "r1")).toBe(false);
  });

  it("cap the list and say so, and filter reaches the rest", () => {
    const capped = mergeTargetOptions(many, { sourceIds: [], selectedId: null, query: "" });
    expect(capped.items).toHaveLength(MERGE_TARGET_LIMIT);
    expect(capped.truncated).toBe(true);
    const filtered = mergeTargetOptions(many, { sourceIds: [], selectedId: null, query: "entry 119" });
    expect(filtered.items.map((entry) => entry.id)).toEqual(["r119"]);
    expect(filtered.truncated).toBe(false);
  });

  it("keep the chosen one visible whatever the filter says", () => {
    const { items } = mergeTargetOptions(many, { sourceIds: [], selectedId: "r119", query: "entry 1" });
    expect(items[0].id).toBe("r119");
  });
});

describe("providers", () => {
  const cfg: ProviderConfig = {
    activeParseProvider: "local-ocr",
    fallbackParseProvider: "mistral-ocr",
    activeChatProvider: "openai",
    activeEmbeddingProvider: "voyage",
    openaiModel: "gpt",
    hasOpenAiKey: true,
    hasGeminiKey: false,
    hasMistralKey: true,
    hasVoyageKey: true,
    hasGoogleCloudConfig: false,
    hasAwsTextractConfig: true,
    hasAzureDocumentIntelligenceConfig: false,
    hasMistralOcrConfig: true,
    hasMistralEmbeddingConfig: false,
  };
  const providers: HealthProviders = {
    activeParseProvider: "local-ocr",
    fallbackParseProvider: "mistral-ocr",
    activeChatProvider: "openai",
    activeEmbeddingProvider: "voyage",
    parseProviders: [
      { id: "local-ocr", available: true },
      { id: "mistral-ocr", available: true },
      { id: "amazon-textract", available: false },
      { id: "azure-ai-document-intelligence", available: false },
    ],
    embeddingProviders: [
      { id: "voyage", available: true, model: "voyage-3" },
      { id: "openai", available: false, model: null },
    ],
  };
  const [parsing, embeddings, chat] = buildProviderGroups(cfg, providers);
  const tone = (group: typeof parsing, id: string) => group.rows.find((entry) => entry.id === id)?.tone;

  it("marks the active, the fallback and the unavailable", () => {
    expect(tone(parsing, "local-ocr")).toBe("active");
    expect(tone(parsing, "mistral-ocr")).toBe("fallback");
    expect(tone(parsing, "amazon-textract")).toBe("incomplete");
    expect(tone(parsing, "azure-ai-document-intelligence")).toBe("unconfigured");
    expect(tone(embeddings, "voyage")).toBe("active");
    expect(tone(embeddings, "openai")).toBe("incomplete");
  });

  it("marks chat by its key", () => {
    expect(tone(chat, "openai")).toBe("active");
    expect(tone(chat, "mistral")).toBe("available");
    expect(tone(chat, "gemini")).toBe("unconfigured");
    expect(chat.rows.find((entry) => entry.id === "gemini")?.noteKey).toBe("noKey");
  });

  it("does not mistake an active provider without a key for active", () => {
    const [, , noKey] = buildProviderGroups({ ...cfg, hasOpenAiKey: false }, providers);
    expect(tone(noKey, "openai")).toBe("unconfigured");
  });

  it("averages finished jobs and counts failures in the window", () => {
    const job = (fields: Partial<ProcessingJob>): ProcessingJob => ({
      id: "j",
      documentId: "d",
      queueName: "q",
      status: "completed",
      attempts: 1,
      lastError: null,
      startedAt: null,
      finishedAt: null,
      createdAt: "2026-03-20T08:00:00.000Z",
      ...fields,
    });
    const stats = jobStats([
      job({ startedAt: "2026-03-20T08:00:00.000Z", finishedAt: "2026-03-20T08:00:10.000Z" }),
      job({ startedAt: "2026-03-20T08:00:00.000Z", finishedAt: "2026-03-20T08:00:20.000Z", status: "failed" }),
      job({ status: "running", startedAt: "2026-03-20T08:00:00.000Z" }),
    ]);
    expect(stats).toEqual({ failed: 1, avgSeconds: "15.0" });
    expect(jobStats([]).avgSeconds).toBeNull();
    expect(jobDuration("2026-03-20T08:00:10.000Z", "2026-03-20T08:00:00.000Z")).toBeNull();
  });
});

describe("archive snapshots", () => {
  it("accepts something shaped like an export and counts its documents", () => {
    const parsed = parseArchiveSnapshot(JSON.stringify({ version: 1, documents: [{}, {}] }));
    expect(parsed?.documentCount).toBe(2);
    expect(parsed?.snapshot.version).toBe(1);
  });

  it.each(["not json", "[]", "null", "3", "{}", '{"documents":"nope"}'])(
    "refuses %s before anything is offered to the server",
    (text) => {
      expect(parseArchiveSnapshot(text)).toBeNull();
    },
  );
});

describe("archive export", () => {
  const messages = { failed: "failed", shareUnavailable: "no sharing", dialogTitle: "Export" };

  beforeEach(() => {
    jest.clearAllMocks();
    (Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(true);
    (Sharing.shareAsync as jest.Mock).mockResolvedValue(undefined);
  });

  it("writes the snapshot, offers it, and removes the file afterwards", async () => {
    const authFetch = jest.fn(async () => ({ ok: true, text: async () => '{"documents":[]}' }) as Response);

    await shareArchiveExport(authFetch, messages);

    expect(authFetch).toHaveBeenCalledWith("/api/archive/export");
    const uri = (FileSystem.writeAsStringAsync as jest.Mock).mock.calls[0][0];
    expect(uri).toContain(ARCHIVE_EXPORT_FILENAME);
    expect((FileSystem.writeAsStringAsync as jest.Mock).mock.calls[0][1]).toBe('{"documents":[]}');
    expect(Sharing.shareAsync).toHaveBeenCalledWith(uri, expect.objectContaining({ mimeType: "application/json" }));
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith(uri, { idempotent: true });
  });

  it("removes the file when sharing fails too", async () => {
    (Sharing.shareAsync as jest.Mock).mockRejectedValue(new Error("nope"));
    const authFetch = jest.fn(async () => ({ ok: true, text: async () => "{}" }) as Response);

    await expect(shareArchiveExport(authFetch, messages)).rejects.toThrow("nope");
    expect(FileSystem.deleteAsync).toHaveBeenCalled();
  });

  it("does not ask the server when the device cannot share", async () => {
    (Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(false);
    const authFetch = jest.fn();

    await expect(shareArchiveExport(authFetch, messages)).rejects.toThrow("no sharing");
    expect(authFetch).not.toHaveBeenCalled();
  });

  it("reports the server's refusal and writes nothing", async () => {
    const authFetch = jest.fn(
      async () => ({ ok: false, status: 500, text: async () => '{"message":"Export broke"}' }) as Response,
    );
    await expect(shareArchiveExport(authFetch, messages)).rejects.toThrow("Export broke");
    expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled();
  });
});

describe("token lifetimes", () => {
  it("are presets counted from today, or none", () => {
    expect(expiryFromPreset(null)).toBeNull();
    expect(expiryFromPreset(30, new Date(2026, 2, 20, 12))).toBe(new Date(2026, 3, 19, 12).toISOString());
  });
});
