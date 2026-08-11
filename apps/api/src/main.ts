import { json } from "express";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(json({ limit: "1mb" }));
  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
