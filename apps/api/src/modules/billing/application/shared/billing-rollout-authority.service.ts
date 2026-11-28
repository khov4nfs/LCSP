import {
  BILLING_ROLLOUT_MODES,
  MODEL_USAGE_DEBIT_MODES,
  type BillingRolloutMode,
  type ModelUsageDebitMode,
} from "@lcsp/contracts/billing";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { AppConfig } from "../../../../config/config.types.js";

export type BillingRolloutAuthority = {
  rolloutMode: BillingRolloutMode;
  debitMode: ModelUsageDebitMode;
};

@Injectable()
export class BillingRolloutAuthorityService {
  private testOverride: BillingRolloutAuthority | null = null;

  constructor(private readonly configService: ConfigService<AppConfig, true>) {}

  /**
   * Business purpose:
   * Provides the active server-authoritative billing rollout mode and debit authority for admission and settlement.
   *
   * Business rules:
   * - Production authority is derived strictly from validated ConfigService (`modelUsageDebit.mode`), never raw process.env.
   * - In Phase A-C, configuration fails closed on MODEL_USAGE_DEBIT=ON at boot until all WP8 gates (G-01..G-07) are formally approved.
   * - Test overrides are strictly forbidden in production (`process.env.NODE_ENV === 'production'`).
   * - Rollout authority progression is monotonic: TELEMETRY_ONLY -> SHADOW_PRICING -> ADMISSION_REQUIRED -> SHADOW_SETTLEMENT -> DEBIT_ENABLED.
   * - When debit mode is OFF, rollout mode is ADMISSION_REQUIRED.
   * - When debit mode is SHADOW, rollout mode is SHADOW_SETTLEMENT.
   * - When debit mode is ON, rollout mode is DEBIT_ENABLED (only possible with approved gate enablement or isolated test authority).
   *
   * Execution flow:
   * 1. Inspect whether an isolated test override is active in non-production environment; if so, return it.
   * 2. Read `modelUsageDebit.mode` from validated ConfigService.
   * 3. Map SHADOW to SHADOW_SETTLEMENT / SHADOW; default and all other modes map to ADMISSION_REQUIRED / OFF.
   * 4. Return immutable BillingRolloutAuthority object.
   *
   * Failure cases:
   * - Throws Error if test override is evaluated while running in production environment.
   *
   * Side effects:
   * - Pure accessor; zero database or stateful side effects.
   */
  // Rationale ("Why"): Enforces the startup boot gate and prevents unvalidated runtime environment bypasses.
  // Mechanism ("How"): Reads ConfigService by default, with an isolated test-only setter restricted to non-production.
  // Invariants: Production never issues DEBIT_ENABLED/ON while WP8 enablement gates are incomplete.
  getActiveRolloutAuthority(): BillingRolloutAuthority {
    if (this.testOverride) {
      if (process.env.NODE_ENV === "production") {
        throw new Error(
          "Security violation: Test rollout override is strictly forbidden in production",
        );
      }
      return this.testOverride;
    }

    const mode =
      this.configService.get("modelUsageDebit", { infer: true })?.mode ??
      MODEL_USAGE_DEBIT_MODES.OFF;

    if (mode === MODEL_USAGE_DEBIT_MODES.SHADOW) {
      return {
        rolloutMode: BILLING_ROLLOUT_MODES.SHADOW_SETTLEMENT,
        debitMode: MODEL_USAGE_DEBIT_MODES.SHADOW,
      };
    }

    return {
      rolloutMode: BILLING_ROLLOUT_MODES.ADMISSION_REQUIRED,
      debitMode: MODEL_USAGE_DEBIT_MODES.OFF,
    };
  }

  /**
   * Business purpose:
   * Configures an isolated test authority override for Phase D acceptance test suites without mutating production environment variables.
   *
   * Business rules:
   * - Strictly disallowed when NODE_ENV === 'production'.
   * - Overrides the active authority returned by getActiveRolloutAuthority for acceptance tests.
   * - Must be reset to null between test executions to prevent cross-test leakage.
   *
   * Execution flow:
   * 1. Verify NODE_ENV is not 'production'; throw if production.
   * 2. Store the provided override in the instance field.
   *
   * Failure cases:
   * - Throws Error if called when NODE_ENV === 'production'.
   *
   * Side effects:
   * - Mutates the in-memory testOverride field of this service instance.
   */
  // Rationale ("Why"): Enables testing DEBIT_ENABLED issuance and settlement without bypassing startup boot validation or editing process.env.
  // Mechanism ("How"): Retains a memory-only override guarded by a strict production environment check.
  // Invariants: Throws unconditionally in production environment.
  setTestRolloutOverride(override: BillingRolloutAuthority | null): void {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "Security violation: Cannot set test rollout override in production environment",
      );
    }
    this.testOverride = override;
  }
}
