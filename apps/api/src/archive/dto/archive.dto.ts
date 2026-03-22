import {
  ArchiveImportRequestSchema,
  ArchiveImportResultSchema,
  ArchiveSnapshotSchema,
  WatchFolderScanRequestSchema,
  WatchFolderScanResponseSchema,
} from "@openkeep/types";
import { createZodDto } from "nestjs-zod";

export class ArchiveImportDto extends createZodDto(ArchiveImportRequestSchema) {}
export class WatchFolderScanDto extends createZodDto(WatchFolderScanRequestSchema) {}
export class ArchiveSnapshotDto extends createZodDto(ArchiveSnapshotSchema) {}
export class ArchiveImportResultDto extends createZodDto(ArchiveImportResultSchema) {}
export class WatchFolderScanResponseDto extends createZodDto(WatchFolderScanResponseSchema) {}
