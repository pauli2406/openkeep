import { open, realpath } from "node:fs/promises";
import path from "node:path";
import type {
  DesktopImportBatch,
  DesktopImportDelivery,
  DesktopImportFile,
  DesktopImportRejection,
  DesktopImportRejectionCode,
  DesktopImportSource,
} from "../shared/desktop-api";

export const DESKTOP_IMPORT_MAX_BYTES = 67_108_864;

const FORMAT_BY_EXTENSION = new Map<string, string>([
  [".pdf", "application/pdf"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".tif", "image/tiff"],
  [".tiff", "image/tiff"],
  [".heic", "image/heic"],
]);

type ImportReference = {
  id: string;
  path: string;
  name: string;
  mimeType: string;
  size: number;
};

type PendingBatch = {
  id: string;
  source: DesktopImportSource;
  profileId: string | null;
  files: ImportReference[];
  rejected: DesktopImportRejection[];
};

type ImportFailure = {
  code: DesktopImportRejectionCode;
  message: string;
};

export type DesktopImportService = ReturnType<typeof createDesktopImportService>;

function importFailure(
  code: DesktopImportRejectionCode,
  message: string,
): ImportFailure {
  return { code, message };
}

function hasPrefix(bytes: Uint8Array, prefix: number[]) {
  return prefix.every((value, index) => bytes[index] === value);
}

function matchesFormat(bytes: Uint8Array, mimeType: string) {
  switch (mimeType) {
    case "application/pdf":
      return hasPrefix(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
    case "image/jpeg":
      return hasPrefix(bytes, [0xff, 0xd8, 0xff]);
    case "image/png":
      return hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/tiff":
      return (
        hasPrefix(bytes, [0x49, 0x49, 0x2a, 0x00]) ||
        hasPrefix(bytes, [0x4d, 0x4d, 0x00, 0x2a])
      );
    case "image/heic": {
      if (!hasPrefix(bytes.slice(4), [0x66, 0x74, 0x79, 0x70])) return false;
      const brand = String.fromCharCode(...bytes.slice(8, 12));
      return ["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand);
    }
    default:
      return false;
  }
}

function publicBatch(batch: PendingBatch): DesktopImportBatch {
  return {
    id: batch.id,
    source: batch.source,
    profileId: batch.profileId,
    files: batch.files.map(({ id, name, mimeType, size }) => ({
      id,
      name,
      mimeType,
      size,
    })),
    rejected: batch.rejected,
  };
}

function rejectionMessage(code: DesktopImportRejectionCode) {
  switch (code) {
    case "unsupported-format":
      return "OpenKeep supports PDF, JPEG, PNG, TIFF, and HEIC files.";
    case "invalid-format":
      return "The file contents do not match the filename extension.";
    case "oversized":
      return "The file exceeds the desktop import limit of 64 MiB.";
    case "inaccessible":
      return "The file is missing, inaccessible, or is not a regular file.";
  }
}

async function inspectPath(
  inputPath: string,
  maxBytes: number,
): Promise<Omit<ImportReference, "id"> | ImportFailure> {
  const name = path.basename(inputPath) || "Unnamed file";
  const extension = path.extname(name).toLowerCase();
  const mimeType = FORMAT_BY_EXTENSION.get(extension);
  if (!mimeType) {
    return importFailure("unsupported-format", rejectionMessage("unsupported-format"));
  }

  let canonicalPath: string;
  try {
    canonicalPath = await realpath(inputPath);
  } catch {
    return importFailure("inaccessible", rejectionMessage("inaccessible"));
  }

  try {
    const file = await open(canonicalPath, "r");
    try {
      const stats = await file.stat();
      if (!stats.isFile()) {
        return importFailure("inaccessible", rejectionMessage("inaccessible"));
      }
      if (stats.size > maxBytes) {
        return importFailure("oversized", rejectionMessage("oversized"));
      }
      const header = Buffer.alloc(Math.min(16, stats.size));
      if (header.length > 0) {
        await file.read(header, 0, header.length, 0);
      }
      if (!matchesFormat(header, mimeType)) {
        return importFailure("invalid-format", rejectionMessage("invalid-format"));
      }
      return {
        path: canonicalPath,
        name: path.basename(canonicalPath),
        mimeType,
        size: stats.size,
      };
    } finally {
      await file.close();
    }
  } catch {
    return importFailure("inaccessible", rejectionMessage("inaccessible"));
  }
}

async function readReference(
  reference: ImportReference,
  maxBytes: number,
): Promise<DesktopImportFile | ImportFailure> {
  const inspected = await inspectPath(reference.path, maxBytes);
  if ("code" in inspected) return inspected;
  try {
    const file = await open(inspected.path, "r");
    try {
      const stats = await file.stat();
      if (!stats.isFile() || stats.size !== inspected.size || stats.size > maxBytes) {
        return importFailure("inaccessible", rejectionMessage("inaccessible"));
      }
      const bytes = await file.readFile();
      return {
        id: reference.id,
        name: inspected.name,
        mimeType: inspected.mimeType,
        size: inspected.size,
        bytes: new Uint8Array(bytes),
      };
    } finally {
      await file.close();
    }
  } catch {
    return importFailure("inaccessible", rejectionMessage("inaccessible"));
  }
}

export function extractOpenWithPaths(
  argv: string[],
  workingDirectory: string,
  defaultApp: boolean,
) {
  const argumentsOnly = argv.slice(defaultApp ? 2 : 1);
  return argumentsOnly
    .filter((argument) => argument.length > 0 && !argument.startsWith("-"))
    .map((argument) =>
      path.isAbsolute(argument)
        ? path.normalize(argument)
        : path.resolve(workingDirectory, argument),
    );
}

export function createDesktopImportService({
  createId,
  maxBytes = DESKTOP_IMPORT_MAX_BYTES,
}: {
  createId: () => string;
  maxBytes?: number;
}) {
  const batches = new Map<string, PendingBatch>();
  const queuedPaths = new Set<string>();

  async function inspectMany(paths: string[]) {
    const files: ImportReference[] = [];
    const rejected: DesktopImportRejection[] = [];
    const batchPaths = new Set<string>();

    for (const inputPath of paths) {
      const inspected = await inspectPath(inputPath, maxBytes);
      if ("code" in inspected) {
        rejected.push({
          id: createId(),
          name: path.basename(inputPath) || "Unnamed file",
          code: inspected.code,
          message: inspected.message,
        });
        continue;
      }
      if (batchPaths.has(inspected.path) || queuedPaths.has(inspected.path)) {
        continue;
      }
      batchPaths.add(inspected.path);
      files.push({ id: createId(), ...inspected });
    }
    return { files, rejected };
  }

  async function deliverReferences(
    files: ImportReference[],
    rejected: DesktopImportRejection[],
  ): Promise<DesktopImportDelivery> {
    const delivered: DesktopImportFile[] = [];
    const nextRejected = [...rejected];
    for (const reference of files) {
      const result = await readReference(reference, maxBytes);
      if ("code" in result) {
        nextRejected.push({
          id: reference.id,
          name: reference.name,
          code: result.code,
          message: result.message,
        });
      } else {
        delivered.push(result);
      }
    }
    return { files: delivered, rejected: nextRejected };
  }

  return {
    async enqueuePaths(
      paths: string[],
      source: DesktopImportSource,
    ): Promise<DesktopImportBatch | null> {
      if (paths.length === 0) return null;
      const inspected = await inspectMany(paths);
      if (inspected.files.length === 0 && inspected.rejected.length === 0) return null;
      const batch: PendingBatch = {
        id: createId(),
        source,
        profileId: null,
        ...inspected,
      };
      batch.files.forEach((file) => queuedPaths.add(file.path));
      batches.set(batch.id, batch);
      return publicBatch(batch);
    },

    listPending(profileId: string | null): DesktopImportBatch[] {
      return [...batches.values()]
        .filter((batch) => batch.profileId === null || batch.profileId === profileId)
        .map(publicBatch);
    },

    assign(batchId: string, profileId: string) {
      const batch = batches.get(batchId);
      if (!batch) {
        throw new Error("That desktop import is no longer pending.");
      }
      if (batch.profileId && batch.profileId !== profileId) {
        throw new Error("That desktop import was already assigned to another archive.");
      }
      batch.profileId = profileId;
      return publicBatch(batch);
    },

    async consume(profileId: string): Promise<DesktopImportDelivery> {
      const selected = [...batches.values()].filter(
        (batch) => batch.profileId === profileId,
      );
      for (const batch of selected) {
        batches.delete(batch.id);
        batch.files.forEach((file) => queuedPaths.delete(file.path));
      }
      return deliverReferences(
        selected.flatMap((batch) => batch.files),
        selected.flatMap((batch) => batch.rejected),
      );
    },

    async readPaths(paths: string[]): Promise<DesktopImportDelivery> {
      const inspected = await inspectMany(paths);
      return deliverReferences(inspected.files, inspected.rejected);
    },
  };
}
