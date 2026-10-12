import { BillingDomainError } from "./billing.errors.js";
import type { EffectiveRuntimeModel } from "@lcsp/contracts/billing";

const MAX_RUNTIME_MODEL_FIELD_LENGTH = 160;

export type EffectiveRuntimeModelConfig = {
  role: string;
  provider: string;
  model: string;
  policyVersion: string;
  effectiveAt: Date;
};

/** Validates the durable runtime-policy selection carried with an invocation. */
export function assertEffectiveRuntimeModelAt(
  model: EffectiveRuntimeModel,
  occurredAt: Date,
): Date {
  if (
    !model.provider.trim() ||
    !model.model.trim() ||
    !model.policyVersion.trim()
  )
    throw new BillingDomainError(
      "Effective runtime model identity is required",
    );
  if (
    [model.provider, model.model, model.policyVersion].some(
      (value) => value.length > MAX_RUNTIME_MODEL_FIELD_LENGTH,
    )
  )
    throw new BillingDomainError(
      "Effective runtime model identity is too long",
    );
  const effectiveAt = new Date(model.effectiveAt);
  if (Number.isNaN(effectiveAt.getTime()))
    throw new BillingDomainError("Effective runtime model time is invalid");
  if (effectiveAt.getTime() > occurredAt.getTime())
    throw new BillingDomainError(
      "Effective runtime model is not active at the usage time",
    );
  return effectiveAt;
}

/** Ensures worker metadata matches the server-selected policy snapshot exactly. */
export function assertMatchesEffectiveRuntimeModel(
  selected: EffectiveRuntimeModelConfig,
  reported: EffectiveRuntimeModel,
): void {
  if (
    selected.provider !== reported.provider ||
    selected.model !== reported.model ||
    selected.policyVersion !== reported.policyVersion ||
    selected.effectiveAt.getTime() !== new Date(reported.effectiveAt).getTime()
  )
    throw new BillingDomainError(
      "Usage runtime model is not the effective runtime policy selection",
    );
}
