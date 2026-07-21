import {
  ApiTokenSchema,
  AuthTokensSchema,
  CreateApiTokenSchema,
  CreateApiTokenResponseSchema,
  CurrentUserSchema,
  DisableTwoFactorSchema,
  EnableTwoFactorResponseSchema,
  EnableTwoFactorSchema,
  LoginSchema,
  RefreshSchema,
  SetupOwnerSchema,
  SuccessResponseSchema,
  TwoFactorLoginSchema,
  TwoFactorSetupResponseSchema,
  UpdateUserLanguagePreferencesSchema,
} from "@openkeep/types";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";

export class SetupOwnerDto extends createZodDto(SetupOwnerSchema) {}
export class LoginDto extends createZodDto(LoginSchema) {}
export class RefreshDto extends createZodDto(RefreshSchema) {}
export class TwoFactorLoginDto extends createZodDto(TwoFactorLoginSchema) {}
export class TwoFactorSetupResponseDto extends createZodDto(TwoFactorSetupResponseSchema) {}
export class EnableTwoFactorDto extends createZodDto(EnableTwoFactorSchema) {}
export class EnableTwoFactorResponseDto extends createZodDto(EnableTwoFactorResponseSchema) {}
export class DisableTwoFactorDto extends createZodDto(DisableTwoFactorSchema) {}
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
