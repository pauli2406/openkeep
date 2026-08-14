import { Inject, Injectable, Logger } from "@nestjs/common";
import { createTransport, type Transporter } from "nodemailer";

import { AppConfigService } from "../common/config/app-config.service";

export interface OutboundMail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * The one place SMTP is spoken. `configured` is the channel switch: without
 * a host and a from-address the email channel is off, callers skip sending,
 * and health reports the channel as unconfigured instead of erroring.
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private readonly transporter: Transporter | null;
  private readonly from: string | undefined;

  constructor(@Inject(AppConfigService) private readonly configService: AppConfigService) {
    const host = this.configService.get("SMTP_HOST");
    this.from = this.configService.get("SMTP_FROM");
    const user = this.configService.get("SMTP_USER");
    const password = this.configService.get("SMTP_PASSWORD");

    this.transporter =
      host && this.from
        ? createTransport({
            host,
            port: this.configService.get("SMTP_PORT"),
            secure: this.configService.get("SMTP_SECURE"),
            auth: user && password ? { user, pass: password } : undefined,
          })
        : null;
  }

  get configured(): boolean {
    return this.transporter !== null;
  }

  async send(mail: OutboundMail): Promise<void> {
    if (!this.transporter || !this.from) {
      throw new Error("SMTP is not configured");
    }

    await this.transporter.sendMail({
      from: this.from,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    this.logger.log(`Sent mail "${mail.subject}"`);
  }
}
