import { CompareWizardClaimHandler } from "./application/queries/compare-wizard-claim/compare-wizard-claim.handler.js";
import { CompareWizardClaimController } from "./presentation/http/compare-wizard-claim.controller.js";

export const COMPARE_WIZARD_CLAIM_CONTROLLERS = [
  CompareWizardClaimController,
] as const;

export const COMPARE_WIZARD_CLAIM_PROVIDERS = [
  CompareWizardClaimHandler,
] as const;
