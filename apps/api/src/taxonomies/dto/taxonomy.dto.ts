import {
  CreateCorrespondentSchema,
  CreateDocumentTypeSchema,
  CreateTagSchema,
  MergeTaxonomySchema,
  UpdateCorrespondentSchema,
  UpdateDocumentTypeSchema,
  UpdateTagSchema,
} from "@openkeep/types";
import { createZodDto } from "nestjs-zod";

export class CreateTagDto extends createZodDto(CreateTagSchema) {}
export class UpdateTagDto extends createZodDto(UpdateTagSchema) {}
export class CreateCorrespondentDto extends createZodDto(CreateCorrespondentSchema) {}
export class UpdateCorrespondentDto extends createZodDto(UpdateCorrespondentSchema) {}
export class CreateDocumentTypeDto extends createZodDto(CreateDocumentTypeSchema) {}
export class UpdateDocumentTypeDto extends createZodDto(UpdateDocumentTypeSchema) {}
export class MergeTaxonomyDto extends createZodDto(MergeTaxonomySchema) {}
