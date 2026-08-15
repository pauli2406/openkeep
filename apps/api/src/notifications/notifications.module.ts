import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { ProcessingModule } from "../processing/processing.module";
import { EmailDigestService } from "./email-digest.service";
import { MailerService } from "./mailer.service";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";

@Module({
  imports: [AuthModule, ProcessingModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, MailerService, EmailDigestService],
  exports: [NotificationsService, MailerService, EmailDigestService],
})
export class NotificationsModule {}
