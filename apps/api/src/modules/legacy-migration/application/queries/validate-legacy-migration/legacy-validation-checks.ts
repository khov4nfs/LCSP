import {
  LEGACY_VALIDATION_STATUSES,
  type LegacyValidationCheck,
} from "@lcsp/contracts/legacy-migration";

const { PASS, FAIL, WARN } = LEGACY_VALIDATION_STATUSES;

type Spec = {
  id: string;
  title: string;
  observed: unknown;
  expected: unknown;
  /** True when the check passes. */
  ok: boolean;
  /** Non-blocking checks degrade to WARN instead of FAIL. */
  blocking?: boolean;
};

/** One reconciliation check. Blocking by default: a failed check fails the run. */
export function check(spec: Spec): LegacyValidationCheck {
  const blocking = spec.blocking ?? true;
  return {
    id: spec.id,
    title: spec.title,
    status: spec.ok ? PASS : blocking ? FAIL : WARN,
    blocking,
    observed: spec.observed,
    expected: spec.expected,
  };
}

/** A check expressed as "this counter must be zero". */
export const zero = (
  id: string,
  title: string,
  observed: number,
  blocking = true,
): LegacyValidationCheck =>
  check({ id, title, observed, expected: 0, ok: observed === 0, blocking });

export function summarize(checks: readonly LegacyValidationCheck[]) {
  const count = (status: string) =>
    checks.filter((c) => c.status === status).length;
  return {
    pass: count(PASS),
    fail: count(FAIL),
    warn: count(WARN),
    blockingFailures: checks.filter((c) => c.status === FAIL && c.blocking)
      .length,
  };
}

/** Deep structural equality over parsed JSON, independent of the database's text form. */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length)
      return false;
    return a.every((item, index) => jsonEqual(item, b[index]));
  }
  if (typeof a !== "object") return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => key in right && jsonEqual(left[key], right[key]));
}

export function withoutKeys(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  const copy = { ...(value as Record<string, unknown>) };
  for (const key of keys) delete copy[key];
  return copy;
}
