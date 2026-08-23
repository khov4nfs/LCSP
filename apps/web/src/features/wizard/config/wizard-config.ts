import {
  WIZARD_CHECKBOX_OPTIONS,
  WIZARD_SELECT_OPTIONS,
  WIZARD_STEPS,
} from "@lcsp/contracts/wizard";

export const WIZARD_LOCAL_STORAGE_PREFIX = "lcsp-wizard-draft";

export const checkboxOptions = WIZARD_CHECKBOX_OPTIONS;
export const selectOptions = WIZARD_SELECT_OPTIONS;
export const wizardSteps = WIZARD_STEPS;
export const wizardDeepResearchStep = {
  id: "deep-research",
  titleKey: "pages.wizard.sections.deepResearch",
} as const;
export const WIZARD_DEEP_RESEARCH_STEP_NUMBER = wizardSteps.length + 1;
