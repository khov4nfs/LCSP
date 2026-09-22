import { Injectable, Optional } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type {
  CallHandler,
  ExecutionContext,
  NestInterceptor,
} from "@nestjs/common";
import type { Observable } from "rxjs";
import { map } from "rxjs/operators";

import { BYPASS_ENVELOPE_KEY } from "./bypass-envelope.decorator.js";
import { isRecord } from "../../../common/utils/index.js";

type HttpResponse = {
  headersSent?: boolean;
};

/**
 * Checks whether the given payload is already wrapped in the standard result envelope.
 */
function isAlreadyEnveloped(data: unknown): boolean {
  if (!isRecord(data)) {
    return false;
  }
  if (data.ok === true && "data" in data) {
    return true;
  }
  if (data.ok === false && "problem" in data) {
    return true;
  }
  return false;
}

/**
 * Automatically wraps successful controller return values in the standardized API success envelope { ok: true, data }.
 */
@Injectable()
export class ResponseTransformInterceptor implements NestInterceptor {
  constructor(@Optional() private readonly reflector?: Reflector) {}

  /**
   * Inspects each handler response and wraps successful data into { ok: true, data }.
   *
   * @param context - Nest execution context used to access the HTTP response.
   * @param next - Downstream handler whose response stream should be wrapped.
   * @returns Observable containing the wrapped body.
   */
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") {
      return next.handle();
    }

    const response = context.switchToHttp().getResponse<HttpResponse>();
    const targets = [
      typeof context.getHandler === "function"
        ? context.getHandler()
        : undefined,
      typeof context.getClass === "function" ? context.getClass() : undefined,
    ].filter(
      (target): target is NonNullable<typeof target> => target !== undefined,
    );
    const isBypassed =
      targets.length > 0
        ? this.reflector?.getAllAndOverride<boolean>(
            BYPASS_ENVELOPE_KEY,
            targets,
          )
        : undefined;

    return next.handle().pipe(
      map((data: unknown) => {
        if (response?.headersSent || isBypassed || isAlreadyEnveloped(data)) {
          return data;
        }

        return {
          ok: true,
          data,
        };
      }),
    );
  }
}
