import {
  AuthTokensSchema,
  CreateApiTokenSchema,
  LoginSchema,
  RefreshSchema,
  SetupOwnerSchema,
} from "@openkeep/types";
import { createZodDto } from "nestjs-zod";

export class SetupOwnerDto extends createZodDto(SetupOwnerSchema) {}
export class LoginDto extends createZodDto(LoginSchema) {}
export class RefreshDto extends createZodDto(RefreshSchema) {}
export class CreateApiTokenDto extends createZodDto(CreateApiTokenSchema) {}
export class AuthTokensDto extends createZodDto(AuthTokensSchema) {}

