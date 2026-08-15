import { Global, Module } from "@nestjs/common";

import { AuditWriterService } from "./audit-writer.service.js";

/**
 * Registers the global audit-writing service so application modules can persist audit events.
 */
@Global()
@Module({
  providers: [AuditWriterService],
  exports: [AuditWriterService],
})
export class AuditModule {}
