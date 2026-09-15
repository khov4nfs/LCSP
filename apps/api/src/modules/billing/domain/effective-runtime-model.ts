import { BillingDomainError } from "./billing.errors.js";
import type { EffectiveRuntimeModel } from "@lcsp/contracts/billing";

export type EffectiveRuntimeModelConfig = {
  role: string;
  provider: string;
  model: string;
  policyVersion: string;
  effectiveAt: Date;
};

/** Resolves exactly one runtime model config; billing never owns a provider/model allow-list. */
export function resolveEffectiveRuntimeModel(
  configs: readonly EffectiveRuntimeModelConfig[],
  role: string,
  at: Date,
): EffectiveRuntimeModelConfig {
  const candidates = configs
    .filter(
      (config) =>
        config.role === role && config.effectiveAt.getTime() <= at.getTime(),
    )
    .sort((a, b) => b.effectiveAt.getTime() - a.effectiveAt.getTime());
  const selected = candidates[0];
  if (!selected)
    throw new BillingDomainError("No effective runtime model configuration");
  if (
    candidates.filter(
      (config) =>
        config.effectiveAt.getTime() === selected.effectiveAt.getTime(),
    ).length > 1
  )
    throw new BillingDomainError(
      "Ambiguous effective runtime model configuration",
    );
  return selected;
}

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
