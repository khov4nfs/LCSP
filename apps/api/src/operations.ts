// Reviewed operator scripts use the real compiled accounting/publisher boundaries.
export { PrismaService } from "./infrastructure/prisma/prisma.service.js";
export { BillingAccountingKernel } from "./modules/billing/application/shared/billing-accounting.kernel.js";
export { PrismaBillingTransaction } from "./modules/billing/infrastructure/persistence/prisma-billing-transaction.js";
export { OutboxRepository } from "./platform/outbox/outbox.repository.js";
export { RabbitMqClient } from "./platform/outbox/rabbitmq.client.js";
