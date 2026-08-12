import { describe, expect, it, vi } from "vitest";
import { createObjectUrlLease } from "./object-url";

describe("object URL lease", () => {
  it("revokes replaced and disposed browser resources", () => {
    const createObjectURL = vi
      .fn()
      .mockReturnValueOnce("blob:first")
      .mockReturnValueOnce("blob:second");
    const revokeObjectURL = vi.fn();
    const lease = createObjectUrlLease({ createObjectURL, revokeObjectURL });

    expect(lease.replace(new Blob(["first"]))).toBe("blob:first");
    expect(lease.replace(new Blob(["second"]))).toBe("blob:second");
    expect(revokeObjectURL).toHaveBeenNthCalledWith(1, "blob:first");

    lease.dispose();

    expect(revokeObjectURL).toHaveBeenNthCalledWith(2, "blob:second");
    expect(lease.replace(new Blob(["late"]))).toBeNull();
    expect(createObjectURL).toHaveBeenCalledTimes(2);
  });
});
