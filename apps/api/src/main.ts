import { json } from "express";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.match(/^\/internal\/scan-jobs\/[^/]+\/callback$/)) {
      (json({ limit: "50mb" }) as RequestHandler)(req, res, next);
    } else {
      (json({ limit: "1mb" }) as RequestHandler)(req, res, next);
    }
  });
  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
