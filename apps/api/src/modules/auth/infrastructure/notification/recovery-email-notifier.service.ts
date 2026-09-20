import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { AppConfig } from "../../../../config/config.types.js";
import { MailService } from "../../../../platform/mail/mail.service.js";
import type { RecoveryNotifier } from "../../application/ports/notification/recovery-notifier.ts";
import {
  renderRecoveryEmailHtml,
  renderRecoveryEmailText,
} from "./recovery-email.template.ts";

@Injectable()
export class RecoveryEmailNotifierService implements RecoveryNotifier {
  private readonly logger = new Logger(RecoveryEmailNotifierService.name);

  constructor(
    private readonly configService: ConfigService<AppConfig>,
    private readonly mailService: MailService,
  ) {}

  async notify(input: {
    userId: string;
    email: string;
    token: string;
    correlationId: string;
    appOrigin?: string;
  }): Promise<void> {
    if (!this.mailService.isConfigured()) {
      this.logger.warn(
        `Recovery email skipped: SMTP is not configured (correlationId=${input.correlationId})`,
      );
      return;
    }

    const baseUrl = this.resolveBaseUrl(input.appOrigin);
    const recoveryLink = `${baseUrl}/recovery/confirm?token=${encodeURIComponent(input.token)}`;

    try {
      const result = await this.mailService.send({
        to: input.email,
        subject: "LCSP password recovery",
        text: renderRecoveryEmailText({
          recoveryLink,
          recoveryToken: input.token,
        }),
        html: renderRecoveryEmailHtml({
          recoveryLink,
          recoveryToken: input.token,
        }),
      });

      this.logger.log(
        `Recovery email sent to ${maskEmail(input.email)} (correlationId=${input.correlationId}, messageId=${result.messageId})`,
      );
    } catch (error) {
      this.logger.error(
        `Recovery email delivery failed for ${maskEmail(input.email)} (correlationId=${input.correlationId}): ${(error as Error).message}`,
      );
    }
  }

  private resolveBaseUrl(appOrigin?: string): string {
    const oauthConfig = this.configService.get<AppConfig["oauth"]>("oauth");
    const origin = appOrigin?.trim();
    if (origin) {
      return origin.replace(/\/$/, "");
    }
    const webBaseUrl =
      oauthConfig?.allowedRedirectOrigins[0]?.trim() || "http://localhost:3000";
    return webBaseUrl.replace(/\/$/, "");
  }
}

function maskEmail(email: string): string {
  const [localPart = "", domain = ""] = email.split("@");
  const visibleLocal = localPart.slice(0, 2);
  return `${visibleLocal}${"*".repeat(Math.max(0, localPart.length - visibleLocal.length))}@${domain}`;
}
