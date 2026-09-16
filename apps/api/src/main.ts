import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module.js";
import { FilePartitionedLogger } from "./platform/logging/file-partitioned-logger.js";
import { httpBodyParser } from "./http-body-parser.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
    logger: new FilePartitionedLogger(),
  });
  app.use(httpBodyParser());
  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
