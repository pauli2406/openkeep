import { createHash } from "node:crypto";
import {
  createArchiveRequestHeaders,
  resolveArchiveApiUrl,
  type DesktopFetch,
} from "./connection";
import type { ArchiveSessionService } from "./archive-session";
import type { DesktopImportDelivery } from "../shared/desktop-api";

/**
 * What happened to one watch-folder file.
 *
 * `duplicate` means the archive already holds these bytes — either this
 * workstation imported them before under another name, or the server matched
 * the checksum. `rejected` is permanent for this content and must not be
 * retried; `retry` is transient and should be attempted again later.
 */
export type WatchFolderUploadResult =
  | { status: "imported"; checksum: string }
  | { status: "duplicate"; checksum: string; message: string }
  | { status: "rejected"; message: string }
  | { status: "retry"; message: string };

export type WatchFolderUploadRequest = {
  filePath: string;
  profileId: string;
  isKnownChecksum: (checksum: string) => boolean;
};

type ImportReaderPort = {
  readPaths(paths: string[]): Promise<DesktopImportDelivery>;
};

/**
 * Sends one settled watch-folder file to its archive through the same
 * validation the interactive desktop import uses, then the same
 * `POST /api/documents` the web import posts to. Source files are only ever
 * opened for reading.
 */
export function createWatchFolderUploader({
  imports,
  archiveSession,
  fetchRequest,
}: {
  imports: ImportReaderPort;
  archiveSession: Pick<ArchiveSessionService, "getActiveSession">;
  fetchRequest: DesktopFetch;
}) {
  return {
    async upload({
      filePath,
      profileId,
      isKnownChecksum,
    }: WatchFolderUploadRequest): Promise<WatchFolderUploadResult> {
      const active = archiveSession.getActiveSession();
      if (!active || active.profile.id !== profileId) {
        return { status: "retry", message: "The archive is not connected." };
      }

      const delivery = await imports.readPaths([filePath]);
      const file = delivery.files[0];
      if (!file) {
        const rejection = delivery.rejected[0];
        // A file that vanished or is still locked can succeed later; a wrong
        // format or an oversized file cannot.
        return rejection && rejection.code === "inaccessible"
          ? { status: "retry", message: rejection.message }
          : {
              status: "rejected",
              message: rejection?.message ?? "The file could not be read.",
            };
      }

      const checksum = createHash("sha256").update(file.bytes).digest("hex");
      if (isKnownChecksum(checksum)) {
        return {
          status: "duplicate",
          checksum,
          message: "These contents were already imported into this archive.",
        };
      }

      const body = new FormData();
      body.append(
        "file",
        new File([new Uint8Array(file.bytes)], file.name, { type: file.mimeType }),
      );

      let response: Response;
      try {
        response = await fetchRequest(
          resolveArchiveApiUrl(active.profile.serverUrl, "/api/documents"),
          {
            method: "POST",
            headers: createArchiveRequestHeaders(active.credentials),
            body,
            signal: active.signal,
          },
        );
      } catch {
        return { status: "retry", message: "The archive could not be reached." };
      }

      if (!response.ok) {
        const message = `The archive rejected this file (HTTP ${response.status}).`;
        // 4xx other than 408/429 will not change on its own; anything else is
        // worth another attempt.
        const permanent =
          response.status >= 400 &&
          response.status < 500 &&
          response.status !== 408 &&
          response.status !== 429;
        return permanent
          ? { status: "rejected", message }
          : { status: "retry", message };
      }

      let created: { duplicateOf?: { id: string } | null } = {};
      try {
        created = (await response.json()) as typeof created;
      } catch {
        // The upload succeeded; only the confirmation body was unreadable.
      }
      return created.duplicateOf
        ? {
            status: "duplicate",
            checksum,
            message: "The archive already holds a document with these contents.",
          }
        : { status: "imported", checksum };
    },
  };
}

export type WatchFolderUploader = ReturnType<typeof createWatchFolderUploader>;
