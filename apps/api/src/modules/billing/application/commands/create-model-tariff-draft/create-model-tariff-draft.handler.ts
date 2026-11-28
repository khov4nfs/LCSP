import { Inject } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import {
  MODEL_PRICING_SCOPES,
  normalizeModelPricingScopeKey,
  type ModelTariffDraftView,
} from "@lcsp/contracts/billing";
import { InvalidBillingInputError } from "../../../domain/billing.errors.js";
import {
  MODEL_PRICING_REPOSITORY,
  type ModelPricingRepositoryPort,
} from "../../../domain/repositories/model-pricing.port.js";
import {
  toMicrocreditTariffRates,
  toModelTariffDraftView,
} from "../../mappers/model-pricing-view.mapper.js";
import { ModelPricingCalculatorService } from "../../shared/model-pricing-calculator.service.js";
import { RuntimeModelAllowlistService } from "../../shared/runtime-model-allowlist.service.js";
import { CreateModelTariffDraftCommand } from "./create-model-tariff-draft.command.js";

/**
 * Business purpose: Parse an optional base-10 microcredit string input into a nullable `bigint` rate value.
 *
 * Business rules:
 * - Preserves `null` / `undefined` as `null` so optional rate buckets are never coerced to `0n`.
 *
 * Execution flow:
 * 1. Return `null` when input is `null` or `undefined`.
 * 2. Parse base-10 integer string via `BigInt(value)`.
 *
 * Failure cases:
 * - Throws `SyntaxError` if called with an invalid non-integer string outside Zod validation.
 *
 * Side effects:
 * - None: pure conversion helper.
 */
/**
 * Business purpose: Parse an optional or nullable string representation of an integer rate into a native bigint or null.
 *
 * Business rules:
 * - If value is null or undefined, preserves null representation without coercing to zero.
 * - Non-empty string values are parsed to exact BigInt values without fractional loss.
 *
 * Execution flow:
 * 1. Check if value is null or undefined; return null if so.
 * 2. Invoke BigInt constructor on value and return result.
 *
 * Failure cases:
 * - Throws SyntaxError if string contains non-integer characters.
 *
 * Side effects:
 * - Pure conversion function with zero side effects.
 */
// Rationale ("Why"): Converts wire string inputs safely to native domain BigInt rates.
// Mechanism ("How"): Guard checks nullish input before BigInt instantiation.
// Invariants & Constraints: Preserves null semantics; does not coerce missing rate to 0n.
/**
 * Business purpose: Parse a nullable wire-string microcredit rate into a native bigint domain representation.
 *
 * Business rules:
 * - If value is null or undefined, return null.
 * - If value is a valid numeric string, parse and return native bigint.
 *
 * Execution flow:
 * 1. Check if value is null or undefined; if so, return null.
 * 2. Convert value to BigInt and return.
 *
 * Failure cases:
 * - Throws SyntaxError if string is not a valid integer.
 *
 * Side effects:
 * - Pure data conversion; no state changes.
 */
function parseNullableBigInt(value: string | null | undefined): bigint | null {
  if (value === null || value === undefined) {
    return null;
  }
  return BigInt(value);
}

@CommandHandler(CreateModelTariffDraftCommand)
export class CreateModelTariffDraftHandler implements ICommandHandler<CreateModelTariffDraftCommand> {
  constructor(
    @Inject(MODEL_PRICING_REPOSITORY)
    private readonly repo: ModelPricingRepositoryPort,
    private readonly allowlistService: RuntimeModelAllowlistService,
    private readonly calculatorService: ModelPricingCalculatorService,
  ) {}

  /**
   * Business purpose: Create a new mutable `DRAFT` customer model tariff after validating scope normalization, allowlist membership, and rate completeness.
   *
   * Business rules:
   * - Normalizes `(scope, provider, resolvedModel)` via `normalizeModelPricingScopeKey` (`GLOBAL_DEFAULT`, `PROVIDER_DEFAULT:<provider>`, `EXACT_MODEL:<provider>:<model>`).
   * - Enforces runtime allowlist membership (`assertAllowlisted`) whenever `scope === EXACT_MODEL`.
   * - Validates non-negative `bigint` rates and secondary bucket policies via `assertCompleteTariffRates`.
   * - Never synthesizes rates from `1.8x` markups or reference pricing.
   *
   * Execution flow:
   * 1. Normalize scope identity and canonical `provider` / `resolvedModel` fields.
   * 2. Enforce allowlist gating for `EXACT_MODEL` and rate completeness across all token buckets.
   * 3. Persist the draft and `MODEL_PRICING_DRAFT_CREATED` audit event via `repo.createDraft`, returning the wire view.
   *
   * Failure cases:
   * - Throws `InvalidBillingInputError` on malformed scope identity.
   * - Throws `ModelPricingUnlistedModelError` when `EXACT_MODEL` targets a non-allowlisted model.
   * - Throws `ModelPricingIncompleteRatesError` when bucket policies or rates are invalid.
   *
   * Side effects:
   * - Inserts one `CustomerModelTariffDraft` row and one `AuditEvent` row atomically.
   */
  async execute(
    command: CreateModelTariffDraftCommand,
  ): Promise<ModelTariffDraftView> {
    // Why: Drafts capture candidate pricing changes safely without altering active runtime tariffs until published.
    // How: Normalizes scope keys, enforces EXACT_MODEL allowlisting and BigInt rate completeness, and persists via repository port.
    // Invariants: Never mutates snapshots or assignments; all microcredit values stay exact `bigint` until DTO projection.
    const { input } = command;

    let normalizedScopeKey: string;
    try {
      normalizedScopeKey = normalizeModelPricingScopeKey(
        input.scope,
        input.provider,
        input.resolvedModel,
      );
    } catch (error) {
      throw new InvalidBillingInputError(
        error instanceof Error
          ? error.message
          : "Invalid model pricing scope identity",
      );
    }

    const provider =
      input.scope === MODEL_PRICING_SCOPES.globalDefault
        ? null
        : input.provider!.trim().toLowerCase();
    const resolvedModel =
      input.scope === MODEL_PRICING_SCOPES.exactModel
        ? input.resolvedModel!.trim()
        : null;

    if (input.scope === MODEL_PRICING_SCOPES.exactModel) {
      this.allowlistService.assertAllowlisted(provider!, resolvedModel!);
    }

    const rateColumns = {
      inputMicrocreditsPerMillion: BigInt(input.inputMicrocreditsPerMillion),
      outputMicrocreditsPerMillion: BigInt(input.outputMicrocreditsPerMillion),
      reasoningPolicy: input.reasoningPolicy,
      reasoningMicrocreditsPerMillion: parseNullableBigInt(
        input.reasoningMicrocreditsPerMillion,
      ),
      cachedInputPolicy: input.cachedInputPolicy,
      cachedInputMicrocreditsPerMillion: parseNullableBigInt(
        input.cachedInputMicrocreditsPerMillion,
      ),
      cacheWritePolicy: input.cacheWritePolicy,
      cacheWriteMicrocreditsPerMillion: parseNullableBigInt(
        input.cacheWriteMicrocreditsPerMillion,
      ),
      cacheWrite5mMicrocreditsPerMillion: parseNullableBigInt(
        input.cacheWrite5mMicrocreditsPerMillion,
      ),
      cacheWrite1hMicrocreditsPerMillion: parseNullableBigInt(
        input.cacheWrite1hMicrocreditsPerMillion,
      ),
    };

    this.calculatorService.assertCompleteTariffRates(
      toMicrocreditTariffRates(rateColumns),
    );

    const created = await this.repo.createDraft({
      scope: input.scope,
      provider,
      resolvedModel,
      normalizedScopeKey,
      ...rateColumns,
      operationalAssumptions: input.operationalAssumptions ?? null,
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    return toModelTariffDraftView(created);
  }
}
