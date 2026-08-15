import { Global, Module } from "@nestjs/common";

import { MailService } from "./mail.service.js";

/**
 * Registers the global mail service used by application modules to send SMTP email.
 */
@Global()
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
