import { Body, Controller, Get, Inject, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";

import { AccessAuthGuard } from "../auth/access-auth.guard";
import { CurrentPrincipal } from "../auth/current-principal.decorator";
import type { AuthenticatedPrincipal } from "../auth/auth.types";
import { ArchiveImportDto, WatchFolderScanDto } from "./dto/archive.dto";
import { ArchiveService } from "./archive.service";

@ApiTags("archive")
@ApiBearerAuth()
@UseGuards(AccessAuthGuard)
@Controller("archive")
export class ArchiveController {
  constructor(@Inject(ArchiveService) private readonly archiveService: ArchiveService) {}

  @Get("export")
  async exportArchive() {
    return this.archiveService.exportSnapshot();
  }

  @Post("import")
  async importArchive(
    @Body() body: ArchiveImportDto,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ) {
    return this.archiveService.importSnapshot(body.snapshot, principal, body.mode);
  }

  @Post("watch-folder/scan")
  async scanWatchFolder(
    @Body() body: WatchFolderScanDto,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ) {
    return this.archiveService.scanWatchFolder(principal, body);
  }
}
