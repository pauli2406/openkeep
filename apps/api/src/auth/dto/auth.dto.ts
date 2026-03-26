import {
  ApiTokenSchema,
  AuthTokensSchema,
  CreateApiTokenSchema,
  CreateApiTokenResponseSchema,
  CurrentUserSchema,
  LoginSchema,
  RefreshSchema,
  SetupOwnerSchema,
  SuccessResponseSchema,
  UpdateUserLanguagePreferencesSchema,
} from "@openkeep/types";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";

export class SetupOwnerDto extends createZodDto(SetupOwnerSchema) {}
export class LoginDto extends createZodDto(LoginSchema) {}
export class RefreshDto extends createZodDto(RefreshSchema) {}
export class CreateApiTokenDto extends createZodDto(CreateApiTokenSchema) {}
export class AuthTokensDto extends createZodDto(AuthTokensSchema) {}
export class CurrentUserDto extends createZodDto(CurrentUserSchema) {}
export class UpdateUserLanguagePreferencesDto extends createZodDto(
  UpdateUserLanguagePreferencesSchema,
) {}
export class ApiTokenDto extends createZodDto(ApiTokenSchema) {}
export class ApiTokenListDto extends createZodDto(z.array(ApiTokenSchema)) {}
export class CreateApiTokenResponseDto extends createZodDto(CreateApiTokenResponseSchema) {}
export class SuccessResponseDto extends createZodDto(SuccessResponseSchema) {}
