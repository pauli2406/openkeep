import {
  CreateCorrespondentSchema,
  CreateDocumentTypeSchema,
  CreateTagSchema,
  DeleteTaxonomyResponseSchema,
  CorrespondentSchema,
  DocumentTypeSchema,
  MergeTaxonomySchema,
  TagSchema,
  UpdateCorrespondentSchema,
  UpdateDocumentTypeSchema,
  UpdateTagSchema,
} from "@openkeep/types";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";

export class CreateTagDto extends createZodDto(CreateTagSchema) {}
export class UpdateTagDto extends createZodDto(UpdateTagSchema) {}
export class CreateCorrespondentDto extends createZodDto(CreateCorrespondentSchema) {}
export class UpdateCorrespondentDto extends createZodDto(UpdateCorrespondentSchema) {}
export class CreateDocumentTypeDto extends createZodDto(CreateDocumentTypeSchema) {}
export class UpdateDocumentTypeDto extends createZodDto(UpdateDocumentTypeSchema) {}
export class MergeTaxonomyDto extends createZodDto(MergeTaxonomySchema) {}
export class TagDto extends createZodDto(TagSchema) {}
export class TagListDto extends createZodDto(z.array(TagSchema)) {}
export class CorrespondentDto extends createZodDto(CorrespondentSchema) {}
export class CorrespondentListDto extends createZodDto(z.array(CorrespondentSchema)) {}
export class DocumentTypeDto extends createZodDto(DocumentTypeSchema) {}
export class DocumentTypeListDto extends createZodDto(z.array(DocumentTypeSchema)) {}
export class DeleteTaxonomyResponseDto extends createZodDto(DeleteTaxonomyResponseSchema) {}
