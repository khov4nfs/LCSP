import { BillingDomainError } from "../../../domain/billing.errors.js";

export function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

export function parseInteger(value: string, field: string): bigint {
  if (!/^-?\d+$/.test(value))
    throw new BillingDomainError(`${field} must be an integer`);
  try {
    return BigInt(value);
  } catch {
    throw new BillingDomainError(`${field} is invalid`);
  }
}

export function parseNonNegativeInteger(value: string, field: string): bigint {
  const parsed = parseInteger(value, field);
  if (parsed < 0n)
    throw new BillingDomainError(`${field} must be non-negative`);
  return parsed;
}
