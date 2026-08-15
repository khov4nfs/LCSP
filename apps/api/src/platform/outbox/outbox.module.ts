import { Global, Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { CqrsModule } from "@nestjs/cqrs";

import { OutboxPublisherService } from "./outbox-publisher.service.js";
import { OutboxRepository } from "./outbox.repository.js";
import { RabbitMqClient } from "./rabbitmq.client.js";
import { OutboxDlqController } from "./outbox-dlq.controller.js";
import { OutboxDlqService } from "./outbox-dlq.service.js";
import { SnapshotCreatedAutoScanService } from "./snapshot-created-auto-scan.service.js";

/**
 * Registers transactional-outbox persistence, publishing, DLQ recovery, and RabbitMQ infrastructure globally.
 */
@Global()
@Module({
  imports: [ConfigModule, CqrsModule],
  controllers: [OutboxDlqController],
  providers: [
    OutboxRepository,
    OutboxDlqService,
    SnapshotCreatedAutoScanService,
    {
      provide: RabbitMqClient,
      inject: [ConfigService],
      /**
       * Creates the RabbitMQ client from the configured broker URL.
       *
       * @param configService - Runtime configuration source for the RabbitMQ URL.
       * @returns Configured RabbitMQ client instance.
       */
      useFactory: (configService: ConfigService) =>
        new RabbitMqClient(configService.get<string>("rabbitmq.url", "")),
    },
    OutboxPublisherService,
  ],
  exports: [OutboxRepository, RabbitMqClient],
})
export class OutboxModule {}
