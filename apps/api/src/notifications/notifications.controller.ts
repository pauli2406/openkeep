import { Controller, Get, Inject, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiTags } from "@nestjs/swagger";

import { AccessAuthGuard } from "../auth/access-auth.guard";
import { CurrentPrincipal } from "../auth/current-principal.decorator";
import type { AuthenticatedPrincipal } from "../auth/auth.types";
import { NotificationsService } from "./notifications.service";

@ApiTags("notifications")
@ApiBearerAuth()
@UseGuards(AccessAuthGuard)
@Controller("notifications")
export class NotificationsController {
  constructor(
    @Inject(NotificationsService) private readonly notificationsService: NotificationsService,
  ) {}

  @Get()
  @ApiOkResponse({ description: "Pending deadline notifications for the current user" })
  async listNotifications(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Query("undeliveredFor") undeliveredFor?: string,
  ) {
    return this.notificationsService.listNotifications(principal.userId, {
      undeliveredFor:
        undeliveredFor === "email" || undeliveredFor === "desktop" ? undeliveredFor : undefined,
    });
  }

  @Post(":id/read")
  @ApiOkResponse({ description: "Marks one notification as read" })
  async markRead(
    @Param("id") id: string,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ) {
    await this.notificationsService.markRead(id, principal.userId);
    return { success: true };
  }
}
