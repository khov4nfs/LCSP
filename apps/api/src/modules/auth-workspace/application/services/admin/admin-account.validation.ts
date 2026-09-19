import { HttpStatus } from "@nestjs/common";
import {
  ADMIN_ACCOUNT_ERRORS as E,
  ADMIN_ACCOUNT_FILTERS,
  ADMIN_ACCOUNT_QUERY_LIMITS as L,
  AUTH_ACCOUNT_STATUSES,
  AUTH_USER_ROLES,
  type AuthUserRole,
} from "@lcsp/contracts/auth";
import { problemException } from "../../../../../platform/problems/problem-factory.js";

export function invalid(correlationId: string): never {
  throw problemException(E.invalidInput, correlationId, {
    status: HttpStatus.BAD_REQUEST,
  });
}
export function record(
  value: unknown,
  correlationId: string,
  allowed: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return invalid(correlationId);
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !allowed.includes(key)))
    return invalid(correlationId);
  return input;
}
export function role(value: unknown, correlationId: string): AuthUserRole {
  if (value !== AUTH_USER_ROLES.admin && value !== AUTH_USER_ROLES.customer)
    return invalid(correlationId);
  return value;
}
export function version(value: unknown, correlationId: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    return invalid(correlationId);
  return value as number;
}
export function reason(
  value: unknown,
  correlationId: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    value.trim().length < 1 ||
    value.trim().length > 500
  )
    return invalid(correlationId);
  return value.trim();
}
export function idempotency(value: unknown, correlationId: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) {
    throw problemException(E.idempotencyRequired, correlationId, {
      status: HttpStatus.BAD_REQUEST,
    });
  }
  return value;
}
export function parseListQuery(
  value: Record<string, unknown>,
  correlationId: string,
) {
  const scalar = (key: string): string | undefined => {
    const v = value[key];
    if (v === undefined) return undefined;
    if (typeof v !== "string") return invalid(correlationId);
    return v;
  };
  const q = scalar("q");
  const queryAlias = scalar("query");
  if (q !== undefined && queryAlias !== undefined && q !== queryAlias)
    return invalid(correlationId);
  const query = (q ?? queryAlias ?? "").trim();
  if (query.length > L.maxQueryLength) return invalid(correlationId);
  const s = scalar("status");
  const r = scalar("role");
  const status =
    s === undefined || s === ADMIN_ACCOUNT_FILTERS.all ? undefined : s;
  if (
    status !== undefined &&
    ![AUTH_ACCOUNT_STATUSES.active, AUTH_ACCOUNT_STATUSES.suspended].some(
      (v) => v === status,
    )
  )
    return invalid(correlationId);
  const filterRole =
    r === undefined || r === ADMIN_ACCOUNT_FILTERS.all
      ? undefined
      : role(r, correlationId);
  const integer = (v: string | undefined, fallback: number, max: number) => {
    if (v === undefined) return fallback;
    if (
      !/^[1-9][0-9]*$/.test(v) ||
      !Number.isSafeInteger(Number(v)) ||
      Number(v) > max
    )
      return invalid(correlationId);
    return Number(v);
  };
  const size = scalar("pageSize");
  const sizeAlias = scalar("page_size");
  if (size !== undefined && sizeAlias !== undefined && size !== sizeAlias)
    return invalid(correlationId);
  return {
    query,
    status,
    role: filterRole,
    page: integer(scalar("page"), 1, L.maxPage),
    pageSize: integer(size ?? sizeAlias, L.defaultPageSize, L.maxPageSize),
  };
}
