import { normalizeArchiveUrl } from "./connection";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const DESKTOP_SHELL_PARTITION = "openkeep-shell";

export interface ProfilePartitionProfile {
  id: string;
  serverUrl: string;
  label?: string;
}

function normalizeProfileId(profileId: string): string {
  if (!UUID_PATTERN.test(profileId)) {
    throw new Error("Profile ID must be a valid UUID.");
  }

  return profileId.toLowerCase();
}

export function createProfilePartition(profileId: string): string {
  return `persist:openkeep-profile-${normalizeProfileId(profileId)}`;
}

export function shouldResetProfilePartition(
  previous: ProfilePartitionProfile,
  next: ProfilePartitionProfile,
): boolean {
  const previousId = normalizeProfileId(previous.id);
  const nextId = normalizeProfileId(next.id);

  return (
    previousId === nextId &&
    normalizeArchiveUrl(previous.serverUrl) !==
      normalizeArchiveUrl(next.serverUrl)
  );
}
