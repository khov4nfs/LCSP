export const ASSESSMENT_INTERVIEW_OUTCOMES = {
  waitingForCustomer: "WAITING_FOR_CUSTOMER",
  contextReady: "CONTEXT_READY",
  contextResolved: "CONTEXT_RESOLVED",
  blockedOrUnresolved: "BLOCKED_OR_UNRESOLVED",
  failed: "FAILED",
} as const;

export type AssessmentInterviewOutcome =
  (typeof ASSESSMENT_INTERVIEW_OUTCOMES)[keyof typeof ASSESSMENT_INTERVIEW_OUTCOMES];

export const ASSESSMENT_INTERVIEW_QUESTION_INTENTS = {
  ask: "ASK",
  clarify: "CLARIFY",
} as const;

export type AssessmentInterviewQuestionIntent =
  (typeof ASSESSMENT_INTERVIEW_QUESTION_INTENTS)[keyof typeof ASSESSMENT_INTERVIEW_QUESTION_INTENTS];

export const ASSESSMENT_INTERVIEW_CONTROLS = {
  freeText: "FREE_TEXT",
  boolean: "BOOLEAN",
  singleSelect: "SINGLE_SELECT",
  multiSelect: "MULTI_SELECT",
  confirmAdjust: "CONFIRM_ADJUST",
} as const;

export type AssessmentInterviewControl =
  (typeof ASSESSMENT_INTERVIEW_CONTROLS)[keyof typeof ASSESSMENT_INTERVIEW_CONTROLS];

export const ASSESSMENT_INTERVIEW_ANSWER_ACTIONS = {
  confirm: "CONFIRM",
  adjust: "ADJUST",
} as const;

export type AssessmentInterviewAnswerAction =
  (typeof ASSESSMENT_INTERVIEW_ANSWER_ACTIONS)[keyof typeof ASSESSMENT_INTERVIEW_ANSWER_ACTIONS];

export const ASSESSMENT_TECHNICAL_COVERAGE_STATES = {
  ready: "READY",
  partial: "PARTIAL",
  unavailable: "UNAVAILABLE",
} as const;

export type AssessmentTechnicalCoverageState =
  (typeof ASSESSMENT_TECHNICAL_COVERAGE_STATES)[keyof typeof ASSESSMENT_TECHNICAL_COVERAGE_STATES];

export const ASSESSMENT_CONTEXT_AUTHORITY_STATUSES = {
  customerStated: "CUSTOMER_STATED",
  uncertain: "UNCERTAIN",
  conflicted: "CONFLICTED",
  customerConfirmed: "CUSTOMER_CONFIRMED",
  confirmed: "CONFIRMED",
  superseded: "SUPERSEDED",
} as const;

export type AssessmentContextAuthorityStatus =
  (typeof ASSESSMENT_CONTEXT_AUTHORITY_STATUSES)[keyof typeof ASSESSMENT_CONTEXT_AUTHORITY_STATUSES];

export const CONFIRMED_STRUCTURED_BUSINESS_CONTEXT_AUTHORITIES = {
  customerConfirmedConfirmedOnly: "CUSTOMER_CONFIRMED_CONFIRMED_ONLY",
} as const;

export type ConfirmedStructuredBusinessContextAuthority =
  (typeof CONFIRMED_STRUCTURED_BUSINESS_CONTEXT_AUTHORITIES)[keyof typeof CONFIRMED_STRUCTURED_BUSINESS_CONTEXT_AUTHORITIES];

export const ASSESSMENT_CONTEXT_UPDATE_SOURCES = {
  customer: "CUSTOMER",
  runtime: "RUNTIME",
} as const;

export type AssessmentContextUpdateSource =
  (typeof ASSESSMENT_CONTEXT_UPDATE_SOURCES)[keyof typeof ASSESSMENT_CONTEXT_UPDATE_SOURCES];

export const ASSESSMENT_INTERVIEW_FLAGS = {
  downstreamImpact: "DOWNSTREAM_IMPACT",
} as const;

export type AssessmentInterviewFlag =
  (typeof ASSESSMENT_INTERVIEW_FLAGS)[keyof typeof ASSESSMENT_INTERVIEW_FLAGS];

export const ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS = {
  provideMoreContext: "PROVIDE_MORE_CONTEXT",
  checkInternally: "CHECK_INTERNALLY",
  saveAndExit: "SAVE_AND_EXIT",
} as const;

export type AssessmentInterviewBlockedAction =
  (typeof ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS)[keyof typeof ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS];

export const INTERVIEW_FRONTIER_OWNERS = {
  customer: "CUSTOMER",
  technical: "TECHNICAL",
  system: "SYSTEM",
} as const;

export type InterviewFrontierOwner =
  (typeof INTERVIEW_FRONTIER_OWNERS)[keyof typeof INTERVIEW_FRONTIER_OWNERS];

export const INTERVIEW_FRONTIER_MATERIALITIES = {
  material: "MATERIAL",
  nonMaterial: "NON_MATERIAL",
} as const;

export type InterviewFrontierMateriality =
  (typeof INTERVIEW_FRONTIER_MATERIALITIES)[keyof typeof INTERVIEW_FRONTIER_MATERIALITIES];

export type AssessmentInterviewFrontierCandidate = {
  owner: InterviewFrontierOwner;
  materiality: InterviewFrontierMateriality;
  description: string;
  evidenceRefs?: string[];
};

export type PersistedCustomerQuestionFrontier = {
  owner: typeof INTERVIEW_FRONTIER_OWNERS.customer;
  materiality: typeof INTERVIEW_FRONTIER_MATERIALITIES.material;
  description: string;
  evidenceRefs?: string[];
};

export type AssessmentInterviewFrontier =
  | PersistedCustomerQuestionFrontier
  | AssessmentInterviewFrontierCandidate;

export type AssessmentInterviewQuestionChoice = {
  id: string;
  label: string;
  description?: string;
  requiresFreeText?: boolean;
};

export type AssessmentInterviewQuestion = {
  id: string;
  needId?: string;
  intent: AssessmentInterviewQuestionIntent;
  control: AssessmentInterviewControl;
  prompt: string;
  choices?: AssessmentInterviewQuestionChoice[];
  priorAnswerSummary?: string;
  whyEvidenceRefs?: string[];
  whyAreWeAsking?: string;
  hasSupportingEvidence?: boolean;
  frontier?: PersistedCustomerQuestionFrontier;
};

export type ConfirmedStructuredBusinessStatement = {
  statementId: string;
  assessmentId: string;
  topic: string;
  statement: string;
  normalizedValue?: unknown;
  scope?: Record<string, unknown>;
  respondentRef: string;
  createdAt: string;
  source: typeof ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.customerConfirmed;
  resolutionState: typeof ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.confirmed;
  evidenceRefs: string[];
};

export type ConfirmedStructuredBusinessContext = {
  assessmentId: string;
  contextRevision: number;
  authority: typeof CONFIRMED_STRUCTURED_BUSINESS_CONTEXT_AUTHORITIES.customerConfirmedConfirmedOnly;
  statements: ConfirmedStructuredBusinessStatement[];
  createdByActorRef?: string;
};

export type AssessmentInterviewAuditRef = {
  authenticatedActorId: string;
  timestamp: string;
  assessmentId: string;
  sourceVersion: string;
  pgeVersion: string;
  guidanceVersion?: string;
  sessionId: string;
  turnId: string;
  contextRevision: number;
  priorRevision?: number;
  newRevision?: number;
  relatedQuestionId?: string;
  governedEvidenceRefs?: string[];
};

export type AssessmentInterviewAnswerHistoryItem = {
  questionId: string;
  answeredAt: string;
  /** Internal history stores actorId; Customer projections omit it. */
  actorId?: string;
  summary: string;
};

export type AssessmentInterviewRuntimeState = {
  outcome: AssessmentInterviewOutcome;
  activeQuestion?: AssessmentInterviewQuestion;
  flags?: AssessmentInterviewFlag[];
  contextAuthority?: AssessmentContextAuthorityStatus;
  /** Worker-only authoritative context; public runtime surfaces redact this field. */
  confirmedContext?: Record<string, unknown>;
  blockedActions?: AssessmentInterviewBlockedAction[];
  audit?: AssessmentInterviewAuditRef;
  threadId?: string;
  contextRevision?: number;
  orchestrationRequested?: boolean;
  pendingDraft?: string;
  answerHistory?: AssessmentInterviewAnswerHistoryItem[];
};

/** Session-local, non-authoritative hints used to improve the next Interview turn. */
export type InterviewWorkingStrategy = {
  terminologyMap: Record<string, string>;
  avoidReaskingTopics: string[];
  effectiveQuestionPatterns: string[];
  observedAmbiguities: string[];
  interactionNotes: string[];
};

export const EMPTY_INTERVIEW_WORKING_STRATEGY: InterviewWorkingStrategy = {
  terminologyMap: {},
  avoidReaskingTopics: [],
  effectiveQuestionPatterns: [],
  observedAmbiguities: [],
  interactionNotes: [],
};

export type AssessmentInterviewAnswerInput = {
  questionId: string;
  freeText?: string;
  selectedChoiceIds?: string[];
  otherText?: string;
  confirmed?: boolean;
  adjusted?: boolean;
};

export type AssessmentInterviewBlockedInput = {
  action: AssessmentInterviewBlockedAction;
  draft?: string;
};

const INTERVIEW_OUTCOME_SET = new Set<string>(
  Object.values(ASSESSMENT_INTERVIEW_OUTCOMES),
);
const INTERVIEW_QUESTION_INTENT_SET = new Set<string>(
  Object.values(ASSESSMENT_INTERVIEW_QUESTION_INTENTS),
);
const AUTHORITATIVE_CONTEXT_STATUSES = new Set<string>([
  ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.customerConfirmed,
  ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.confirmed,
]);

export function isAssessmentInterviewOutcome(
  value: unknown,
): value is AssessmentInterviewOutcome {
  return typeof value === "string" && INTERVIEW_OUTCOME_SET.has(value);
}

export function isAssessmentInterviewQuestionIntent(
  value: unknown,
): value is AssessmentInterviewQuestionIntent {
  return typeof value === "string" && INTERVIEW_QUESTION_INTENT_SET.has(value);
}

export function isAuthoritativeAssessmentContextStatus(
  value: unknown,
): value is AssessmentContextAuthorityStatus {
  return typeof value === "string" && AUTHORITATIVE_CONTEXT_STATUSES.has(value);
}

export function hasValidInterviewWaitingInvariant(
  state: Pick<AssessmentInterviewRuntimeState, "activeQuestion" | "outcome">,
): boolean {
  return (
    state.activeQuestion === undefined ||
    state.outcome === ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer
  );
}
