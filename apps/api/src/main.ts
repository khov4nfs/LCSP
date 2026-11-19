import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module.js";
import type { AppConfig } from "./config/config.types.js";
import { FilePartitionedLogger } from "./platform/logging/file-partitioned-logger.js";
import {
  applyNetworkEdgeMiddleware,
  httpBodyParser,
} from "./platform/http/index.js";

/**
 * Bootstraps and starts the NestJS HTTP application.
 *
 * Rationale: Exporting bootstrap enables isolated lifecycle testing and programmatic
 * harness control without automatically binding ports during module import in test runners.
 * Mechanism:
 * 1. Creates the Nest application without default body parser (custom streaming body parser used).
 * 2. Enables Nest shutdown hooks (SIGTERM/SIGINT) to ensure graceful teardown of Prisma connection
 *    pools and RabbitMQ channels.
 * 3. Applies enterprise network edge defenses (Helmet, Gzip, CORS whitelist).
 * 4. Binds and listens on the configured application port.
 * Invariants: In production environments, any uncaught bootstrap failure logs via structured
 * Logger and terminates the process with exit code 1.
 *
 * @returns Promise that resolves once the application has started listening.
 */
export async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
    logger: new FilePartitionedLogger(),
  });

  // Enable graceful termination hooks for container lifecycles (Kubernetes / Docker / PM2)
  app.enableShutdownHooks();

  const configService = app.get(ConfigService<AppConfig, true>);
  const corsConfig = configService.get("cors", { infer: true });
  const port = configService.get("port", { infer: true }) ?? 3000;

  // Enterprise network edge layers: Helmet, Gzip compression, and strict CORS whitelist
  applyNetworkEdgeMiddleware(app, {
    allowedOrigins: corsConfig?.allowedOrigins ?? [],
  });

  app.use(httpBodyParser());
  await app.listen(port);
}

// Automatically bootstrap when executed as the main application process (outside test runners)
if (process.env.NODE_ENV !== "test") {
  bootstrap().catch((error: unknown) => {
    const logger = new Logger("Bootstrap");
    logger.error("Failed to bootstrap API application", error);
    process.exit(1);
  });
}
