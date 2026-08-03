import { Body, Controller, Get, Inject, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";

import { AccessAuthGuard } from "../auth/access-auth.guard";
import { CurrentPrincipal } from "../auth/current-principal.decorator";
import type { AuthenticatedPrincipal } from "../auth/auth.types";
import { ArchiveService } from "./archive.service";
import { ArchiveImportDto, WatchFolderScanDto } from "./dto/archive.dto";
import { ValidatedBody } from "../common/validated-params";

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
    @ValidatedBody(ArchiveImportDto) body: ArchiveImportDto,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ) {
    return this.archiveService.importSnapshot(body.snapshot, principal, body.mode);
  }

  @Get("watch-folder")
  @ApiOkResponse({
    description:
      "Watch folder status and scan history. Read-only: unlike the scan " +
      "endpoint it does not walk the folder or record an audit event.",
  })
  async getWatchFolderStatus() {
    return this.archiveService.getWatchFolderStatus();
  }

  @Post("watch-folder/scan")
  @ApiCreatedResponse({ description: "Watch folder scan result" })
  async scanWatchFolder(
    @ValidatedBody(WatchFolderScanDto) body: WatchFolderScanDto,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ) {
    return this.archiveService.scanWatchFolder(principal, {
      dryRun: body.dryRun,
    });
  }
}
