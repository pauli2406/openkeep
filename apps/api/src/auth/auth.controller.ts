import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";

import { CurrentPrincipal } from "./current-principal.decorator";
import {
  CreateApiTokenDto,
  LoginDto,
  RefreshDto,
  SetupOwnerDto,
} from "./dto/auth.dto";
import { AccessAuthGuard } from "./access-auth.guard";
import { AuthService } from "./auth.service";
import type { AuthenticatedPrincipal } from "./auth.types";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Post("setup")
  @ApiOperation({ summary: "Create the initial owner account" })
  async setup(@Body() body: SetupOwnerDto) {
    return this.authService.setupOwner(body);
  }

  @Post("login")
  @ApiOperation({ summary: "Login with the owner account" })
  async login(@Body() body: LoginDto) {
    return this.authService.login(body);
  }

  @Post("refresh")
  @ApiOperation({ summary: "Refresh an expired access token" })
  async refresh(@Body() body: RefreshDto) {
    return this.authService.refresh(body.refreshToken);
  }

  @Get("me")
  @UseGuards(AccessAuthGuard)
  @ApiBearerAuth()
  @ApiOkResponse({ description: "Current authenticated principal" })
  async me(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.authService.getMe(principal);
  }

  @Get("tokens")
  @UseGuards(AccessAuthGuard)
  @ApiBearerAuth()
  async listTokens(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.authService.listApiTokens(principal);
  }

  @Post("tokens")
  @UseGuards(AccessAuthGuard)
  @ApiBearerAuth()
  async createToken(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() body: CreateApiTokenDto,
  ) {
    return this.authService.createApiToken(principal, body);
  }

  @Delete("tokens/:id")
  @UseGuards(AccessAuthGuard)
  @ApiBearerAuth()
  async revokeToken(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param("id") id: string,
  ) {
    await this.authService.revokeApiToken(principal, id);
    return { success: true };
  }
}
