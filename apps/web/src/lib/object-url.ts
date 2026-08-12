export interface ObjectUrlApi {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
}

/** Owns at most one temporary browser resource and releases it on replacement. */
export function createObjectUrlLease(api: ObjectUrlApi = URL) {
  let current: string | null = null;
  let disposed = false;

  return {
    replace(blob: Blob) {
      if (disposed) return null;
      if (current) api.revokeObjectURL(current);
      current = api.createObjectURL(blob);
      return current;
    },
    dispose() {
      disposed = true;
      if (current) {
        api.revokeObjectURL(current);
        current = null;
      }
    },
  };
}
