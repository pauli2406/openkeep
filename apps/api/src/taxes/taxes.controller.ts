import { BadRequestException, Controller, Get, Inject, Param, Res, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import type { FastifyReply } from "fastify";

import { AccessAuthGuard } from "../auth/access-auth.guard";
import { CurrentPrincipal } from "../auth/current-principal.decorator";
import type { AuthenticatedPrincipal } from "../auth/auth.types";
import { TaxesService } from "./taxes.service";

const MIN_YEAR = 1970;
const MAX_YEAR = 2100;

@ApiTags("taxes")
@ApiBearerAuth()
@UseGuards(AccessAuthGuard)
@Controller("taxes")
export class TaxesController {
  constructor(@Inject(TaxesService) private readonly taxesService: TaxesService) {}

  @Get(":year")
  @ApiOkResponse({ description: "Documents of one tax year, grouped by type with sums" })
  async getTaxYear(
    @Param("year") yearParam: string,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ) {
    const year = Number(yearParam);
    if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) {
      throw new BadRequestException(`year must be an integer between ${MIN_YEAR} and ${MAX_YEAR}`);
    }

    return this.taxesService.getTaxYear(year, principal.userId);
  }

  @Get(":year/export")
  @ApiOkResponse({ description: "The tax year as a ZIP: documents plus index.csv" })
  async exportTaxYear(
    @Param("year") yearParam: string,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Res() reply: FastifyReply,
  ) {
    const year = Number(yearParam);
    if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) {
      throw new BadRequestException(`year must be an integer between ${MIN_YEAR} and ${MAX_YEAR}`);
    }

    const { archive } = await this.taxesService.exportTaxYear(year, principal.userId);
    reply.header("Content-Type", "application/zip");
    reply.header("Content-Disposition", `attachment; filename="tax-year-${year}.zip"`);
    return reply.send(archive);
  }
}
