import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
import { HttpStatus, Injectable, type PipeTransform } from "@nestjs/common";
import type { z } from "zod";

import { problemException } from "../../platform/http/filters/error.factory.js";

const SAFE_EXPECTED_TYPES: ReadonlySet<string> = new Set([
  "array",
  "object",
  "string",
  "number",
  "boolean",
  "null",
]);

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
      const issues = result.error.issues.slice(0, 20);
      // Forward schema-authored constraints and known type names, never submitted values.
      const requirements = [
        ...new Set(
          issues.flatMap((issue) => {
            if (issue.code === "custom") return [issue.message.slice(0, 200)];
            if (
              issue.code === "invalid_type" &&
              SAFE_EXPECTED_TYPES.has(issue.expected)
            ) {
              return [
                `${issue.path.join(".") || "body"} requires ${issue.expected}`,
              ];
            }
            return [];
          }),
        ),
      ]
        .join(" | ")
        .slice(0, 800);
      throw problemException(this.validationErrorCode, "", {
        status: this.status,
        ...(this.includeIssuePaths
          ? {
              meta: {
                issues: issues.map((issue) => issue.path.join(".")).join(","),
                ...(requirements ? { requirements } : {}),
              },
            }
          : {}),
      });
    }
    return result.data as TOutput;
  }
}
