import { BillingDomainError } from "./billing.errors.js";

type EffectiveDated = { effectiveAt: Date };

/** Chooses the one immutable pricing record in force at `at`. */
export function selectEffectivePricingSnapshot<T extends EffectiveDated>(
  snapshots: readonly T[],
  at: Date,
): T | null {
  const applicable = snapshots.filter(
    (snapshot) => snapshot.effectiveAt.getTime() <= at.getTime(),
  );
  if (applicable.length === 0) return null;
  applicable.sort(
    (left, right) => right.effectiveAt.getTime() - left.effectiveAt.getTime(),
  );
  if (
    applicable.length > 1 &&
    applicable[0].effectiveAt.getTime() === applicable[1].effectiveAt.getTime()
  )
    throw new BillingDomainError(
      "Ambiguous pricing snapshot effective time for provider/model",
    );
  return applicable[0];
}
