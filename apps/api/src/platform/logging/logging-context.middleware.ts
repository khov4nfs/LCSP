import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { Request, Response, NextFunction } from "express";
import { requestStorage } from "./logging-context.js";

@Injectable()
export class LoggingContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    requestStorage.run(req, next);
  }
}
