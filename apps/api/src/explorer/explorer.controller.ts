import { Controller, Get, Inject, Param, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import type { SearchDocumentsRequest } from "@openkeep/types";

import { AccessAuthGuard } from "../auth/access-auth.guard";
import { SearchDocumentsQueryDto } from "../documents/dto/document.dto";
import { ExplorerService } from "./explorer.service";

type DocumentFilters = SearchDocumentsRequest["filters"];
const DOCUMENT_STATUSES = ["pending", "processing", "ready", "failed"] as const;
type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

function normalizeQueryArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item).trim())
      .filter(Boolean);
  }

  if (typeof value === "string" && value.trim().length > 0) {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return undefined;
}

function normalizeStatusArray(value: unknown): DocumentStatus[] | undefined {
  const items = normalizeQueryArray(value);
  if (!items) {
    return undefined;
  }

  return items.filter((item): item is DocumentStatus =>
    DOCUMENT_STATUSES.includes(item as DocumentStatus),
  );
}

function toFilters(query: SearchDocumentsQueryDto): DocumentFilters {
  return {
    year: query.year,
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
    correspondentId: query.correspondentId,
    correspondentIds: normalizeQueryArray(query.correspondentIds),
    documentTypeId: query.documentTypeId,
    documentTypeIds: normalizeQueryArray(query.documentTypeIds),
    status: query.status,
    statuses: normalizeStatusArray(query.statuses),
    tags: normalizeQueryArray(query.tags),
    amountMin: query.amountMin,
    amountMax: query.amountMax,
  };
}

@ApiTags("explorer")
@ApiBearerAuth()
@UseGuards(AccessAuthGuard)
@Controller()
export class ExplorerController {
  constructor(@Inject(ExplorerService) private readonly explorerService: ExplorerService) {}

  @Get("dashboard/insights")
  @ApiOkResponse({ description: "Dashboard explorer insights" })
  async getDashboardInsights() {
    return this.explorerService.getDashboardInsights();
  }

  @Get("correspondents/:slug/insights")
  @ApiOkResponse({ description: "Single correspondent insights" })
  async getCorrespondentInsights(@Param("slug") slug: string) {
    return this.explorerService.getCorrespondentInsightsBySlug(slug);
  }

  @Get("documents/projection")
  @ApiOkResponse({ description: "Semantic projection for filtered documents" })
  async getDocumentsProjection(@Query() query: SearchDocumentsQueryDto) {
    return this.explorerService.getDocumentsProjection(toFilters(query));
  }

  @Get("documents/timeline")
  @ApiOkResponse({ description: "Timeline buckets for filtered documents" })
  async getDocumentsTimeline(@Query() query: SearchDocumentsQueryDto) {
    return this.explorerService.getDocumentsTimeline(toFilters(query));
  }
}
