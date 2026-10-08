import { Module } from "@nestjs/common";

import { PrismaModule } from "../../../../infrastructure/prisma/prisma.module.js";
import { AuditModule } from "../../../../platform/audit/audit.module.js";
import { LegacyMigrationModule } from "../../legacy-migration.module.js";

/** Standalone CLI context: database + audit + migration tooling. No HTTP, no outbox publisher. */
@Module({ imports: [PrismaModule, AuditModule, LegacyMigrationModule] })
export class LegacyMigrationCliModule {}
