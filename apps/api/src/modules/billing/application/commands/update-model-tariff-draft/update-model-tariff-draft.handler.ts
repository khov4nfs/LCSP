import { Inject } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import {
  MODEL_PRICING_SCOPES,
  type ModelTariffDraftView,
} from "@lcsp/contracts/billing";
import {
  MODEL_PRICING_REPOSITORY,
  type ModelPricingRepositoryPort,
} from "../../../domain/repositories/model-pricing.port.js";
import { toModelTariffDraftView } from "../../mappers/model-pricing-view.mapper.js";
import { ModelPricingCalculatorService } from "../../shared/model-pricing-calculator.service.js";
import { RuntimeModelAllowlistService } from "../../shared/runtime-model-allowlist.service.js";
import { UpdateModelTariffDraftCommand } from "./update-model-tariff-draft.command.js";

/**
 * Business purpose: Parse a tri-state patch rate string (`undefined` omitted, `null` cleared, string rate) into `bigint | null | undefined`.
 *
 * Business rules:
 * - Preserves `undefined` so omitted patch fields keep their existing draft value during merge.
 * - Preserves `null` so explicitly cleared optional rate fields become `null`.
 *
 * Execution flow:
 * 1. Return `undefined` if field was omitted, `null` if explicitly cleared.
 * 2. Otherwise convert base-10 string via `BigInt(value)`.
 *
 * Failure cases:
 * - Throws `SyntaxError` if called with a non-integer string outside Zod validation.
 *
 * Side effects:
 * - None: pure conversion helper.
 */
/**
 * Business purpose: Parse a partial patch rate value preserving undefined for omissions and null for clearing.
 *
 * Business rules:
 * - Returns undefined if key was not present in the patch payload (preserve existing).
 * - Returns null if key was explicitly passed as null (clear rate).
 * - Converts string to BigInt if value is provided.
 *
 * Execution flow:
 * 1. If value === undefined, return undefined.
 * 2. If value === null, return null.
 * 3. Return BigInt(value).
 *
 * Failure cases:
 * - Throws SyntaxError if string contains non-integer characters.
 *
 * Side effects:
 * - Pure conversion helper.
 */
// Rationale ("Why"): Distinguishes omitted fields from explicitly nulled fields in draft update patches.
// Mechanism ("How"): Tri-state check: undefined -> undefined, null -> null, string -> BigInt.
// Invariants & Constraints: Preserves existing values when undefined; clears values when null.
/**
 * Business purpose: Parse a tri-state patch field (undefined, null, or string) into an optional domain bigint.
 *
 * Business rules:
 * - Undefined means field was omitted from patch (keep existing value).
 * - Null means field was explicitly cleared (set to null).
 * - String value is parsed into native bigint.
 *
 * Execution flow:
 * 1. If value is undefined, return undefined.
 * 2. If value is null, return null.
 * 3. Return BigInt(value).
 *
 * Failure cases:
 * - Throws SyntaxError if string cannot be converted to BigInt.
 *
 * Side effects:
 * - Pure data conversion; no state modification.
 */
/**
 * Business purpose: Parse a partial patch rate string into a domain bigint, null, or undefined.
 *
 * Business rules:
 * - If undefined (omitted in patch), return undefined to indicate no update.
 * - If null (explicitly cleared), return null.
 * - If numeric string, parse and return native bigint.
 *
 * Execution flow:
 * 1. If undefined, return undefined.
 * 2. If null, return null.
 * 3. Return BigInt(value).
 *
 * Failure cases:
 * - Throws SyntaxError if string is not a valid integer.
 *
 * Side effects:
 * - Pure conversion helper.
 */
function parsePatchBigInt(
  value: string | null | undefined,
): bigint | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  return BigInt(value);
}

@CommandHandler(UpdateModelTariffDraftCommand)
export class UpdateModelTariffDraftHandler implements ICommandHandler<UpdateModelTariffDraftCommand> {
  constructor(
    @Inject(MODEL_PRICING_REPOSITORY)
    private readonly repo: ModelPricingRepositoryPort,
    private readonly allowlistService: RuntimeModelAllowlistService,
    private readonly calculatorService: ModelPricingCalculatorService,
  ) {}

  /**
   * Business purpose: Update an editable `DRAFT` tariff with optimistic version control (`expectedVersion`) without ever mutating published tariffs.
   *
   * Business rules:
   * - Only drafts in `DRAFT` status matching `expectedVersion` may be updated.
   * - Merged `(scope, provider, resolvedModel)` and token bucket rates must pass allowlist and completeness validation before commit.
   *
   * Execution flow:
   * 1. Pre-check allowlist when the patch itself supplies an `EXACT_MODEL` identity.
   * 2. Parse optional string rates to `bigint` and delegate atomic merge, CAS update, and audit logging to `repo.updateDraft`.
   * 3. Return the updated `ModelTariffDraftView`.
   *
   * Failure cases:
   * - Throws `ModelPricingNotFoundError` (404), `ModelPricingImmutableSnapshotError` (409 on `PUBLISHED`), `ModelPricingStaleDraftError` (409), `ModelPricingUnlistedModelError` (422), or `ModelPricingIncompleteRatesError` (422).
   *
   * Side effects:
   * - Updates `CustomerModelTariffDraft` (incrementing `version`) and inserts one `AuditEvent` row atomically.
   */
  async execute(
    command: UpdateModelTariffDraftCommand,
  ): Promise<ModelTariffDraftView> {
    // Why: Prevents lost updates and preserves immutable history by gating draft edits on `status === DRAFT` and `expectedVersion`.
    // How: Converts patched microcredit strings to `bigint` and executes transactional CAS merge in `repo.updateDraft`.
    // Invariants: Never updates `CustomerModelTariffSnapshot` or active `CustomerModelTariffAssignment` rows.
    const { input } = command;
    void this.calculatorService;

    if (
      input.scope === MODEL_PRICING_SCOPES.exactModel &&
      input.provider &&
      input.resolvedModel
    ) {
      this.allowlistService.assertAllowlisted(
        input.provider.trim().toLowerCase(),
        input.resolvedModel.trim(),
      );
    }

    const updated = await this.repo.updateDraft({
      draftId: input.draftId,
      expectedVersion: input.expectedVersion,
      scope: input.scope,
      provider: input.provider,
      resolvedModel: input.resolvedModel,
      inputMicrocreditsPerMillion:
        input.inputMicrocreditsPerMillion !== undefined
          ? BigInt(input.inputMicrocreditsPerMillion)
          : undefined,
      outputMicrocreditsPerMillion:
        input.outputMicrocreditsPerMillion !== undefined
          ? BigInt(input.outputMicrocreditsPerMillion)
          : undefined,
      reasoningPolicy: input.reasoningPolicy,
      reasoningMicrocreditsPerMillion: parsePatchBigInt(
        input.reasoningMicrocreditsPerMillion,
      ),
      cachedInputPolicy: input.cachedInputPolicy,
      cachedInputMicrocreditsPerMillion: parsePatchBigInt(
        input.cachedInputMicrocreditsPerMillion,
      ),
      cacheWritePolicy: input.cacheWritePolicy,
      cacheWriteMicrocreditsPerMillion: parsePatchBigInt(
        input.cacheWriteMicrocreditsPerMillion,
      ),
      cacheWrite5mMicrocreditsPerMillion: parsePatchBigInt(
        input.cacheWrite5mMicrocreditsPerMillion,
      ),
      cacheWrite1hMicrocreditsPerMillion: parsePatchBigInt(
        input.cacheWrite1hMicrocreditsPerMillion,
      ),
      operationalAssumptions: input.operationalAssumptions,
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    return toModelTariffDraftView(updated);
  }
}
