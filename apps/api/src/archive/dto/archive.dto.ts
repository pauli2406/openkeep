import { WatchFolderScanRequestSchema } from "@openkeep/types";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";

export const ArchiveImportRequestSchema = z.object({
  mode: z.enum(["replace", "merge"]).default("replace"),
  snapshot: z.record(z.string(), z.unknown()),
});

export class ArchiveImportDto extends createZodDto(ArchiveImportRequestSchema) {}
export class WatchFolderScanDto extends createZodDto(WatchFolderScanRequestSchema) {}
