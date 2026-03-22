import {
  HealthProvidersResponseSchema,
  HealthResponseSchema,
  ProcessingStatusResponseSchema,
  ReadinessResponseSchema,
} from "@openkeep/types";
import { createZodDto } from "nestjs-zod";

export class HealthResponseDto extends createZodDto(HealthResponseSchema) {}
export class ReadinessResponseDto extends createZodDto(ReadinessResponseSchema) {}
export class HealthProvidersResponseDto extends createZodDto(HealthProvidersResponseSchema) {}
export class ProcessingStatusResponseDto extends createZodDto(ProcessingStatusResponseSchema) {}
