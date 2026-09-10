export type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
  JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type NonEmptyArray<T> = [T, ...T[]];

export const INTERVIEW_TECHNICAL_CONTRACT_VERSION =
  "interview-technical-contract-v1.0.0";

export type InterviewContractVersion =
  typeof INTERVIEW_TECHNICAL_CONTRACT_VERSION;

export const ASSESSMENT_INTERVIEW_OUTCOMES = {
  waitingForCustomer: "WAITING_FOR_CUSTOMER",
  contextReady: "CONTEXT_READY",
  contextResolved: "CONTEXT_RESOLVED",
  blockedOrUnresolved: "BLOCKED_OR_UNRESOLVED",
  failed: "FAILED",
} as const;

export type AssessmentInterviewOutcome =
  (typeof ASSESSMENT_INTERVIEW_OUTCOMES)[keyof typeof ASSESSMENT_INTERVIEW_OUTCOMES];

export type InterviewOutcome = AssessmentInterviewOutcome;

export const INTERVIEW_PROGRESS_PHASES = {
  queued: "QUEUED",
  running: "RUNNING",
  toolRunning: "TOOL_RUNNING",
  completed: "COMPLETED",
  failed: "FAILED",
} as const;

export type InterviewProgressPhase =
  (typeof INTERVIEW_PROGRESS_PHASES)[keyof typeof INTERVIEW_PROGRESS_PHASES];

/** Canonical Interview reasoning modes. PRE_PLANNER is input-only compatibility. */
export const ASSESSMENT_INTERVIEW_MODES = {
  initialInterview: "INITIAL_INTERVIEW",
  investigatorResolution: "INVESTIGATOR_RESOLUTION",
} as const;

export type AssessmentInterviewMode =
  (typeof ASSESSMENT_INTERVIEW_MODES)[keyof typeof ASSESSMENT_INTERVIEW_MODES];

export type InterviewMode = AssessmentInterviewMode;
export type CanonicalAssessmentInterviewMode = InterviewMode;

export const LEGACY_ASSESSMENT_INTERVIEW_MODES = {
  prePlanner: "PRE_PLANNER",
} as const;

export type LegacyAssessmentInterviewMode =
  (typeof LEGACY_ASSESSMENT_INTERVIEW_MODES)[keyof typeof LEGACY_ASSESSMENT_INTERVIEW_MODES];

export type LegacyInterviewMode = LegacyAssessmentInterviewMode;

export type AssessmentInterviewModeCompatibilityInput =
  AssessmentInterviewMode | LegacyAssessmentInterviewMode;

export type InterviewModeCompatibilityInput =
  AssessmentInterviewModeCompatibilityInput;

export function normalizeAssessmentInterviewMode(
  value: unknown,
): CanonicalAssessmentInterviewMode | undefined {
  if (
    value === ASSESSMENT_INTERVIEW_MODES.initialInterview ||
    value === LEGACY_ASSESSMENT_INTERVIEW_MODES.prePlanner
  ) {
    return ASSESSMENT_INTERVIEW_MODES.initialInterview;
  }
  if (value === ASSESSMENT_INTERVIEW_MODES.investigatorResolution) {
    return ASSESSMENT_INTERVIEW_MODES.investigatorResolution;
  }
  return undefined;
}

export const ASSESSMENT_INTERVIEW_QUESTION_INTENTS = {
  ask: "ASK",
  clarify: "CLARIFY",
} as const;

export type AssessmentInterviewQuestionIntent =
  (typeof ASSESSMENT_INTERVIEW_QUESTION_INTENTS)[keyof typeof ASSESSMENT_INTERVIEW_QUESTION_INTENTS];

export type QuestionIntent = AssessmentInterviewQuestionIntent;

export const ASSESSMENT_INTERVIEW_CONTROLS = {
  freeText: "FREE_TEXT",
  boolean: "BOOLEAN",
  singleSelect: "SINGLE_SELECT",
  multiSelect: "MULTI_SELECT",
  confirmAdjust: "CONFIRM_ADJUST",
} as const;

export type AssessmentInterviewControl =
  (typeof ASSESSMENT_INTERVIEW_CONTROLS)[keyof typeof ASSESSMENT_INTERVIEW_CONTROLS];

export type QuestionResponseMode = AssessmentInterviewControl;

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

export const INTERVIEW_REASONING_TECHNICAL_COVERAGE_STATES = {
  ready: ASSESSMENT_TECHNICAL_COVERAGE_STATES.ready,
  partial: ASSESSMENT_TECHNICAL_COVERAGE_STATES.partial,
} as const;

export type TechnicalCoverageState =
  (typeof INTERVIEW_REASONING_TECHNICAL_COVERAGE_STATES)[keyof typeof INTERVIEW_REASONING_TECHNICAL_COVERAGE_STATES];

export const BUSINESS_CONTEXT_SOURCES = {
  customerStated: "CUSTOMER_STATED",
  customerConfirmed: "CUSTOMER_CONFIRMED",
} as const;

export type BusinessContextSource =
  (typeof BUSINESS_CONTEXT_SOURCES)[keyof typeof BUSINESS_CONTEXT_SOURCES];

export const BUSINESS_CONTEXT_RESOLUTION_STATES = {
  uncertain: "UNCERTAIN",
  conflicted: "CONFLICTED",
  confirmed: "CONFIRMED",
  superseded: "SUPERSEDED",
} as const;

export type BusinessContextResolutionState =
  (typeof BUSINESS_CONTEXT_RESOLUTION_STATES)[keyof typeof BUSINESS_CONTEXT_RESOLUTION_STATES];

export const ASSESSMENT_CONTEXT_AUTHORITY_STATUSES = {
  customerStated: BUSINESS_CONTEXT_SOURCES.customerStated,
  uncertain: BUSINESS_CONTEXT_RESOLUTION_STATES.uncertain,
  conflicted: BUSINESS_CONTEXT_RESOLUTION_STATES.conflicted,
  customerConfirmed: BUSINESS_CONTEXT_SOURCES.customerConfirmed,
  confirmed: BUSINESS_CONTEXT_RESOLUTION_STATES.confirmed,
  superseded: BUSINESS_CONTEXT_RESOLUTION_STATES.superseded,
} as const;

export type AssessmentContextAuthorityStatus =
  (typeof ASSESSMENT_CONTEXT_AUTHORITY_STATUSES)[keyof typeof ASSESSMENT_CONTEXT_AUTHORITY_STATUSES];

export const EVIDENCE_SOURCE_TYPES = {
  technicalEvidence: "TECHNICAL_EVIDENCE",
  documentaryEvidence: "DOCUMENTARY_EVIDENCE",
} as const;

export type EvidenceSourceType =
  (typeof EVIDENCE_SOURCE_TYPES)[keyof typeof EVIDENCE_SOURCE_TYPES];

export const EVIDENCE_RESOLUTION_STATES = {
  observed: "OBSERVED",
  corroborated: "CORROBORATED",
  inferred: "INFERRED",
  unresolved: "UNRESOLVED",
  stale: "STALE",
} as const;

export type EvidenceResolutionState =
  (typeof EVIDENCE_RESOLUTION_STATES)[keyof typeof EVIDENCE_RESOLUTION_STATES];

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

export type InterviewFlag = AssessmentInterviewFlag;

export const ASSESSMENT_INTERVIEW_ORCHESTRATOR_ACTIONS = {
  waitForCustomer: "WAIT_FOR_CUSTOMER",
  continueToEngineeringRule: "CONTINUE_TO_ENGINEERING_RULE",
  keepBusinessContextBlocked: "KEEP_BUSINESS_CONTEXT_BLOCKED",
  routeRuntimeRecovery: "ROUTE_RUNTIME_RECOVERY",
  resumeExactInvestigator: "RESUME_EXACT_INVESTIGATOR",
  selectiveRerunRescope: "SELECTIVE_RERUN_RESCOPE",
} as const;

export type AssessmentInterviewOrchestratorAction =
  (typeof ASSESSMENT_INTERVIEW_ORCHESTRATOR_ACTIONS)[keyof typeof ASSESSMENT_INTERVIEW_ORCHESTRATOR_ACTIONS];

export const ASSESSMENT_INTERVIEW_WORKFLOW_EVENTS = {
  interviewStarted: "INTERVIEW_STARTED",
  interviewWaitingForCustomer: "INTERVIEW_WAITING_FOR_CUSTOMER",
  interviewContextUpdated: "INTERVIEW_CONTEXT_UPDATED",
  interviewContextReady: "INTERVIEW_CONTEXT_READY",
  interviewContextResolved: "INTERVIEW_CONTEXT_RESOLVED",
  interviewBlockedOrUnresolved: "INTERVIEW_BLOCKED_OR_UNRESOLVED",
  interviewFailed: "INTERVIEW_FAILED",
  downstreamReevaluationStarted: "DOWNSTREAM_REEVALUATION_STARTED",
  investigationResumed: "INVESTIGATION_RESUMED",
} as const;

export type AssessmentInterviewWorkflowEvent =
  (typeof ASSESSMENT_INTERVIEW_WORKFLOW_EVENTS)[keyof typeof ASSESSMENT_INTERVIEW_WORKFLOW_EVENTS];

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
  PersistedCustomerQuestionFrontier | AssessmentInterviewFrontierCandidate;

export type ScopeExtension = {
  namespace: string;
  key: string;
  values: NonEmptyArray<string>;
};

export type BusinessContextScope = {
  systemRefs: NonEmptyArray<string>;
  componentRefs?: string[];
  workflowRefs?: string[];
  actorGroupRefs?: string[];
  environmentRefs?: string[];
  operatingRegionRefs?: string[];
  extensions?: ScopeExtension[];
};

export type BusinessContextStatementBase = {
  statementId: string;
  assessmentId: string;
  topic: string;
  statement: string;
  normalizedValue?: JsonValue;
  scope: BusinessContextScope;
  evidenceRefs: string[];
  respondentRef: string;
  createdAt: string;
  supersedesStatementId?: string;
};

export type CustomerStatedContextStatement = BusinessContextStatementBase & {
  source: typeof BUSINESS_CONTEXT_SOURCES.customerStated;
  resolutionState:
    | typeof BUSINESS_CONTEXT_RESOLUTION_STATES.uncertain
    | typeof BUSINESS_CONTEXT_RESOLUTION_STATES.conflicted
    | typeof BUSINESS_CONTEXT_RESOLUTION_STATES.superseded;
};

export type CustomerConfirmedContextStatement = BusinessContextStatementBase & {
  source: typeof BUSINESS_CONTEXT_SOURCES.customerConfirmed;
  resolutionState:
    | typeof BUSINESS_CONTEXT_RESOLUTION_STATES.confirmed
    | typeof BUSINESS_CONTEXT_RESOLUTION_STATES.conflicted
    | typeof BUSINESS_CONTEXT_RESOLUTION_STATES.superseded;
};

export type BusinessContextStatement =
  CustomerStatedContextStatement | CustomerConfirmedContextStatement;

export type ConfirmedBusinessContextStatement =
  CustomerConfirmedContextStatement & {
    resolutionState: typeof BUSINESS_CONTEXT_RESOLUTION_STATES.confirmed;
  };

export type BusinessContextUpdateBase = {
  topic: string;
  statement: string;
  normalizedValue?: JsonValue;
  scope: BusinessContextScope;
  evidenceRefs: string[];
  supersedesStatementId?: string;
};

export type CustomerStatedContextUpdate = BusinessContextUpdateBase & {
  source: typeof BUSINESS_CONTEXT_SOURCES.customerStated;
  resolutionState:
    | typeof BUSINESS_CONTEXT_RESOLUTION_STATES.uncertain
    | typeof BUSINESS_CONTEXT_RESOLUTION_STATES.conflicted
    | typeof BUSINESS_CONTEXT_RESOLUTION_STATES.superseded;
};

export type CustomerConfirmedContextUpdate = BusinessContextUpdateBase & {
  source: typeof BUSINESS_CONTEXT_SOURCES.customerConfirmed;
  resolutionState:
    | typeof BUSINESS_CONTEXT_RESOLUTION_STATES.confirmed
    | typeof BUSINESS_CONTEXT_RESOLUTION_STATES.conflicted
    | typeof BUSINESS_CONTEXT_RESOLUTION_STATES.superseded;
};

export type BusinessContextUpdate =
  CustomerStatedContextUpdate | CustomerConfirmedContextUpdate;

export type GovernedEvidenceItem = {
  evidenceRef: string;
  sourceType: EvidenceSourceType;
  resolutionState: EvidenceResolutionState;
  observation: string;
  sourceVersionRef: string;
  scope: BusinessContextScope;
  customerSafeSummary?: string;
};

export type SafeEvidenceContext = {
  items: GovernedEvidenceItem[];
};

export type ChoiceOption = {
  value: string;
  label: string;
};

export type ProposedInterpretation = {
  topic: string;
  statement: string;
  normalizedValue?: JsonValue;
  scope: BusinessContextScope;
  evidenceRefs: string[];
};

export type QuestionBase = {
  intent: QuestionIntent;
  text: string;
  reasonSummary: string;
  evidenceRefs: string[];
};

export type FreeTextQuestion = QuestionBase & {
  responseMode: typeof ASSESSMENT_INTERVIEW_CONTROLS.freeText;
};

export type SingleSelectQuestion = QuestionBase & {
  responseMode: typeof ASSESSMENT_INTERVIEW_CONTROLS.singleSelect;
  choices: NonEmptyArray<ChoiceOption>;
};

export type MultiSelectQuestion = QuestionBase & {
  responseMode: typeof ASSESSMENT_INTERVIEW_CONTROLS.multiSelect;
  choices: NonEmptyArray<ChoiceOption>;
};

export type BooleanQuestion = QuestionBase & {
  responseMode: typeof ASSESSMENT_INTERVIEW_CONTROLS.boolean;
};

export type ConfirmAdjustQuestion = QuestionBase & {
  intent: typeof ASSESSMENT_INTERVIEW_QUESTION_INTENTS.clarify;
  responseMode: typeof ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust;
  proposedInterpretation: NonEmptyArray<ProposedInterpretation>;
  choices: [
    {
      value: typeof ASSESSMENT_INTERVIEW_ANSWER_ACTIONS.confirm;
      label: string;
    },
    { value: typeof ASSESSMENT_INTERVIEW_ANSWER_ACTIONS.adjust; label: string },
  ];
};

export type InterviewQuestionDraft =
  | FreeTextQuestion
  | SingleSelectQuestion
  | MultiSelectQuestion
  | BooleanQuestion
  | ConfirmAdjustQuestion;

export type InterviewQuestion = InterviewQuestionDraft & {
  questionRef: string;
  sessionId: string;
  sequence: number;
  createdAt: string;
};

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
  proposedInterpretation?: string;
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
  normalizedValue?: JsonValue;
  scope: BusinessContextScope;
  respondentRef: string;
  createdAt: string;
  source: typeof BUSINESS_CONTEXT_SOURCES.customerConfirmed;
  resolutionState: typeof BUSINESS_CONTEXT_RESOLUTION_STATES.confirmed;
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
  questionPrompt?: string;
  question?: AssessmentInterviewQuestion;
  /** Returned only for the authenticated respondent's own answer. */
  selectedChoiceIds?: string[];
  answeredAt: string;
  /** Sanitized supplementary text, returned only to the authenticated respondent. */
  comment?: string;
  /** Internal history stores actorId; Customer projections omit it. */
  actorId?: string;
  summary: string;
};

export type AssessmentInterviewRuntimeState = {
  outcome: AssessmentInterviewOutcome;
  activeQuestion?: AssessmentInterviewQuestion;
  /** Customer-safe assistant output for terminal Interview turns. */
  assistantMessage?: string;
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

export type PartialCoveragePolicyDecision = {
  policyDecisionRef: string;
  policyVersion: string;
  permittedForInterview: boolean;
  limitations: string[];
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
  comment?: string;
  confirmed?: boolean;
  adjusted?: boolean;
};

export type CustomerFreeTextAnswer = {
  kind: typeof ASSESSMENT_INTERVIEW_CONTROLS.freeText;
  text: string;
};

export type CustomerSingleSelectAnswer = {
  kind: typeof ASSESSMENT_INTERVIEW_CONTROLS.singleSelect;
  value: string;
  comment?: string;
};

export type CustomerMultiSelectAnswer = {
  kind: typeof ASSESSMENT_INTERVIEW_CONTROLS.multiSelect;
  values: NonEmptyArray<string>;
  comment?: string;
};

export type CustomerBooleanAnswer = {
  kind: typeof ASSESSMENT_INTERVIEW_CONTROLS.boolean;
  value: boolean;
  comment?: string;
};

export type CustomerConfirmAnswer = {
  kind: typeof ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust;
  action: typeof ASSESSMENT_INTERVIEW_ANSWER_ACTIONS.confirm;
  comment?: string;
};

export type CustomerAdjustAnswer = {
  kind: typeof ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust;
  action: typeof ASSESSMENT_INTERVIEW_ANSWER_ACTIONS.adjust;
  adjustmentText: string;
};

export type CustomerAnswer =
  | CustomerFreeTextAnswer
  | CustomerSingleSelectAnswer
  | CustomerMultiSelectAnswer
  | CustomerBooleanAnswer
  | CustomerConfirmAnswer
  | CustomerAdjustAnswer;

export type SubmitInterviewAnswerCommand = {
  contractVersion: InterviewContractVersion;
  assessmentId: string;
  sessionId: string;
  questionRef: string;
  expectedSessionRevision: number;
  clientRequestId: string;
  answer: CustomerAnswer;
};

export type InvestigatorNeed = {
  businessContextNeed: string;
  resolutionCriteria: string;
  whyNeeded?: string;
  relatedEvidenceRefs?: string[];
  originatingInvestigationReference: string;
};

export type InterviewTurnSnapshot = {
  turnRef: string;
  sequence: number;
  question: InterviewQuestion;
  answer?: CustomerAnswer;
  respondentRef?: string;
  contextStatementRefs: string[];
  unresolvedTopics: string[];
};

export type IncomingCustomerTurn = {
  questionRef: string;
  answer: CustomerAnswer;
  respondentRef: string;
};

export type SubjectSystemIdentity = {
  systemRef: string;
  displayName: string;
  workspaceRef: string;
  projectRef?: string;
};

export type ArtifactVersions = {
  sourceVersionRef: string;
  scannerRunRef: string;
  programEvidenceGraphVersion: string;
};

export type CoverageLimitation = {
  code: string;
  summary: string;
  affectedScopeRefs?: string[];
};

export type ReadyTechnicalCoverage = {
  state: typeof INTERVIEW_REASONING_TECHNICAL_COVERAGE_STATES.ready;
  limitations: [];
  policyDecisionRef: string;
};

export type PartialTechnicalCoverage = {
  state: typeof INTERVIEW_REASONING_TECHNICAL_COVERAGE_STATES.partial;
  limitations: NonEmptyArray<CoverageLimitation>;
  policyDecisionRef: string;
};

export type TechnicalCoverage =
  ReadyTechnicalCoverage | PartialTechnicalCoverage;

export type LocaleTag = string;

export const INTERVIEW_HOST_PLATFORMS = {
  lcsp: "LCSP",
} as const;

export type InterviewHostPlatform =
  (typeof INTERVIEW_HOST_PLATFORMS)[keyof typeof INTERVIEW_HOST_PLATFORMS];

export type InterviewAgentInputCommon = {
  contractVersion: InterviewContractVersion;
  hostPlatform: InterviewHostPlatform;
  assessmentId: string;
  sessionId: string;
  sessionRevision: number;
  subjectSystemIdentity: SubjectSystemIdentity;
  guidanceVersion: string;
  locale: LocaleTag;
  artifactVersions: ArtifactVersions;
  technicalCoverage: TechnicalCoverage;
  currentConfirmedBusinessContext: ConfirmedBusinessContextStatement[];
  safeEvidenceContext: SafeEvidenceContext;
  interviewHistory: InterviewTurnSnapshot[];
  incomingCustomerTurn?: IncomingCustomerTurn;
  workingStrategy?: InterviewWorkingStrategy;
};

export type InitialInterviewAgentInput = InterviewAgentInputCommon & {
  mode: typeof ASSESSMENT_INTERVIEW_MODES.initialInterview;
  investigatorNeed?: never;
};

export type InvestigatorResolutionAgentInput = InterviewAgentInputCommon & {
  mode: typeof ASSESSMENT_INTERVIEW_MODES.investigatorResolution;
  investigatorNeed: InvestigatorNeed;
};

export type InterviewAgentInput =
  InitialInterviewAgentInput | InvestigatorResolutionAgentInput;

export type UnresolvedBusinessContext = {
  topic: string;
  reason: string;
  scope?: BusinessContextScope;
};

export type InterviewLimitation = {
  code: string;
  summary: string;
};

export type WaitingForCustomerResult = {
  outcome: typeof ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer;
  question: InterviewQuestionDraft;
  contextUpdates: BusinessContextUpdate[];
  unresolved: UnresolvedBusinessContext[];
  flags: InterviewFlag[];
  limitations: InterviewLimitation[];
};

export type ContextReadyResult = {
  outcome: typeof ASSESSMENT_INTERVIEW_OUTCOMES.contextReady;
  question?: never;
  contextUpdates: BusinessContextUpdate[];
  unresolved: [];
  flags: InterviewFlag[];
  limitations: InterviewLimitation[];
};

export type ContextResolvedResult = {
  outcome: typeof ASSESSMENT_INTERVIEW_OUTCOMES.contextResolved;
  question?: never;
  contextUpdates: BusinessContextUpdate[];
  unresolved: [];
  flags: InterviewFlag[];
  limitations: InterviewLimitation[];
};

export type BlockedOrUnresolvedResult = {
  outcome: typeof ASSESSMENT_INTERVIEW_OUTCOMES.blockedOrUnresolved;
  question?: never;
  contextUpdates: BusinessContextUpdate[];
  unresolved: NonEmptyArray<UnresolvedBusinessContext>;
  flags: InterviewFlag[];
  limitations: InterviewLimitation[];
};

export type FailedResult = {
  outcome: typeof ASSESSMENT_INTERVIEW_OUTCOMES.failed;
  question?: never;
  contextUpdates: [];
  unresolved: [];
  flags: [];
  limitations: NonEmptyArray<InterviewLimitation>;
};

export type InterviewAgentResult =
  | WaitingForCustomerResult
  | ContextReadyResult
  | ContextResolvedResult
  | BlockedOrUnresolvedResult
  | FailedResult;

export type InterviewRuntimeResult = {
  contractVersion: InterviewContractVersion;
  assessmentId: string;
  sessionId: string;
  invocationRef: string;
  mode: InterviewMode;
  guidanceVersion: string;
  modelId?: string;
  artifactVersions: ArtifactVersions;
  contextRevisionBefore: string;
  contextRevisionAfter?: string;
  sessionRevisionBefore: number;
  sessionRevisionAfter: number;
  persistedQuestionRef?: string;
  generatedAt: string;
  agentResult: InterviewAgentResult;
};

export type ContextRevision = {
  contextRevisionRef: string;
  assessmentId: string;
  parentRevisionRef?: string;
  confirmedStatementRefs: string[];
  createdAt: string;
  createdByActorRef: string;
};

export type AssessmentInterviewBlockedInput = {
  action: AssessmentInterviewBlockedAction;
  draft?: string;
};

type StringLiteralRecord = Record<string, string>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function hasRequiredKeys(
  value: Record<string, unknown>,
  requiredKeys: readonly string[],
): boolean {
  return requiredKeys.every((key) => key in value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): boolean {
  return (
    hasRequiredKeys(value, requiredKeys) &&
    hasOnlyKeys(value, [...requiredKeys, ...optionalKeys])
  );
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

function isNonEmptyStringArray(value: unknown): value is NonEmptyArray<string> {
  return isStringArray(value) && value.length > 0;
}

function isKnownValue<TValues extends StringLiteralRecord>(
  values: TValues,
  value: unknown,
): value is TValues[keyof TValues] {
  return isString(value) && Object.values(values).includes(value);
}

export function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    isString(value) ||
    isNumber(value) ||
    isBoolean(value)
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (!isRecord(value)) {
    return false;
  }
  return Object.values(value).every(isJsonValue);
}

function isOptionalJsonValue(value: Record<string, unknown>, key: string) {
  return !(key in value) || isJsonValue(value[key]);
}

function isOptionalString(value: Record<string, unknown>, key: string) {
  return !(key in value) || isString(value[key]);
}

function isOptionalStringArray(value: Record<string, unknown>, key: string) {
  return !(key in value) || isStringArray(value[key]);
}

export function isBusinessContextScope(
  value: unknown,
): value is BusinessContextScope {
  if (!isRecord(value)) {
    return false;
  }
  if (
    !hasExactKeys(
      value,
      ["systemRefs"],
      [
        "componentRefs",
        "workflowRefs",
        "actorGroupRefs",
        "environmentRefs",
        "operatingRegionRefs",
        "extensions",
      ],
    ) ||
    !isNonEmptyStringArray(value.systemRefs) ||
    !isOptionalStringArray(value, "componentRefs") ||
    !isOptionalStringArray(value, "workflowRefs") ||
    !isOptionalStringArray(value, "actorGroupRefs") ||
    !isOptionalStringArray(value, "environmentRefs") ||
    !isOptionalStringArray(value, "operatingRegionRefs")
  ) {
    return false;
  }
  if (!("extensions" in value)) {
    return true;
  }
  return (
    Array.isArray(value.extensions) &&
    value.extensions.every((extension) => {
      if (!isRecord(extension)) {
        return false;
      }
      return (
        hasExactKeys(extension, ["namespace", "key", "values"]) &&
        isString(extension.namespace) &&
        isString(extension.key) &&
        isNonEmptyStringArray(extension.values)
      );
    })
  );
}

function hasValidBusinessContextPair(
  source: unknown,
  resolutionState: unknown,
): boolean {
  if (source === BUSINESS_CONTEXT_SOURCES.customerStated) {
    return (
      resolutionState === BUSINESS_CONTEXT_RESOLUTION_STATES.uncertain ||
      resolutionState === BUSINESS_CONTEXT_RESOLUTION_STATES.conflicted ||
      resolutionState === BUSINESS_CONTEXT_RESOLUTION_STATES.superseded
    );
  }
  if (source === BUSINESS_CONTEXT_SOURCES.customerConfirmed) {
    return (
      resolutionState === BUSINESS_CONTEXT_RESOLUTION_STATES.confirmed ||
      resolutionState === BUSINESS_CONTEXT_RESOLUTION_STATES.conflicted ||
      resolutionState === BUSINESS_CONTEXT_RESOLUTION_STATES.superseded
    );
  }
  return false;
}

export function isBusinessContextStatement(
  value: unknown,
): value is BusinessContextStatement {
  if (!isRecord(value)) {
    return false;
  }
  return (
    hasExactKeys(
      value,
      [
        "statementId",
        "assessmentId",
        "topic",
        "statement",
        "scope",
        "evidenceRefs",
        "respondentRef",
        "createdAt",
        "source",
        "resolutionState",
      ],
      ["normalizedValue", "supersedesStatementId"],
    ) &&
    isString(value.statementId) &&
    isString(value.assessmentId) &&
    isString(value.topic) &&
    isString(value.statement) &&
    isBusinessContextScope(value.scope) &&
    isStringArray(value.evidenceRefs) &&
    isString(value.respondentRef) &&
    isString(value.createdAt) &&
    isOptionalJsonValue(value, "normalizedValue") &&
    isOptionalString(value, "supersedesStatementId") &&
    hasValidBusinessContextPair(value.source, value.resolutionState)
  );
}

export function isConfirmedBusinessContextStatement(
  value: unknown,
): value is ConfirmedBusinessContextStatement {
  return (
    isBusinessContextStatement(value) &&
    value.source === BUSINESS_CONTEXT_SOURCES.customerConfirmed &&
    value.resolutionState === BUSINESS_CONTEXT_RESOLUTION_STATES.confirmed
  );
}

export function isBusinessContextUpdate(
  value: unknown,
): value is BusinessContextUpdate {
  if (!isRecord(value)) {
    return false;
  }
  return (
    hasExactKeys(
      value,
      [
        "topic",
        "statement",
        "scope",
        "evidenceRefs",
        "source",
        "resolutionState",
      ],
      ["normalizedValue", "supersedesStatementId"],
    ) &&
    isString(value.topic) &&
    isString(value.statement) &&
    isBusinessContextScope(value.scope) &&
    isStringArray(value.evidenceRefs) &&
    isOptionalJsonValue(value, "normalizedValue") &&
    isOptionalString(value, "supersedesStatementId") &&
    hasValidBusinessContextPair(value.source, value.resolutionState)
  );
}

export function isGovernedEvidenceItem(
  value: unknown,
): value is GovernedEvidenceItem {
  if (!isRecord(value)) {
    return false;
  }
  return (
    hasExactKeys(
      value,
      [
        "evidenceRef",
        "sourceType",
        "resolutionState",
        "observation",
        "sourceVersionRef",
        "scope",
      ],
      ["customerSafeSummary"],
    ) &&
    isString(value.evidenceRef) &&
    isKnownValue(EVIDENCE_SOURCE_TYPES, value.sourceType) &&
    isKnownValue(EVIDENCE_RESOLUTION_STATES, value.resolutionState) &&
    isString(value.observation) &&
    isString(value.sourceVersionRef) &&
    isBusinessContextScope(value.scope) &&
    isOptionalString(value, "customerSafeSummary")
  );
}

export function isSafeEvidenceContext(
  value: unknown,
): value is SafeEvidenceContext {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["items"]) &&
    Array.isArray(value.items) &&
    value.items.every(isGovernedEvidenceItem)
  );
}

function isChoiceOption(value: unknown): value is ChoiceOption {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["value", "label"]) &&
    isString(value.value) &&
    isString(value.label)
  );
}

function hasUniqueChoiceValues(choices: NonEmptyArray<ChoiceOption>): boolean {
  return new Set(choices.map((choice) => choice.value)).size === choices.length;
}

function isProposedInterpretation(
  value: unknown,
): value is ProposedInterpretation {
  if (!isRecord(value)) {
    return false;
  }
  return (
    hasExactKeys(
      value,
      ["topic", "statement", "scope", "evidenceRefs"],
      ["normalizedValue"],
    ) &&
    isString(value.topic) &&
    isString(value.statement) &&
    isBusinessContextScope(value.scope) &&
    isStringArray(value.evidenceRefs) &&
    isOptionalJsonValue(value, "normalizedValue")
  );
}

export function isInterviewQuestionDraft(
  value: unknown,
): value is InterviewQuestionDraft {
  if (!isRecord(value)) {
    return false;
  }
  const baseValid =
    isKnownValue(ASSESSMENT_INTERVIEW_QUESTION_INTENTS, value.intent) &&
    isString(value.text) &&
    isString(value.reasonSummary) &&
    isStringArray(value.evidenceRefs);
  if (!baseValid) {
    return false;
  }
  if (value.responseMode === ASSESSMENT_INTERVIEW_CONTROLS.freeText) {
    return hasExactKeys(value, [
      "intent",
      "text",
      "reasonSummary",
      "evidenceRefs",
      "responseMode",
    ]);
  }
  if (value.responseMode === ASSESSMENT_INTERVIEW_CONTROLS.boolean) {
    return hasExactKeys(value, [
      "intent",
      "text",
      "reasonSummary",
      "evidenceRefs",
      "responseMode",
    ]);
  }
  if (
    value.responseMode === ASSESSMENT_INTERVIEW_CONTROLS.singleSelect ||
    value.responseMode === ASSESSMENT_INTERVIEW_CONTROLS.multiSelect
  ) {
    if (
      !hasExactKeys(value, [
        "intent",
        "text",
        "reasonSummary",
        "evidenceRefs",
        "responseMode",
        "choices",
      ]) ||
      !Array.isArray(value.choices) ||
      value.choices.length === 0 ||
      !value.choices.every(isChoiceOption)
    ) {
      return false;
    }
    return hasUniqueChoiceValues(value.choices as NonEmptyArray<ChoiceOption>);
  }
  if (value.responseMode !== ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust) {
    return false;
  }
  return (
    hasExactKeys(value, [
      "intent",
      "text",
      "reasonSummary",
      "evidenceRefs",
      "responseMode",
      "proposedInterpretation",
      "choices",
    ]) &&
    value.intent === ASSESSMENT_INTERVIEW_QUESTION_INTENTS.clarify &&
    Array.isArray(value.proposedInterpretation) &&
    value.proposedInterpretation.length > 0 &&
    value.proposedInterpretation.every(isProposedInterpretation) &&
    Array.isArray(value.choices) &&
    value.choices.length === 2 &&
    isChoiceOption(value.choices[0]) &&
    isChoiceOption(value.choices[1]) &&
    value.choices[0].value === ASSESSMENT_INTERVIEW_ANSWER_ACTIONS.confirm &&
    value.choices[1].value === ASSESSMENT_INTERVIEW_ANSWER_ACTIONS.adjust
  );
}

export function isInterviewQuestion(
  value: unknown,
): value is InterviewQuestion {
  if (!isRecord(value)) {
    return false;
  }
  const { questionRef, sessionId, sequence, createdAt, ...draft } = value;
  return (
    isString(questionRef) &&
    isString(sessionId) &&
    isNumber(sequence) &&
    isString(createdAt) &&
    isInterviewQuestionDraft(draft)
  );
}

export function isCustomerAnswer(value: unknown): value is CustomerAnswer {
  if (!isRecord(value)) {
    return false;
  }
  if (value.kind === ASSESSMENT_INTERVIEW_CONTROLS.freeText) {
    return (
      hasExactKeys(value, ["kind", "text"]) &&
      isString(value.text) &&
      value.text.trim().length > 0
    );
  }
  if (value.kind === ASSESSMENT_INTERVIEW_CONTROLS.singleSelect) {
    return (
      hasExactKeys(value, ["kind", "value"], ["comment"]) &&
      isString(value.value) &&
      isOptionalString(value, "comment")
    );
  }
  if (value.kind === ASSESSMENT_INTERVIEW_CONTROLS.multiSelect) {
    return (
      hasExactKeys(value, ["kind", "values"], ["comment"]) &&
      isNonEmptyStringArray(value.values) &&
      isOptionalString(value, "comment") &&
      new Set(value.values).size === value.values.length
    );
  }
  if (value.kind === ASSESSMENT_INTERVIEW_CONTROLS.boolean) {
    return (
      hasExactKeys(value, ["kind", "value"], ["comment"]) &&
      isBoolean(value.value) &&
      isOptionalString(value, "comment")
    );
  }
  if (value.kind !== ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust) {
    return false;
  }
  if (value.action === ASSESSMENT_INTERVIEW_ANSWER_ACTIONS.confirm) {
    return (
      hasExactKeys(value, ["kind", "action"], ["comment"]) &&
      isOptionalString(value, "comment")
    );
  }
  return (
    value.action === ASSESSMENT_INTERVIEW_ANSWER_ACTIONS.adjust &&
    hasExactKeys(value, ["kind", "action", "adjustmentText"]) &&
    isString(value.adjustmentText) &&
    value.adjustmentText.trim().length > 0
  );
}

function isInvestigatorNeed(value: unknown): value is InvestigatorNeed {
  if (!isRecord(value)) {
    return false;
  }
  return (
    hasExactKeys(
      value,
      [
        "businessContextNeed",
        "resolutionCriteria",
        "originatingInvestigationReference",
      ],
      ["whyNeeded", "relatedEvidenceRefs"],
    ) &&
    isString(value.businessContextNeed) &&
    isString(value.resolutionCriteria) &&
    isString(value.originatingInvestigationReference) &&
    isOptionalString(value, "whyNeeded") &&
    isOptionalStringArray(value, "relatedEvidenceRefs")
  );
}

function isInterviewTurnSnapshot(
  value: unknown,
): value is InterviewTurnSnapshot {
  if (!isRecord(value)) {
    return false;
  }
  return (
    hasExactKeys(
      value,
      [
        "turnRef",
        "sequence",
        "question",
        "contextStatementRefs",
        "unresolvedTopics",
      ],
      ["answer", "respondentRef"],
    ) &&
    isString(value.turnRef) &&
    isNumber(value.sequence) &&
    isInterviewQuestion(value.question) &&
    isStringArray(value.contextStatementRefs) &&
    isStringArray(value.unresolvedTopics) &&
    (!("answer" in value) || isCustomerAnswer(value.answer)) &&
    isOptionalString(value, "respondentRef")
  );
}

function isIncomingCustomerTurn(value: unknown): value is IncomingCustomerTurn {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["questionRef", "answer", "respondentRef"]) &&
    isString(value.questionRef) &&
    isCustomerAnswer(value.answer) &&
    isString(value.respondentRef)
  );
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every(isString);
}

function isInterviewWorkingStrategy(
  value: unknown,
): value is InterviewWorkingStrategy {
  if (!isRecord(value)) {
    return false;
  }
  return (
    hasExactKeys(value, [
      "terminologyMap",
      "avoidReaskingTopics",
      "effectiveQuestionPatterns",
      "observedAmbiguities",
      "interactionNotes",
    ]) &&
    isStringRecord(value.terminologyMap) &&
    isStringArray(value.avoidReaskingTopics) &&
    isStringArray(value.effectiveQuestionPatterns) &&
    isStringArray(value.observedAmbiguities) &&
    isStringArray(value.interactionNotes)
  );
}

function isSubjectSystemIdentity(
  value: unknown,
): value is SubjectSystemIdentity {
  return (
    isRecord(value) &&
    hasExactKeys(
      value,
      ["systemRef", "displayName", "workspaceRef"],
      ["projectRef"],
    ) &&
    isString(value.systemRef) &&
    isString(value.displayName) &&
    isString(value.workspaceRef) &&
    isOptionalString(value, "projectRef")
  );
}

function isArtifactVersions(value: unknown): value is ArtifactVersions {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "sourceVersionRef",
      "scannerRunRef",
      "programEvidenceGraphVersion",
    ]) &&
    isString(value.sourceVersionRef) &&
    isString(value.scannerRunRef) &&
    isString(value.programEvidenceGraphVersion)
  );
}

function isTechnicalCoverage(value: unknown): value is TechnicalCoverage {
  if (!isRecord(value)) {
    return false;
  }
  if (value.state === INTERVIEW_REASONING_TECHNICAL_COVERAGE_STATES.ready) {
    return (
      hasExactKeys(value, ["state", "limitations", "policyDecisionRef"]) &&
      Array.isArray(value.limitations) &&
      value.limitations.length === 0 &&
      isString(value.policyDecisionRef)
    );
  }
  if (value.state !== INTERVIEW_REASONING_TECHNICAL_COVERAGE_STATES.partial) {
    return false;
  }
  return (
    hasExactKeys(value, ["state", "limitations", "policyDecisionRef"]) &&
    Array.isArray(value.limitations) &&
    value.limitations.length > 0 &&
    value.limitations.every((limitation) => {
      if (!isRecord(limitation)) {
        return false;
      }
      return (
        hasExactKeys(limitation, ["code", "summary"], ["affectedScopeRefs"]) &&
        isString(limitation.code) &&
        isString(limitation.summary) &&
        isOptionalStringArray(limitation, "affectedScopeRefs")
      );
    }) &&
    isString(value.policyDecisionRef)
  );
}

export function isConfirmedStructuredBusinessContext(
  value: unknown,
): value is ConfirmedStructuredBusinessContext {
  return (
    isRecord(value) &&
    hasExactKeys(
      value,
      ["assessmentId", "contextRevision", "authority", "statements"],
      ["createdByActorRef"],
    ) &&
    isString(value.assessmentId) &&
    isNumber(value.contextRevision) &&
    value.authority ===
      CONFIRMED_STRUCTURED_BUSINESS_CONTEXT_AUTHORITIES.customerConfirmedConfirmedOnly &&
    Array.isArray(value.statements) &&
    value.statements.every(isConfirmedBusinessContextStatement) &&
    isOptionalString(value, "createdByActorRef")
  );
}

export function isInterviewAgentInput(
  value: unknown,
): value is InterviewAgentInput {
  if (!isRecord(value)) {
    return false;
  }
  const commonRequiredKeys = [
    "contractVersion",
    "hostPlatform",
    "assessmentId",
    "sessionId",
    "sessionRevision",
    "subjectSystemIdentity",
    "guidanceVersion",
    "locale",
    "artifactVersions",
    "technicalCoverage",
    "currentConfirmedBusinessContext",
    "safeEvidenceContext",
    "interviewHistory",
    "mode",
  ];
  const commonOptionalKeys = ["incomingCustomerTurn", "workingStrategy"];
  const modeOptionalKeys =
    value.mode === ASSESSMENT_INTERVIEW_MODES.investigatorResolution
      ? ["investigatorNeed"]
      : [];
  if (
    !hasExactKeys(value, commonRequiredKeys, [
      ...commonOptionalKeys,
      ...modeOptionalKeys,
    ])
  ) {
    return false;
  }
  const commonValid =
    value.contractVersion === INTERVIEW_TECHNICAL_CONTRACT_VERSION &&
    value.hostPlatform === INTERVIEW_HOST_PLATFORMS.lcsp &&
    isString(value.assessmentId) &&
    isString(value.sessionId) &&
    isNumber(value.sessionRevision) &&
    isSubjectSystemIdentity(value.subjectSystemIdentity) &&
    isString(value.guidanceVersion) &&
    isString(value.locale) &&
    isArtifactVersions(value.artifactVersions) &&
    isTechnicalCoverage(value.technicalCoverage) &&
    Array.isArray(value.currentConfirmedBusinessContext) &&
    value.currentConfirmedBusinessContext.every(
      isConfirmedBusinessContextStatement,
    ) &&
    isSafeEvidenceContext(value.safeEvidenceContext) &&
    Array.isArray(value.interviewHistory) &&
    value.interviewHistory.every(isInterviewTurnSnapshot) &&
    (!("incomingCustomerTurn" in value) ||
      isIncomingCustomerTurn(value.incomingCustomerTurn)) &&
    (!("workingStrategy" in value) ||
      isInterviewWorkingStrategy(value.workingStrategy));
  if (!commonValid) {
    return false;
  }
  if (value.mode === ASSESSMENT_INTERVIEW_MODES.initialInterview) {
    return !("investigatorNeed" in value);
  }
  return (
    value.mode === ASSESSMENT_INTERVIEW_MODES.investigatorResolution &&
    isInvestigatorNeed(value.investigatorNeed)
  );
}

function isUnresolvedBusinessContext(
  value: unknown,
): value is UnresolvedBusinessContext {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["topic", "reason"], ["scope"]) &&
    isString(value.topic) &&
    isString(value.reason) &&
    (!("scope" in value) || isBusinessContextScope(value.scope))
  );
}

function isInterviewLimitation(value: unknown): value is InterviewLimitation {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["code", "summary"]) &&
    isString(value.code) &&
    isString(value.summary)
  );
}

function isInterviewFlagArray(value: unknown): value is InterviewFlag[] {
  return (
    Array.isArray(value) &&
    value.every((item) => item === ASSESSMENT_INTERVIEW_FLAGS.downstreamImpact)
  );
}

export function isInterviewAgentResult(
  value: unknown,
): value is InterviewAgentResult {
  if (
    !isRecord(value) ||
    !isKnownValue(ASSESSMENT_INTERVIEW_OUTCOMES, value.outcome)
  ) {
    return false;
  }
  const baseArraysValid =
    Array.isArray(value.contextUpdates) &&
    value.contextUpdates.every(isBusinessContextUpdate) &&
    Array.isArray(value.unresolved) &&
    value.unresolved.every(isUnresolvedBusinessContext) &&
    isInterviewFlagArray(value.flags) &&
    Array.isArray(value.limitations) &&
    value.limitations.every(isInterviewLimitation);
  if (!baseArraysValid) {
    return false;
  }
  const contextUpdates = value.contextUpdates as BusinessContextUpdate[];
  const unresolved = value.unresolved as UnresolvedBusinessContext[];
  const flags = value.flags as InterviewFlag[];
  const limitations = value.limitations as InterviewLimitation[];
  if (value.outcome === ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer) {
    return (
      hasExactKeys(value, [
        "outcome",
        "question",
        "contextUpdates",
        "unresolved",
        "flags",
        "limitations",
      ]) && isInterviewQuestionDraft(value.question)
    );
  }
  if (
    value.outcome === ASSESSMENT_INTERVIEW_OUTCOMES.contextReady ||
    value.outcome === ASSESSMENT_INTERVIEW_OUTCOMES.contextResolved
  ) {
    return (
      hasExactKeys(value, [
        "outcome",
        "contextUpdates",
        "unresolved",
        "flags",
        "limitations",
      ]) && unresolved.length === 0
    );
  }
  if (value.outcome === ASSESSMENT_INTERVIEW_OUTCOMES.blockedOrUnresolved) {
    return (
      hasExactKeys(value, [
        "outcome",
        "contextUpdates",
        "unresolved",
        "flags",
        "limitations",
      ]) && unresolved.length > 0
    );
  }
  return (
    hasExactKeys(value, [
      "outcome",
      "contextUpdates",
      "unresolved",
      "flags",
      "limitations",
    ]) &&
    contextUpdates.length === 0 &&
    unresolved.length === 0 &&
    flags.length === 0 &&
    limitations.length > 0
  );
}

export function isInterviewAgentResultForMode(
  value: unknown,
  mode: InterviewMode,
): value is InterviewAgentResult {
  if (!isInterviewAgentResult(value)) {
    return false;
  }
  if (mode === ASSESSMENT_INTERVIEW_MODES.initialInterview) {
    return value.outcome !== ASSESSMENT_INTERVIEW_OUTCOMES.contextResolved;
  }
  return value.outcome !== ASSESSMENT_INTERVIEW_OUTCOMES.contextReady;
}

export function isInterviewRuntimeResult(
  value: unknown,
): value is InterviewRuntimeResult {
  if (!isRecord(value)) {
    return false;
  }
  if (
    !hasExactKeys(
      value,
      [
        "contractVersion",
        "assessmentId",
        "sessionId",
        "invocationRef",
        "mode",
        "guidanceVersion",
        "artifactVersions",
        "contextRevisionBefore",
        "sessionRevisionBefore",
        "sessionRevisionAfter",
        "generatedAt",
        "agentResult",
      ],
      ["modelId", "contextRevisionAfter", "persistedQuestionRef"],
    ) ||
    value.contractVersion !== INTERVIEW_TECHNICAL_CONTRACT_VERSION ||
    !isString(value.assessmentId) ||
    !isString(value.sessionId) ||
    !isString(value.invocationRef) ||
    !isKnownValue(ASSESSMENT_INTERVIEW_MODES, value.mode) ||
    !isString(value.guidanceVersion) ||
    !isArtifactVersions(value.artifactVersions) ||
    !isString(value.contextRevisionBefore) ||
    !isNumber(value.sessionRevisionBefore) ||
    !isNumber(value.sessionRevisionAfter) ||
    value.sessionRevisionAfter <= value.sessionRevisionBefore ||
    !isString(value.generatedAt) ||
    isOptionalString(value, "modelId") === false ||
    isOptionalString(value, "contextRevisionAfter") === false ||
    isInterviewAgentResultForMode(value.agentResult, value.mode) === false
  ) {
    return false;
  }
  const waitsForCustomer =
    value.agentResult.outcome ===
    ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer;
  return waitsForCustomer
    ? isString(value.persistedQuestionRef)
    : !("persistedQuestionRef" in value);
}

export function isContextRevision(value: unknown): value is ContextRevision {
  return (
    isRecord(value) &&
    hasExactKeys(
      value,
      [
        "contextRevisionRef",
        "assessmentId",
        "confirmedStatementRefs",
        "createdAt",
        "createdByActorRef",
      ],
      ["parentRevisionRef"],
    ) &&
    isString(value.contextRevisionRef) &&
    isString(value.assessmentId) &&
    isStringArray(value.confirmedStatementRefs) &&
    isString(value.createdAt) &&
    isString(value.createdByActorRef) &&
    isOptionalString(value, "parentRevisionRef")
  );
}

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
