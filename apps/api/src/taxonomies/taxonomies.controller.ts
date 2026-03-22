import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, UseGuards } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from "@nestjs/swagger";

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
  @ApiOkResponse({ description: "List of tags" })
  async listTags() {
    return this.taxonomiesService.listTags();
  }

  @Post("tags")
  @ApiCreatedResponse({ description: "Created tag" })
  async createTag(
    @Body() body: CreateTagDto,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ) {
    return this.taxonomiesService.createTag(body, principal);
  }

  @Patch("tags/:id")
  @ApiOkResponse({ description: "Updated tag" })
  async updateTag(
    @Param("id") id: string,
    @Body() body: UpdateTagDto,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ) {
    return this.taxonomiesService.updateTag(id, body, principal);
  }

  @Delete("tags/:id")
  @ApiOkResponse({ description: "Deleted tag" })
  async deleteTag(
    @Param("id") id: string,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ) {
    return this.taxonomiesService.deleteTag(id, principal);
  }

  @Post("tags/:id/merge")
  @ApiCreatedResponse({ description: "Merged tag" })
  async mergeTag(
    @Param("id") id: string,
    @Body() body: MergeTaxonomyDto,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ) {
    return this.taxonomiesService.mergeTag(id, body, principal);
  }

  @Get("correspondents")
  @ApiOkResponse({ description: "List of correspondents" })
  async listCorrespondents() {
    return this.taxonomiesService.listCorrespondents();
  }

  @Post("correspondents")
  @ApiCreatedResponse({ description: "Created correspondent" })
  async createCorrespondent(
    @Body() body: CreateCorrespondentDto,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ) {
    return this.taxonomiesService.createCorrespondent(body, principal);
  }

  @Patch("correspondents/:id")
  @ApiOkResponse({ description: "Updated correspondent" })
  async updateCorrespondent(
    @Param("id") id: string,
    @Body() body: UpdateCorrespondentDto,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ) {
    return this.taxonomiesService.updateCorrespondent(id, body, principal);
  }

  @Delete("correspondents/:id")
  @ApiOkResponse({ description: "Deleted correspondent" })
  async deleteCorrespondent(
    @Param("id") id: string,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ) {
    return this.taxonomiesService.deleteCorrespondent(id, principal);
  }

  @Post("correspondents/:id/merge")
  @ApiCreatedResponse({ description: "Merged correspondent" })
  async mergeCorrespondent(
    @Param("id") id: string,
    @Body() body: MergeTaxonomyDto,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ) {
    return this.taxonomiesService.mergeCorrespondent(id, body, principal);
  }

  @Get("document-types")
  @ApiOkResponse({ description: "List of document types" })
  async listDocumentTypes() {
    return this.taxonomiesService.listDocumentTypes();
  }

  @Post("document-types")
  @ApiCreatedResponse({ description: "Created document type" })
  async createDocumentType(
    @Body() body: CreateDocumentTypeDto,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ) {
    return this.taxonomiesService.createDocumentType(body, principal);
  }

  @Patch("document-types/:id")
  @ApiOkResponse({ description: "Updated document type" })
  async updateDocumentType(
    @Param("id") id: string,
    @Body() body: UpdateDocumentTypeDto,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ) {
    return this.taxonomiesService.updateDocumentType(id, body, principal);
  }

  @Delete("document-types/:id")
  @ApiOkResponse({ description: "Deleted document type" })
  async deleteDocumentType(
    @Param("id") id: string,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ) {
    return this.taxonomiesService.deleteDocumentType(id, principal);
  }

  @Post("document-types/:id/merge")
  @ApiCreatedResponse({ description: "Merged document type" })
  async mergeDocumentType(
    @Param("id") id: string,
    @Body() body: MergeTaxonomyDto,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ) {
    return this.taxonomiesService.mergeDocumentType(id, body, principal);
  }
}
