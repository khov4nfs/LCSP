import { ASSESSMENT_DOMAIN_ACTIVITY_LABEL_KEYS } from "@lcsp/contracts/assessment-domain";
import {
  WORK_STEP_KINDS,
  WORK_STEP_PHASES,
  type WorkStepKind,
  type WorkStepPhase,
} from "../types/conversation.types";

type StepDescriptor = { kind: WorkStepKind; phase: WorkStepPhase };

const KEYS = ASSESSMENT_DOMAIN_ACTIVITY_LABEL_KEYS;

/**
 * Customer-safe activity catalog -> the unit of work it belongs to. A catalog key that is not
 * listed (or any free-form key) becomes the generic OTHER step: the conversation never invents
 * detail the canonical event does not carry.
 */
export const WORK_STEP_CATALOG: Readonly<Record<string, StepDescriptor>> = {
  [KEYS.FACT_ACCEPTED]: {
    kind: WORK_STEP_KINDS.FACT,
    phase: WORK_STEP_PHASES.SINGLE,
  },
  [KEYS.RULE_INVESTIGATION_STARTED]: {
    kind: WORK_STEP_KINDS.RULE,
    phase: WORK_STEP_PHASES.SINGLE,
  },
  [KEYS.TASK_STARTED]: {
    kind: WORK_STEP_KINDS.RESEARCH,
    phase: WORK_STEP_PHASES.START,
  },
  [KEYS.TASK_FINISHED]: {
    kind: WORK_STEP_KINDS.RESEARCH,
    phase: WORK_STEP_PHASES.DONE,
  },
  [KEYS.MODEL_STEP_COMPLETED]: {
    kind: WORK_STEP_KINDS.REASONING,
    phase: WORK_STEP_PHASES.SINGLE,
  },
  [KEYS.REPOSITORY_INSPECTED]: {
    kind: WORK_STEP_KINDS.INSPECTION,
    phase: WORK_STEP_PHASES.SINGLE,
  },
};

/** The opening of the Root run is the OPENING turn, not a work step. */
export const OPENING_LABEL_KEYS: ReadonlySet<string> = new Set([
  KEYS.ROOT_STARTED,
]);
