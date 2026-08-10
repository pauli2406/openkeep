import type {
  ArchiveProfileRepository,
  StoredArchiveSession,
} from "../archive-session";
import { ProfileStorage } from "./profile-storage";

export function createArchiveProfileRepository(
  storage: ProfileStorage,
): ArchiveProfileRepository {
  return {
    assertSecureStorageAvailable: () => storage.assertSecureStorageAvailable(),

    async loadActive(): Promise<StoredArchiveSession | null> {
      const active = await storage.getActiveProfile();
      if (!active) {
        return null;
      }
      return {
        profile: {
          id: active.profile.id,
          label: active.profile.label || new URL(active.profile.archiveUrl).hostname,
          serverUrl: active.profile.archiveUrl,
          allowInsecureHttp: active.profile.allowInsecureHttp,
        },
        credentials: active.credentials,
      };
    },

    async saveActive(session) {
      await storage.saveProfile(
        {
          id: session.profile.id,
          archiveUrl: session.profile.serverUrl,
          label: session.profile.label,
          allowInsecureHttp: session.profile.allowInsecureHttp,
        },
        session.credentials,
      );
    },

    async clear() {
      const snapshot = await storage.snapshot();
      await Promise.all(snapshot.profiles.map((profile) => storage.deleteProfile(profile.id)));
    },
  };
}
