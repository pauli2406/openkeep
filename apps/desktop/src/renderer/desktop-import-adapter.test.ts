import { describe, expect, it, vi } from "vitest";
import { createDesktopImportAdapter } from "./desktop-import-adapter";

describe("desktop host import adapter", () => {
  it("buffers deliveries, notifies subscribers, and releases each file once", () => {
    const pipeline = createDesktopImportAdapter(async () => ({
      files: [],
      rejected: [],
    }));
    const changed = vi.fn();
    const unsubscribe = pipeline.adapter.subscribe(changed);
    pipeline.publish({
      files: [
        {
          id: "file-one",
          name: "invoice.pdf",
          mimeType: "application/pdf",
          size: 5,
          bytes: new Uint8Array([1, 2, 3, 4, 5]),
        },
      ],
      rejected: [],
    });

    expect(changed).toHaveBeenCalledOnce();
    expect(pipeline.adapter.takePending().files).toHaveLength(1);
    expect(pipeline.adapter.takePending()).toEqual({ files: [], rejected: [] });

    unsubscribe();
    pipeline.publish({ files: [], rejected: [] });
    expect(changed).toHaveBeenCalledOnce();
  });
});
