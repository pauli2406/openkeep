import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";

import { CurrentPrincipal } from "./current-principal.decorator";
import {
  CreateApiTokenDto,
  DisableTwoFactorDto,
  EnableTwoFactorDto,
  LoginDto,
  RefreshDto,
  SetupOwnerDto,
  TwoFactorLoginDto,
  UpdateUserLanguagePreferencesDto,
} from "./dto/auth.dto";
import { AccessAuthGuard } from "./access-auth.guard";
import { AuthService } from "./auth.service";
import type { AuthenticatedPrincipal } from "./auth.types";

// Strict per-IP limits for credential-handling endpoints: 10 requests per
// minute. This blunts brute-force attempts and bcrypt-based CPU exhaustion.
const AUTH_THROTTLE = { default: { ttl: 60_000, limit: 10 } };

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Post("setup")
  @Throttle(AUTH_THROTTLE)
  @ApiOperation({ summary: "Create the initial owner account" })
  @ApiCreatedResponse({ description: "Owner account created" })
  async setup(@Body() body: SetupOwnerDto) {
    return this.authService.setupOwner(body);
  }

  @Post("login")
  @Throttle(AUTH_THROTTLE)
  @ApiOperation({ summary: "Login with the owner account" })
  @ApiCreatedResponse({ description: "Login response with tokens or a 2FA challenge" })
  async login(@Body() body: LoginDto) {
    return this.authService.login(body);
  }

  @Post("login/2fa")
  @Throttle(AUTH_THROTTLE)
  @ApiOperation({ summary: "Complete a two-factor login challenge" })
  @ApiCreatedResponse({ description: "Login response with tokens" })
  async loginTwoFactor(@Body() body: TwoFactorLoginDto) {
    return this.authService.completeTwoFactorLogin(body);
  }

  @Post("refresh")
  @Throttle(AUTH_THROTTLE)
  @ApiOperation({ summary: "Refresh an expired access token" })
  @ApiCreatedResponse({ description: "Refreshed tokens" })
  async refresh(@Body() body: RefreshDto) {
    return this.authService.refresh(body.refreshToken);
  }

  @Post("logout")
  @HttpCode(200)
  @ApiOperation({ summary: "Revoke a refresh session" })
  @ApiOkResponse({ description: "Session revoked" })
  async logout(@Body() body: RefreshDto) {
    await this.authService.logout(body.refreshToken);
    return { success: true };
  }

  @Get("me")
  @UseGuards(AccessAuthGuard)
  @ApiBearerAuth()
  @ApiOkResponse({ description: "Current authenticated principal" })
  async me(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.authService.getMe(principal);
  }

  @Patch("me/preferences")
  @UseGuards(AccessAuthGuard)
  @ApiBearerAuth()
  @ApiOkResponse({ description: "Updated current user preferences" })
  async updatePreferences(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() body: UpdateUserLanguagePreferencesDto,
  ) {
    return this.authService.updatePreferences(principal, body);
  }

  // --- Two-factor authentication ---

  @Post("2fa/setup")
  @Throttle(AUTH_THROTTLE)
  @UseGuards(AccessAuthGuard)
  @ApiBearerAuth()
  @ApiCreatedResponse({ description: "Pending TOTP secret, otpauth URL and QR code" })
  async setupTwoFactor(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.authService.setupTwoFactor(principal);
  }

  @Post("2fa/enable")
  @Throttle(AUTH_THROTTLE)
  @UseGuards(AccessAuthGuard)
  @ApiBearerAuth()
  @ApiCreatedResponse({ description: "Two-factor enabled; returns recovery codes" })
  async enableTwoFactor(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() body: EnableTwoFactorDto,
  ) {
    return this.authService.enableTwoFactor(principal, body);
  }

  @Post("2fa/disable")
  @Throttle(AUTH_THROTTLE)
  @HttpCode(200)
  @UseGuards(AccessAuthGuard)
  @ApiBearerAuth()
  @ApiOkResponse({ description: "Two-factor disabled" })
  async disableTwoFactor(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() body: DisableTwoFactorDto,
  ) {
    await this.authService.disableTwoFactor(principal, body);
    return { success: true };
  }

  @Get("tokens")
  @UseGuards(AccessAuthGuard)
  @ApiBearerAuth()
  @ApiOkResponse({ description: "List of API tokens" })
  async listTokens(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.authService.listApiTokens(principal);
  }

  @Post("tokens")
  @UseGuards(AccessAuthGuard)
  @ApiBearerAuth()
  @ApiCreatedResponse({ description: "Newly created API token" })
  async createToken(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() body: CreateApiTokenDto,
  ) {
    return this.authService.createApiToken(principal, body);
  }

  @Delete("tokens/:id")
  @UseGuards(AccessAuthGuard)
  @ApiBearerAuth()
  @ApiOkResponse({ description: "Token deleted" })
  async revokeToken(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param("id") id: string,
  ) {
    await this.authService.revokeApiToken(principal, id);
    return { success: true };
  }
}
