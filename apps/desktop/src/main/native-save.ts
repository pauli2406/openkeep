import { randomUUID } from "node:crypto";
import { open, rename, rm } from "node:fs/promises";
import path from "node:path";
import type {
  DesktopSaveRequest,
  DesktopSaveResult,
} from "../shared/desktop-api";
import type { ArchiveSessionService } from "./archive-session";
import {
  createArchiveRequestHeaders,
  resolveArchiveApiUrl,
  type DesktopFetch,
} from "./connection";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const MAX_FILENAME_LENGTH = 180;

export type NativeSaveDialogOptions = {
  title: string;
  suggestedFilename: string;
  mimeType: string;
  extensions: string[];
};

export type NativeSaveDialogResult =
  | { cancelled: true }
  | { cancelled: false; filePath: string };

type NativeSaveDependencies = {
  archiveSession: Pick<ArchiveSessionService, "getActiveSession">;
  fetchRequest: DesktopFetch;
  showSaveDialog: (
    options: NativeSaveDialogOptions,
  ) => Promise<NativeSaveDialogResult>;
};

type SaveDescriptor = {
  apiPath: string;
  fallbackFilename: string;
  title: string;
  requiredExtension?: string;
};

function descriptorFor(request: DesktopSaveRequest): SaveDescriptor {
  switch (request.kind) {
    case "document-original":
      return {
        apiPath: `/api/documents/${encodeURIComponent(request.documentId)}/download`,
        fallbackFilename: "document.bin",
        title: "Save original document",
      };
    case "document-searchable":
      return {
        apiPath: `/api/documents/${encodeURIComponent(request.documentId)}/download/searchable`,
        fallbackFilename: "document.searchable.pdf",
        title: "Save searchable PDF",
        requiredExtension: ".pdf",
      };
    case "archive-export":
      return {
        apiPath: "/api/archive/export",
        fallbackFilename: "openkeep-archive-export.json",
        title: "Save archive export",
        requiredExtension: ".json",
      };
  }
}

function isSaveRequest(input: unknown): input is DesktopSaveRequest {
  if (!input || typeof input !== "object") return false;
  const candidate = input as { kind?: unknown; documentId?: unknown };
  const keys = Object.keys(candidate);
  if (candidate.kind === "archive-export") {
    return keys.length === 1 && keys[0] === "kind";
  }
  return (
    keys.length === 2 &&
    keys.includes("kind") &&
    keys.includes("documentId") &&
    (candidate.kind === "document-original" ||
      candidate.kind === "document-searchable") &&
    typeof candidate.documentId === "string" &&
    UUID_PATTERN.test(candidate.documentId)
  );
}

function unquoteParameter(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\(["\\])/g, "$1");
  }
  return trimmed;
}

function filenameFromDisposition(disposition: string | null): string | null {
  if (!disposition) return null;

  const encoded = /(?:^|;)\s*filename\*\s*=\s*([^;]+)/i.exec(disposition)?.[1];
  if (encoded) {
    const raw = unquoteParameter(encoded);
    const match = /^[^']*'[^']*'(.*)$/.exec(raw);
    try {
      return decodeURIComponent(match?.[1] ?? raw);
    } catch {
      // Fall back to the ASCII filename parameter below.
    }
  }

  const quoted = /(?:^|;)\s*filename\s*=\s*"((?:\\.|[^"])*)"/i.exec(
    disposition,
  )?.[1];
  if (quoted !== undefined) {
    return quoted.replace(/\\(["\\])/g, "$1");
  }
  return /(?:^|;)\s*filename\s*=\s*([^;]+)/i.exec(disposition)?.[1]?.trim() ?? null;
}

function mimeExtension(mimeType: string): string | null {
  const normalized = mimeType.split(";", 1)[0]?.trim().toLowerCase();
  return (
    {
      "application/pdf": ".pdf",
      "application/json": ".json",
      "image/jpeg": ".jpg",
      "image/png": ".png",
      "image/tiff": ".tiff",
      "text/plain": ".txt",
      "text/csv": ".csv",
      "application/zip": ".zip",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        ".docx",
    }[normalized ?? ""] ?? null
  );
}

function forceExtension(filename: string, requiredExtension: string) {
  const currentExtension = path.extname(filename);
  const stem = currentExtension
    ? filename.slice(0, -currentExtension.length)
    : filename;
  return `${stem || "document"}${requiredExtension}`;
}

export function sanitizeSuggestedFilename(
  candidate: string | null,
  fallback: string,
  mimeType: string,
  requiredExtension?: string,
) {
  let filename = (candidate || fallback)
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim();

  if (!filename || filename === "." || filename === "..") {
    filename = fallback;
  }
  if (filename.startsWith(".")) {
    filename = `_${filename}`;
  }
  if (WINDOWS_RESERVED_NAME.test(filename)) {
    filename = `_${filename}`;
  }

  if (requiredExtension) {
    filename = forceExtension(filename, requiredExtension);
  } else if (!path.extname(filename)) {
    filename += mimeExtension(mimeType) ?? (path.extname(fallback) || ".bin");
  }

  if (filename.length > MAX_FILENAME_LENGTH) {
    const extension = path.extname(filename);
    filename = `${filename.slice(0, MAX_FILENAME_LENGTH - extension.length)}${extension}`;
  }
  return filename;
}

function dialogExtensions(filename: string) {
  const extension = path.extname(filename).replace(/^\./, "").toLowerCase();
  return extension ? [extension] : [];
}

async function writeResponseAtomically(
  response: Response,
  destinationPath: string,
  signal: AbortSignal,
) {
  if (!response.body) {
    throw new Error("response-body-missing");
  }

  const temporaryPath = path.join(
    path.dirname(destinationPath),
    `.openkeep-${randomUUID()}.part`,
  );
  const handle = await open(temporaryPath, "wx", 0o600);
  const reader = response.body.getReader();
  let committed = false;
  let closed = false;

  try {
    let position = 0;
    while (true) {
      if (signal.aborted) throw new Error("save-aborted");
      const { done, value } = await reader.read();
      if (done) break;
      let offset = 0;
      while (offset < value.byteLength) {
        const { bytesWritten } = await handle.write(
          value,
          offset,
          value.byteLength - offset,
          position,
        );
        if (bytesWritten === 0) throw new Error("zero-byte-write");
        offset += bytesWritten;
        position += bytesWritten;
      }
    }
    await handle.sync();
    await handle.close();
    closed = true;
    await rename(temporaryPath, destinationPath);
    committed = true;
  } finally {
    if (!closed) await handle.close().catch(() => undefined);
    await reader.cancel().catch(() => undefined);
    if (!committed) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }
}

export function createNativeSaveService(dependencies: NativeSaveDependencies) {
  return {
    async save(
      profileId: string | null | undefined,
      input: unknown,
    ): Promise<DesktopSaveResult> {
      if (!profileId || !isSaveRequest(input)) {
        return {
          status: "failed",
          message: "OpenKeep could not start this save request.",
        };
      }

      const active = dependencies.archiveSession.getActiveSession();
      if (!active || active.profile.id !== profileId) {
        return {
          status: "failed",
          message: "Connect to the selected OpenKeep archive before saving.",
        };
      }

      const descriptor = descriptorFor(input);
      let response: Response;
      try {
        response = await dependencies.fetchRequest(
          resolveArchiveApiUrl(active.profile.serverUrl, descriptor.apiPath),
          {
            method: "GET",
            headers: createArchiveRequestHeaders(active.credentials),
            redirect: "manual",
            signal: active.signal,
          },
        );
      } catch {
        return {
          status: "failed",
          message: "OpenKeep could not reach the active archive to save this file.",
        };
      }

      if (!response.ok || !response.body) {
        await response.body?.cancel().catch(() => undefined);
        return {
          status: "failed",
          message: `The active archive could not provide this file (HTTP ${response.status}).`,
        };
      }

      const mimeType =
        response.headers.get("content-type")?.split(";", 1)[0]?.trim() ||
        "application/octet-stream";
      const suggestedFilename = sanitizeSuggestedFilename(
        filenameFromDisposition(response.headers.get("content-disposition")),
        descriptor.fallbackFilename,
        mimeType,
        descriptor.requiredExtension,
      );

      let selection: NativeSaveDialogResult;
      try {
        selection = await dependencies.showSaveDialog({
          title: descriptor.title,
          suggestedFilename,
          mimeType,
          extensions: dialogExtensions(suggestedFilename),
        });
      } catch {
        await response.body.cancel().catch(() => undefined);
        return {
          status: "failed",
          message: "OpenKeep could not open the operating-system save dialog.",
        };
      }

      if (selection.cancelled) {
        await response.body.cancel().catch(() => undefined);
        return { status: "cancelled" };
      }

      try {
        await writeResponseAtomically(response, selection.filePath, active.signal);
        return { status: "saved" };
      } catch {
        await response.body.cancel().catch(() => undefined);
        return {
          status: "failed",
          message:
            "OpenKeep could not write the selected file. Check the destination and its permissions, then try again.",
        };
      }
    },
  };
}

export type NativeSaveService = ReturnType<typeof createNativeSaveService>;
