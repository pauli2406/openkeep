import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";

import { AccessAuthGuard } from "../auth/access-auth.guard";
import { CurrentPrincipal } from "../auth/current-principal.decorator";
import type { AuthenticatedPrincipal } from "../auth/auth.types";
import {
  CreateCorrespondentDto,
  CreateDocumentTypeDto,
  CreateTagDto,
  MergeTaxonomyDto,
  UpdateCorrespondentDto,
  UpdateDocumentTypeDto,
  UpdateTagDto,
} from "./dto/taxonomy.dto";
import { TaxonomiesService } from "./taxonomies.service";

@ApiTags("taxonomies")
@ApiBearerAuth()
@UseGuards(AccessAuthGuard)
@Controller("taxonomies")
export class TaxonomiesController {
  constructor(@Inject(TaxonomiesService) private readonly taxonomiesService: TaxonomiesService) {}

  @Get("tags")
  async listTags() {
    return this.taxonomiesService.listTags();
  }

  @Post("tags")
  async createTag(
    @Body() body: CreateTagDto,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ) {
    return this.taxonomiesService.createTag(body, principal);
  }

  @Patch("tags/:id")
  async updateTag(
    @Param("id") id: string,
    @Body() body: UpdateTagDto,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ) {
    return this.taxonomiesService.updateTag(id, body, principal);
  }

  @Delete("tags/:id")
  async deleteTag(
    @Param("id") id: string,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ) {
    return this.taxonomiesService.deleteTag(id, principal);
  }

  @Post("tags/:id/merge")
  async mergeTag(
    @Param("id") id: string,
    @Body() body: MergeTaxonomyDto,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ) {
    return this.taxonomiesService.mergeTag(id, body, principal);
  }

  @Get("correspondents")
  async listCorrespondents() {
    return this.taxonomiesService.listCorrespondents();
  }

  @Post("correspondents")
  async createCorrespondent(
    @Body() body: CreateCorrespondentDto,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ) {
    return this.taxonomiesService.createCorrespondent(body, principal);
  }

  @Patch("correspondents/:id")
  async updateCorrespondent(
    @Param("id") id: string,
    @Body() body: UpdateCorrespondentDto,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ) {
    return this.taxonomiesService.updateCorrespondent(id, body, principal);
  }

  @Delete("correspondents/:id")
  async deleteCorrespondent(
    @Param("id") id: string,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ) {
    return this.taxonomiesService.deleteCorrespondent(id, principal);
  }

  @Post("correspondents/:id/merge")
  async mergeCorrespondent(
    @Param("id") id: string,
    @Body() body: MergeTaxonomyDto,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ) {
    return this.taxonomiesService.mergeCorrespondent(id, body, principal);
  }

  @Get("document-types")
  async listDocumentTypes() {
    return this.taxonomiesService.listDocumentTypes();
  }

  @Post("document-types")
  async createDocumentType(
    @Body() body: CreateDocumentTypeDto,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ) {
    return this.taxonomiesService.createDocumentType(body, principal);
  }

  @Patch("document-types/:id")
  async updateDocumentType(
    @Param("id") id: string,
    @Body() body: UpdateDocumentTypeDto,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ) {
    return this.taxonomiesService.updateDocumentType(id, body, principal);
  }

  @Delete("document-types/:id")
  async deleteDocumentType(
    @Param("id") id: string,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ) {
    return this.taxonomiesService.deleteDocumentType(id, principal);
  }

  @Post("document-types/:id/merge")
  async mergeDocumentType(
    @Param("id") id: string,
    @Body() body: MergeTaxonomyDto,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ) {
    return this.taxonomiesService.mergeDocumentType(id, body, principal);
  }
}
