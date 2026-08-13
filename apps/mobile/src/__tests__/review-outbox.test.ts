/**
 * A confirm that was tapped but not sent.
 *
 * Confirming is held for the undo window so undo cannot race an in-flight
 * resolve — which left one gap: kill the app inside those five seconds and the
 * confirm was never sent. The document stayed in the queue, which is safe, but
 * the user had watched it be accepted.
 */
import {
  PENDING_CONFIRM_TTL_MS,
  createReviewOutbox,
  type OutboxStorage,
} from "../review-outbox";

function createStorage(initial?: Record<string, string>) {
  const entries = new Map(Object.entries(initial ?? {}));
  const storage: OutboxStorage & { entries: Map<string, string> } = {
    entries,
    getItem: async (key) => entries.get(key) ?? null,
    setItem: async (key, value) => void entries.set(key, value),
    removeItem: async (key) => void entries.delete(key),
  };
  return storage;
}

const SCOPE = "user--archive-example";
const HELD_AT = new Date("2026-03-04T09:00:00.000Z");

describe("holding a confirm", () => {
  it("writes it down before the undo window opens", async () => {
    const storage = createStorage();
    const outbox = createReviewOutbox({ storage, now: () => HELD_AT });

    await outbox.hold({ documentId: "doc-1", scope: SCOPE });

    expect(await outbox.read()).toEqual({
      documentId: "doc-1",
      scope: SCOPE,
      heldAt: HELD_AT.toISOString(),
    });
  });

  it("forgets it once it has been sent or taken back", async () => {
    const storage = createStorage();
    const outbox = createReviewOutbox({ storage, now: () => HELD_AT });
    await outbox.hold({ documentId: "doc-1", scope: SCOPE });

    await outbox.release();

    expect(await outbox.read()).toBeNull();
    expect(storage.entries.size).toBe(0);
  });

  it("keeps only the newest, since only one confirm can be taken back", async () => {
    const storage = createStorage();
    const outbox = createReviewOutbox({ storage, now: () => HELD_AT });

    await outbox.hold({ documentId: "doc-1", scope: SCOPE });
    await outbox.hold({ documentId: "doc-2", scope: SCOPE });

    expect((await outbox.read())?.documentId).toBe("doc-2");
  });
});

describe("replaying after a kill", () => {
  it("sends the confirm the app died on top of", async () => {
    const storage = createStorage();
    const outbox = createReviewOutbox({ storage, now: () => HELD_AT });
    await outbox.hold({ documentId: "doc-1", scope: SCOPE });
    const sent: string[] = [];

    const outcome = await outbox.flush({
      scope: SCOPE,
      send: async (documentId) => void sent.push(documentId),
    });

    expect(outcome).toBe("sent");
    expect(sent).toEqual(["doc-1"]);
    // Sent once: a second launch must not resolve it again.
    expect(await outbox.read()).toBeNull();
  });

  it("does nothing when there is nothing held", async () => {
    const outbox = createReviewOutbox({ storage: createStorage(), now: () => HELD_AT });

    expect(await outbox.flush({ scope: SCOPE, send: async () => undefined })).toBe("empty");
  });

  it("keeps the confirm when the send fails", async () => {
    // A failed send is a network problem, not a reason to lose the confirm a
    // second time.
    const storage = createStorage();
    const outbox = createReviewOutbox({ storage, now: () => HELD_AT });
    await outbox.hold({ documentId: "doc-1", scope: SCOPE });

    const outcome = await outbox.flush({
      scope: SCOPE,
      send: async () => {
        throw new Error("offline");
      },
    });

    expect(outcome).toBe("failed");
    expect((await outbox.read())?.documentId).toBe("doc-1");
  });

  it("will not send one account's confirm to another's archive", async () => {
    const storage = createStorage();
    const outbox = createReviewOutbox({ storage, now: () => HELD_AT });
    await outbox.hold({ documentId: "doc-1", scope: SCOPE });
    const sent: string[] = [];

    const outcome = await outbox.flush({
      scope: "someone-else--archive-example",
      send: async (documentId) => void sent.push(documentId),
    });

    expect(outcome).toBe("foreign");
    expect(sent).toEqual([]);
    // Kept, not dropped: signing back in as the original account still sends it.
    expect((await outbox.read())?.documentId).toBe("doc-1");
  });

  it("drops a confirm too old to be meaningful", async () => {
    const storage = createStorage();
    const outbox = createReviewOutbox({
      storage,
      now: () => new Date(HELD_AT.getTime() + PENDING_CONFIRM_TTL_MS + 1),
    });
    await storage.setItem(
      "openkeep.mobile.review-outbox",
      JSON.stringify({ documentId: "doc-1", scope: SCOPE, heldAt: HELD_AT.toISOString() }),
    );
    const sent: string[] = [];

    const outcome = await outbox.flush({
      scope: SCOPE,
      send: async (documentId) => void sent.push(documentId),
    });

    // The document is still in the review queue, which is the honest outcome for
    // a tap the user cannot be expected to remember.
    expect(outcome).toBe("expired");
    expect(sent).toEqual([]);
    expect(await outbox.read()).toBeNull();
  });

  it("treats an unreadable record as nothing held", async () => {
    const storage = createStorage({ "openkeep.mobile.review-outbox": "{not json" });
    const outbox = createReviewOutbox({ storage, now: () => HELD_AT });

    expect(await outbox.read()).toBeNull();
    expect(await outbox.flush({ scope: SCOPE, send: async () => undefined })).toBe("empty");
  });

  it("treats a record of the wrong shape as nothing held", async () => {
    const storage = createStorage({
      "openkeep.mobile.review-outbox": JSON.stringify({ unexpected: "shape" }),
    });
    const outbox = createReviewOutbox({ storage, now: () => HELD_AT });

    expect(await outbox.read()).toBeNull();
  });

  it("survives storage that cannot be read", async () => {
    const outbox = createReviewOutbox({
      storage: {
        getItem: async () => {
          throw new Error("storage unavailable");
        },
        setItem: async () => undefined,
        removeItem: async () => undefined,
      },
      now: () => HELD_AT,
    });

    expect(await outbox.read()).toBeNull();
  });
});
