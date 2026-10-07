import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
import { HttpStatus, Injectable, type PipeTransform } from "@nestjs/common";
import type { z } from "zod";

import { problemException } from "../../platform/http/filters/error.factory.js";

/**
 * NestJS Pipe that parses and validates incoming payloads using a Zod schema.
 * Throws a standard RFC 7807 problem exception with HTTP 400 when validation fails.
 */
@Injectable()
export class ZodValidationPipe<TOutput = unknown> implements PipeTransform<
  unknown,
  TOutput
> {
  constructor(
    private readonly schema: z.ZodTypeAny,
    private readonly validationErrorCode: string = AUTH_ERROR_CODES.validationFailed,
    private readonly status: number = HttpStatus.BAD_REQUEST,
    private readonly includeIssuePaths = false,
  ) {}

  /**
   * Transforms and validates the incoming value against the configured Zod schema.
   *
   * @param value - Raw incoming request body, query, or param value.
   * @returns Typed, sanitized, and parsed output.
   * @throws HttpException with standard RFC 7807 problem when parsing fails.
   */
  transform(value: unknown): TOutput {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw problemException(this.validationErrorCode, "", {
        status: this.status,
        ...(this.includeIssuePaths
          ? {
              meta: {
                issues: result.error.issues
                  .slice(0, 20)
                  .map((issue) => issue.path.join("."))
                  .join(","),
              },
            }
          : {}),
      });
    }
    return result.data as TOutput;
  }
}
