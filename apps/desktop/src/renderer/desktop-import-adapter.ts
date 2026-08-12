import type {
  HostImportAdapter,
  HostImportDelivery,
} from "@openkeep/web/app";

const EMPTY_DELIVERY: HostImportDelivery = { files: [], rejected: [] };

export function createDesktopImportAdapter(
  pickFiles: () => Promise<HostImportDelivery>,
  reportCreated: (
    documents: Array<{ documentId: string; name: string }>,
  ) => void = (documents) => {
    void window.openkeepDesktop.imports.reportCreated({ documents });
  },
) {
  let pending: HostImportDelivery = EMPTY_DELIVERY;
  const listeners = new Set<() => void>();

  const adapter: HostImportAdapter = {
    pickFiles,
    takePending() {
      const delivery = pending;
      pending = EMPTY_DELIVERY;
      return delivery;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reportCreated,
  };

  return {
    adapter,
    publish(delivery: HostImportDelivery) {
      pending = {
        files: [...pending.files, ...delivery.files],
        rejected: [...pending.rejected, ...delivery.rejected],
      };
      listeners.forEach((listener) => listener());
    },
  };
}
