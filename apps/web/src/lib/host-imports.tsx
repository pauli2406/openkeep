import { createContext, useContext, type ReactNode } from "react";

export type HostImportFile = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  bytes: Uint8Array;
};

export type HostImportRejection = {
  id: string;
  name: string;
  message: string;
};

export type HostImportDelivery = {
  files: HostImportFile[];
  rejected: HostImportRejection[];
};

/**
 * Optional seam for a trusted host such as Electron. It exposes document
 * selection and already-validated bytes, never paths or arbitrary file reads.
 */
export type HostImportAdapter = {
  pickFiles: () => Promise<HostImportDelivery>;
  takePending: () => HostImportDelivery;
  subscribe: (listener: () => void) => () => void;
};

const HostImportsContext = createContext<HostImportAdapter | null>(null);

export function HostImportsProvider({
  adapter,
  children,
}: {
  adapter?: HostImportAdapter;
  children: ReactNode;
}) {
  return (
    <HostImportsContext.Provider value={adapter ?? null}>
      {children}
    </HostImportsContext.Provider>
  );
}

export function useHostImports() {
  return useContext(HostImportsContext);
}
