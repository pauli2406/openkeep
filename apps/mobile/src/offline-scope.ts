/**
 * Which archive and which account an offline copy belongs to.
 *
 * The cache used to be global: one database name, no owner column, and cached
 * query keys that left the archive URL out. Change the URL or sign in as
 * someone else without signing out first, and the offline surfaces served the
 * previous account's documents — titles, recognised text and file bytes.
 *
 * The scope is part of the database name and the files directory rather than a
 * column, so a query cannot forget to filter by it. That is the whole point:
 * isolation that does not depend on every future `WHERE` clause being right.
 */

export type OfflineScopeIdentity = {
  apiUrl: string | null | undefined;
  userId: string | null | undefined;
};

/** Keeps a scope usable as a filename on every platform. */
function sanitize(value: string) {
  return value
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * `null` when there is no identity yet — at first launch, or after a sign-out.
 * Callers must treat that as "no cache to read", never as "use the shared one":
 * a shared one is what leaked.
 *
 * The user id is a UUID, so scope keys are unique without hashing; the host is
 * included because the same account id on a different archive is a different
 * archive.
 */
export function offlineCacheScope({ apiUrl, userId }: OfflineScopeIdentity): string | null {
  if (!apiUrl || !userId) {
    return null;
  }
  const host = sanitize(apiUrl);
  const user = sanitize(userId);
  if (!host || !user) {
    return null;
  }
  return `${user}--${host}`;
}

export function offlineCacheDatabaseName(scope: string) {
  return `openkeep-cache-${scope}.db`;
}

export function offlineCacheDirectoryName(scope: string) {
  return `openkeep-cache/${scope}`;
}

/** The unscoped database and directory this replaced, removed once on upgrade. */
export const LEGACY_UNSCOPED_DATABASE = "openkeep-cache.db";
export const LEGACY_UNSCOPED_FILES_DIR = "openkeep-cache/files";
