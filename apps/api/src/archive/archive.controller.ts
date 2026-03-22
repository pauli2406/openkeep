import { Body, Controller, Get, Inject, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";

import { AccessAuthGuard } from "../auth/access-auth.guard";
import { CurrentPrincipal } from "../auth/current-principal.decorator";
import type { AuthenticatedPrincipal } from "../auth/auth.types";
import { ArchiveService } from "./archive.service";

@ApiTags("archive")
@ApiBearerAuth()
@UseGuards(AccessAuthGuard)
@Controller("archive")
export class ArchiveController {
  constructor(@Inject(ArchiveService) private readonly archiveService: ArchiveService) {}

  @Get("export")
  @ApiOkResponse({ description: "Archive snapshot" })
  async exportArchive() {
    return this.archiveService.exportSnapshot();
  }

  @Post("import")
  @ApiCreatedResponse({ description: "Import result summary" })
  async importArchive(
    @Body() body: { snapshot: unknown; mode?: "replace" | "merge" },
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ) {
    return this.archiveService.importSnapshot(body.snapshot, principal, body.mode ?? "replace");
  }

  @Post("watch-folder/scan")
  @ApiCreatedResponse({ description: "Watch folder scan result" })
  async scanWatchFolder(
    @Body() body: { dryRun?: boolean } = {},
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ) {
    return this.archiveService.scanWatchFolder(principal, {
      dryRun: body.dryRun ?? false,
    });
  }
}
