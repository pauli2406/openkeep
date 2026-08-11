import type {
  ArchiveProfile,
  ArchiveProfileRepository,
  StoredArchiveSession,
} from "../archive-session";
import type { ArchiveProfile as StoredArchiveProfile } from "./types";
import { ProfileStorage } from "./profile-storage";

function toArchiveProfile(profile: StoredArchiveProfile): ArchiveProfile {
  return {
    id: profile.id,
    label: profile.label || new URL(profile.archiveUrl).hostname,
    serverUrl: profile.archiveUrl,
    allowInsecureHttp: profile.allowInsecureHttp,
  };
}

export function createArchiveProfileRepository(
  storage: ProfileStorage,
): ArchiveProfileRepository {
  return {
    assertSecureStorageAvailable: () => storage.assertSecureStorageAvailable(),

    async snapshot() {
      const snapshot = await storage.snapshot();
      return {
        profiles: snapshot.profiles.map(toArchiveProfile),
        lastActiveProfileId: snapshot.lastActiveProfileId,
      };
    },

    async load(profileId: string): Promise<StoredArchiveSession | null> {
      const stored = await storage.loadProfile(profileId);
      return stored
        ? {
            profile: toArchiveProfile(stored.profile),
            credentials: stored.credentials,
          }
        : null;
    },

    async save(session) {
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

    setActive: (profileId) => storage.setActiveProfile(profileId),

    async rename(profileId, label) {
      return toArchiveProfile(await storage.renameProfile(profileId, label));
    },

    remove: (profileId) => storage.deleteProfile(profileId),
  };
}
