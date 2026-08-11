import type {
  DesktopImportAssignInput,
  DesktopImportBatch,
  DesktopImportDelivery,
  DesktopImportsSnapshot,
  DesktopProfilesSnapshot,
} from "../shared/desktop-api";

type ImportOperations = {
  enqueuePaths(
    paths: string[],
    source: "open-with" | "picker",
  ): Promise<DesktopImportBatch | null>;
  listPending(profileId: string | null): DesktopImportBatch[];
  assign(batchId: string, profileId: string): DesktopImportBatch;
  consume(profileId: string): Promise<DesktopImportDelivery>;
  readPaths(paths: string[]): Promise<DesktopImportDelivery>;
};

export function createDesktopImportCoordinator({
  imports,
  listProfiles,
  onChanged,
}: {
  imports: ImportOperations;
  listProfiles: () => Promise<DesktopProfilesSnapshot>;
  onChanged: () => void;
}) {
  return {
    async receivePaths(paths: string[]) {
      const batch = await imports.enqueuePaths(paths, "open-with");
      if (!batch) return null;
      const profiles = await listProfiles();
      const assigned =
        profiles.profiles.length === 1
          ? imports.assign(batch.id, profiles.profiles[0]!.id)
          : batch;
      onChanged();
      return assigned;
    },

    async receivePickerPaths(paths: string[], profileId: string) {
      const profiles = await listProfiles();
      if (!profiles.profiles.some((profile) => profile.id === profileId)) {
        throw new Error("That archive profile is not available.");
      }
      const batch = await imports.enqueuePaths(paths, "picker");
      if (!batch) return null;
      const assigned = imports.assign(batch.id, profileId);
      onChanged();
      return assigned;
    },

    pending(profileId: string | null): DesktopImportsSnapshot {
      return { batches: imports.listPending(profileId) };
    },

    async assign(input: DesktopImportAssignInput) {
      if (
        !input ||
        typeof input.batchId !== "string" ||
        typeof input.profileId !== "string"
      ) {
        throw new Error("A pending import and archive profile are required.");
      }
      const profiles = await listProfiles();
      if (!profiles.profiles.some((profile) => profile.id === input.profileId)) {
        throw new Error("That archive profile is not available.");
      }
      const batch = imports.assign(input.batchId, input.profileId);
      onChanged();
      return batch;
    },

    async consume(profileId: string | null) {
      if (!profileId) return { files: [], rejected: [] };
      const delivery = await imports.consume(profileId);
      onChanged();
      return delivery;
    },

    pick(paths: string[]) {
      return imports.readPaths(paths);
    },
  };
}
