import { createSuccessResult, type AppResult } from "@lcsp/contracts/auth";

/**
 * Wraps plain handler data in the standard success result while preserving values that are already API results.
 *
 * @param value - Handler value to normalize into the API result contract.
 * @returns Existing API result or a new successful result containing the supplied value.
 */
export function resultEnvelope<TData>(value: TData): AppResult<TData, string> {
  if (isApiResult(value)) {
    return value as AppResult<TData, string>;
  }

  return createSuccessResult(value);
}

/**
 * Checks whether a runtime value already matches either the success or failure API result shape.
 *
 * @param value - Runtime value to inspect.
 * @returns True when the value is a valid success result with data or a failure result with a problem object.
 */
export function isApiResult(
  value: unknown,
): value is AppResult<unknown, string> {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as {
    data?: unknown;
    ok?: unknown;
    problem?: unknown;
  };
  if (candidate.ok === true) {
    return "data" in candidate;
  }

  if (candidate.ok === false) {
    return typeof candidate.problem === "object" && candidate.problem !== null;
  }

  return false;
}
