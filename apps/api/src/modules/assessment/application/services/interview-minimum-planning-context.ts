/**
 * Deterministic minimum planning context required before an initial Interview may
 * declare CONTEXT_READY.
 *
 * Keep the term sets and matcher in sync with deepagents
 * tools/common/capabilities/workflow/recovery/interview_boundary.py
 * ::_INITIAL_PLANNING_CONTEXT_DIMENSIONS. The worker mirror only saves a guarded POST;
 * this API check is authoritative.
 *
 * Terms match word tokens: a trailing "*" is a prefix match, spaces form a phrase.
 * An explicit "unknown" answer resolves a dimension as UNKNOWN; it never implies a
 * negative such as "no decision effect".
 */
export const INITIAL_PLANNING_CONTEXT_DIMENSIONS = {
  aiUsage: [
    "ai",
    "artificial intelligence",
    "model*",
    "llm*",
    "gpt*",
    "gemini",
    "openai",
    "claude",
    "copilot",
    "chatbot*",
    "machine learning",
    "algorithm*",
    "classifier*",
    "generative",
    "automated decision*",
  ],
  operationalProcess: [
    "process*",
    "workflow*",
    "operation*",
    "pipeline*",
    "assessment*",
    "onboarding",
    "support",
    "procedure*",
    "use case*",
  ],
  decisionInfluence: [
    "decision*",
    "decide*",
    "action*",
    "approv*",
    "reject*",
    "gate",
    "gates",
    "block*",
    "deploy*",
    "trigger*",
    "automatically",
    "autonomous*",
    "update*",
    "status",
    "external effect*",
    "recommend*",
    "advis*",
    "draft*",
    "suggest*",
    "influenc*",
  ],
  // Approval verbs alone ("AI never approves") say nothing about who oversees AI output.
  humanOversight: [
    "human*",
    "person",
    "persons",
    "people",
    "manual*",
    "review*",
    "oversight",
    "supervis*",
    "sign off",
    "approver*",
    "operator*",
    "staff",
    "analyst*",
    "officer*",
    "manager*",
    "recruiter*",
  ],
  affectedSubjects: [
    "user*",
    "customer*",
    "client*",
    "employee*",
    "applicant*",
    "candidate*",
    "patient*",
    "student*",
    "citizen*",
    "consumer*",
    "subject*",
    "individual*",
    "organization*",
    "organisation*",
    "tenant*",
    "member*",
    "business process*",
    "affected process*",
  ],
  dataCategories: [
    "data",
    "dataset*",
    "database*",
    "code",
    "codebase*",
    "repositor*",
    "source*",
    "pii",
    "personal",
    "email*",
    "transcript*",
    "ticket*",
    "document*",
    "record*",
    "metadata",
    "log",
    "logs",
    "profile*",
    "file*",
    "message*",
  ],
} as const satisfies Record<string, readonly string[]>;

export type InitialPlanningContextDimension =
  keyof typeof INITIAL_PLANNING_CONTEXT_DIMENSIONS;

// Only explicit statements that AI is absent short-circuit readiness. Decision-level
// negatives ("no automated decision", "AI never approves") are not an absence of AI.
const NO_AI_USAGE_TERMS = [
  "does not use ai",
  "do not use ai",
  "doesn t use ai",
  "don t use ai",
  "not using ai",
  "no ai usage",
  "no ai use",
  "no ai capabilit*",
  "no ai model*",
  "no ai system*",
  "no model capabilit*",
  "khong dung ai",
  "khong su dung ai",
] as const;

export function missingInitialPlanningContextDimensions(
  confirmedContext: Record<string, unknown> | undefined,
): InitialPlanningContextDimension[] {
  const dimensions = Object.keys(
    INITIAL_PLANNING_CONTEXT_DIMENSIONS,
  ) as InitialPlanningContextDimension[];
  const statements = Array.isArray(confirmedContext?.statements)
    ? confirmedContext.statements.filter(isRecord)
    : [];
  if (statements.length === 0) {
    return dimensions;
  }
  const tokenSets = statements.map(planningStatementTokens);
  if (tokenSets.some((tokens) => matchesAnyTerm(tokens, NO_AI_USAGE_TERMS))) {
    return [];
  }
  return dimensions.filter(
    (dimension) =>
      !tokenSets.some((tokens) =>
        matchesAnyTerm(tokens, INITIAL_PLANNING_CONTEXT_DIMENSIONS[dimension]),
      ),
  );
}

function planningStatementTokens(statement: Record<string, unknown>): string[] {
  const text = [
    statement.topic,
    statement.statement,
    statement.normalizedValue,
    statement.scope,
  ]
    .map((value) =>
      typeof value === "string" ? value : JSON.stringify(value ?? {}),
    )
    .join(" ");
  return planningTokens(text);
}

function planningTokens(text: string): string[] {
  return (
    text
      .replaceAll("đ", "d")
      .replaceAll("Đ", "D")
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .match(/[a-z0-9]+/g) ?? []
  );
}

function matchesAnyTerm(tokens: string[], terms: readonly string[]): boolean {
  return terms.some((term) => matchesTerm(tokens, term));
}

function matchesTerm(tokens: string[], term: string): boolean {
  const parts = term.split(" ");
  for (let start = 0; start + parts.length <= tokens.length; start += 1) {
    const matched = parts.every((part, offset) => {
      const token = tokens[start + offset];
      return part.endsWith("*")
        ? token.startsWith(part.slice(0, -1))
        : token === part;
    });
    if (matched) {
      return true;
    }
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
