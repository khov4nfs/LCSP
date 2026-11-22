import { Global, Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { CqrsModule } from "@nestjs/cqrs";

import type { AppConfig } from "../../config/config.types.js";
import { OutboxDlqController } from "./outbox-dlq.controller.js";
import { OutboxDlqService } from "./outbox-dlq.service.js";
import { OutboxPublisherService } from "./outbox-publisher.service.js";
import { OutboxRepository } from "./outbox.repository.js";
import { RabbitMqClient } from "./rabbitmq.client.js";

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
    {
      provide: RabbitMqClient,
      inject: [ConfigService],
      /**
       * Creates the RabbitMQ client from the central ConfigService.
       *
       * Rationale: Injects both the broker URL and target topic exchange from validated AppConfig,
       * removing unmanaged process.env reads inside RabbitMqClient.
       * Mechanism: Resolves rabbitmq.url and rabbitmq.exchange with fallback to canonical defaults.
       * Invariants: Guarantees publisher assertions use the configured environment exchange.
       *
       * @param configService - Runtime configuration source for RabbitMQ broker parameters.
       * @returns Configured RabbitMQ client instance.
       */
      useFactory: (configService: ConfigService<AppConfig>) => {
        const rabbitmq = configService.get<AppConfig["rabbitmq"]>("rabbitmq");
        return new RabbitMqClient(
          rabbitmq?.url ?? "",
          rabbitmq?.exchange ?? "lcsp.events",
        );
      },
    },
    OutboxPublisherService,
  ],
  exports: [OutboxRepository, RabbitMqClient],
})
export class OutboxModule {}
