import type {
  WizardClaimComparisonScope,
  WizardClaimExpectedValue,
  WizardClaimField,
} from "../../contracts/reconciliation/wizard-claim-comparison.contract.js";

export class CompareWizardClaimQuery {
  constructor(
    public readonly assessmentId: string,
    public readonly organizationId: string,
    public readonly wizardProfileId: string,
    public readonly evidenceReportId: string,
    public readonly targetId: string,
    public readonly claimField: WizardClaimField,
    public readonly expectedValue: WizardClaimExpectedValue,
    public readonly comparisonScope: WizardClaimComparisonScope,
    public readonly maxEvidenceRefs: number,
    public readonly correlationId: string,
  ) {}
}
