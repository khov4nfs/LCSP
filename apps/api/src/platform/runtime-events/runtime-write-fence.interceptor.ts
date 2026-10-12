import {
  type CallHandler,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import type { Request } from "express";
import { defer, lastValueFrom, type Observable } from "rxjs";
import {
  ASSESSMENT_RUNTIME_CONTROL_STATES as States,
  ASSESSMENT_RUNTIME_CONTROL_PROBLEM_CODES as Problems,
} from "@lcsp/contracts/evidence";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../http/filters/error.factory.js";

/** A stopped acknowledgement waits for already-admitted worker writes to finish.
 * Later writes from an abandoned model/tool thread are rejected, including after
 * a new cancellation generation has resumed the same logical checkpoint.
 */
@Injectable()
export class RuntimeWriteFenceInterceptor implements NestInterceptor<
  unknown,
  unknown
> {
  constructor(private readonly prisma: PrismaService) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<unknown>,
  ): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const runId = req.headers?.["x-lcsp-runtime-run-id"];
    const path: string = req.originalUrl ?? req.url ?? "";
    if (
      typeof runId !== "string" ||
      !path.startsWith("/internal/") ||
      req.method === "GET" ||
      path.startsWith("/internal/assessment-runtime-controls") ||
      path.includes("/billing/usage")
    )
      return next.handle();
    return defer(() =>
      this.prisma.$transaction(
        async (tx) => {
          const rows = await tx.$queryRaw<Array<{ state: string }>>`
        SELECT "state" FROM "AssessmentRuntimeTurn" WHERE "id" = ${runId} FOR SHARE
      `;
          if (
            !rows[0] ||
            (rows[0].state !== States.running &&
              rows[0].state !== States.stopRequested)
          ) {
            const correlationId = req.headers["x-correlation-id"];
            throw problemException(
              Problems.staleTarget,
              typeof correlationId === "string" ? correlationId : runId,
              { status: HttpStatus.CONFLICT },
            );
          }
          return lastValueFrom(next.handle());
        },
        { timeout: 30_000 },
      ),
    );
  }
}
