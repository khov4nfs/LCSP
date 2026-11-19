import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module.js";
import type { AppConfig } from "./config/config.types.js";
import { FilePartitionedLogger } from "./platform/logging/file-partitioned-logger.js";
import {
  applyNetworkEdgeMiddleware,
  httpBodyParser,
} from "./platform/http/index.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
    logger: new FilePartitionedLogger(),
  });

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

void bootstrap();
