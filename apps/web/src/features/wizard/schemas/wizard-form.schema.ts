import { z } from "zod";

const textField = z.string().optional();
const arrayField = z.array(z.string()).optional();

const requiredText = (message: string) =>
  z.string({ message }).trim().min(1, { message });

const requiredArray = (message: string) =>
  z.array(z.string(), { message }).min(1, { message });

export const wizardDraftSchema = z.object({
  ps_001_ai_scope: textField,
  ps_002_affected_people: arrayField,
  ps_003_personal_or_sensitive_data: textField,
  ps_004_decision_importance: textField,
  businessProcess: textField,
  useCase: textField,
  primaryActors: textField,
  businessTrigger: textField,
  expectedOutcome: textField,
  aiPurpose: textField,
  autonomyLevel: textField,
  sector: textField,
  dataTypes: arrayField,
  affectedSubjects: arrayField,
  userImpact: textField,
  decisionRole: textField,
  humanReview: textField,
  externalLlmUsage: textField,
  specialCategoryData: textField,
  biometricData: textField,
  highImpactIndicators: arrayField,
  transparencyIndicators: arrayField,
  prohibitedRiskSignals: arrayField,
  deploymentContext: arrayField,
  postGraphContext: textField,
  postGraphRuleScope: textField,
  postGraphHumanReviewBoundary: textField,
});

export const wizardPreScreenSchema = z.object({
  ps_001_ai_scope: requiredText("pages.wizard.errors.preAiScopeRequired"),
  ps_002_affected_people: requiredArray(
    "pages.wizard.errors.preAffectedPeopleRequired",
  ),
  ps_003_personal_or_sensitive_data: requiredText(
    "pages.wizard.errors.prePersonalDataRequired",
  ),
  ps_004_decision_importance: requiredText(
    "pages.wizard.errors.preDecisionImportanceRequired",
  ),
});

export const wizardStepSchemas = [
  z.object({
    businessProcess: requiredText(
      "pages.wizard.errors.businessProcessRequired",
    ),
    useCase: requiredText("pages.wizard.errors.useCaseRequired"),
    primaryActors: requiredText("pages.wizard.errors.primaryActorsRequired"),
    businessTrigger: requiredText(
      "pages.wizard.errors.businessTriggerRequired",
    ),
    expectedOutcome: requiredText(
      "pages.wizard.errors.expectedOutcomeRequired",
    ),
    aiPurpose: requiredText("pages.wizard.errors.aiPurposeRequired"),
    autonomyLevel: requiredText("pages.wizard.errors.autonomyLevelRequired"),
    sector: requiredText("pages.wizard.errors.sectorRequired"),
  }),
  z.object({
    dataTypes: requiredArray("pages.wizard.errors.dataTypesRequired"),
    affectedSubjects: requiredArray(
      "pages.wizard.errors.affectedSubjectsRequired",
    ),
    userImpact: requiredText("pages.wizard.errors.userImpactRequired"),
  }),
  z
    .object({
      decisionRole: requiredText("pages.wizard.errors.decisionRoleRequired"),
      humanReview: textField,
    })
    .superRefine((value, ctx) => {
      if (
        value.decisionRole !== "NO_DECISION_SUPPORT" &&
        (!value.humanReview || value.humanReview.trim().length === 0)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["humanReview"],
          message: "pages.wizard.errors.humanReviewRequired",
        });
      }
    }),
  z.object({
    externalLlmUsage: requiredText(
      "pages.wizard.errors.externalLlmUsageRequired",
    ),
  }),
  z.object({
    deploymentContext: requiredArray(
      "pages.wizard.errors.deploymentContextRequired",
    ),
  }),
  z.object({
    specialCategoryData: requiredText(
      "pages.wizard.errors.specialCategoryDataRequired",
    ),
    biometricData: requiredText("pages.wizard.errors.biometricDataRequired"),
    highImpactIndicators: requiredArray(
      "pages.wizard.errors.highImpactIndicatorsRequired",
    ),
    transparencyIndicators: arrayField,
    prohibitedRiskSignals: requiredArray(
      "pages.wizard.errors.prohibitedRiskSignalsRequired",
    ),
  }),
] as const;

export const wizardSubmitSchema = wizardPreScreenSchema
  .merge(wizardStepSchemas[0])
  .merge(wizardStepSchemas[1])
  .merge(
    z.object({
      decisionRole: requiredText("pages.wizard.errors.decisionRoleRequired"),
      humanReview: textField,
    }),
  )
  .merge(wizardStepSchemas[3])
  .merge(wizardStepSchemas[4])
  .merge(wizardStepSchemas[5])
  .superRefine((value, ctx) => {
    if (
      value.decisionRole !== "NO_DECISION_SUPPORT" &&
      (!value.humanReview || value.humanReview.trim().length === 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["humanReview"],
        message: "pages.wizard.errors.humanReviewRequired",
      });
    }
  });

export type WizardFormValues = z.infer<typeof wizardDraftSchema>;
