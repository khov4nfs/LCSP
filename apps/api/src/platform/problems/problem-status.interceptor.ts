import { Injectable } from "@nestjs/common";
import type {
  CallHandler,
  ExecutionContext,
  NestInterceptor,
} from "@nestjs/common";
import type { ProblemResult } from "@lcsp/contracts/auth";
import type { Observable } from "rxjs";
import { map } from "rxjs/operators";

import { setProblemResponseMetadata } from "./problem-response-metadata.js";

type HttpResponse = {
  status: (statusCode: number) => unknown;
  locals?: Record<string, unknown>;
};

/**
 * Applies the HTTP error status embedded in returned problem results and exposes their metadata to later response logging.
 */
@Injectable()
export class ProblemStatusInterceptor implements NestInterceptor {
  /**
   * Inspects each handler response and applies its problem status when the body represents a standardized API error.
   *
   * @param context - Nest execution context used to access the HTTP response.
   * @param next - Downstream handler whose response stream should be inspected.
   * @returns Observable containing the original body after any required HTTP status update.
   */
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const response = context.switchToHttp().getResponse<HttpResponse>();

    return next.handle().pipe(
      map((body: unknown) => {
        const status = getProblemStatus(body);
        if (status !== undefined) {
          setProblemResponseMetadata(response, body);
          response.status(status);
        }

        return body;
      }),
    );
  }
}

/**
 * Extracts a valid HTTP error status from a standardized problem result.
 *
 * @param body - Handler response body to inspect.
 * @returns HTTP error status when present and valid; otherwise undefined.
 */
function getProblemStatus(body: unknown): number | undefined {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }

  const result = body as Partial<ProblemResult<string>>;
  const status =
    result.ok === false && result.problem !== undefined
      ? result.problem.status
      : undefined;

  return isHttpErrorStatus(status) ? status : undefined;
}

/**
 * Checks whether a value is an HTTP 4xx or 5xx status code.
 *
 * @param status - Runtime value to validate as an HTTP error status.
 * @returns True when the value is a numeric status between 400 and 599.
 */
function isHttpErrorStatus(status: unknown): status is number {
  return typeof status === "number" && status >= 400 && status <= 599;
}
