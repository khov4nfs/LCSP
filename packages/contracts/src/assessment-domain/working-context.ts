import { z } from "zod";

export const WORKING_CONTEXT_ROLES = {
  ASSESSMENT_ROOT: "ASSESSMENT_ROOT",
  REPOSITORY_RESEARCHER: "REPOSITORY_RESEARCHER",
  RULE_SET_PREPARATION: "RULE_SET_PREPARATION",
  DEFAULT: "DEFAULT",
} as const;
export type WorkingContextRole =
  (typeof WORKING_CONTEXT_ROLES)[keyof typeof WORKING_CONTEXT_ROLES];

export const WORKING_CONTEXT_MODES = {
  FRACTION: "FRACTION",
  TOKENS: "TOKENS",
  MESSAGES: "MESSAGES",
} as const;
export type WorkingContextMode =
  (typeof WORKING_CONTEXT_MODES)[keyof typeof WORKING_CONTEXT_MODES];

export const workingContextClauseSchema = z.strictObject({
  mode: z.enum([
    WORKING_CONTEXT_MODES.FRACTION,
    WORKING_CONTEXT_MODES.TOKENS,
    WORKING_CONTEXT_MODES.MESSAGES,
  ]),
  value: z.number().positive(),
});
export type WorkingContextClause = z.infer<typeof workingContextClauseSchema>;

export const workingContextTruncateArgsSchema = z.strictObject({
  trigger: workingContextClauseSchema,
  keep: workingContextClauseSchema,
});
export type WorkingContextTruncateArgs = z.infer<
  typeof workingContextTruncateArgsSchema
>;

export const workingContextPolicySchema = z.strictObject({
  role: z.string().min(1),
  trigger: workingContextClauseSchema,
  keep: workingContextClauseSchema,
  truncateArgsSettings: workingContextTruncateArgsSchema,
  outputHeadroomTokens: z.number().int().positive(),
  trimTokensToSummarize: z.number().int().positive(),
  maxWorkingContextTokens: z.number().int().positive().nullable(),
});
export type WorkingContextPolicy = z.infer<typeof workingContextPolicySchema>;

export const DEFAULT_WORKING_CONTEXT_POLICIES: Record<
  WorkingContextRole,
  Omit<WorkingContextPolicy, "role" | "maxWorkingContextTokens">
> = {
  [WORKING_CONTEXT_ROLES.ASSESSMENT_ROOT]: {
    trigger: { mode: WORKING_CONTEXT_MODES.FRACTION, value: 0.8 },
    keep: { mode: WORKING_CONTEXT_MODES.MESSAGES, value: 10 },
    truncateArgsSettings: {
      trigger: { mode: WORKING_CONTEXT_MODES.MESSAGES, value: 20 },
      keep: { mode: WORKING_CONTEXT_MODES.MESSAGES, value: 10 },
    },
    outputHeadroomTokens: 8192,
    trimTokensToSummarize: 8192,
  },
  [WORKING_CONTEXT_ROLES.REPOSITORY_RESEARCHER]: {
    trigger: { mode: WORKING_CONTEXT_MODES.FRACTION, value: 0.75 },
    keep: { mode: WORKING_CONTEXT_MODES.MESSAGES, value: 6 },
    truncateArgsSettings: {
      trigger: { mode: WORKING_CONTEXT_MODES.MESSAGES, value: 15 },
      keep: { mode: WORKING_CONTEXT_MODES.MESSAGES, value: 6 },
    },
    outputHeadroomTokens: 4096,
    trimTokensToSummarize: 4096,
  },
  [WORKING_CONTEXT_ROLES.RULE_SET_PREPARATION]: {
    trigger: { mode: WORKING_CONTEXT_MODES.FRACTION, value: 0.85 },
    keep: { mode: WORKING_CONTEXT_MODES.FRACTION, value: 0.1 },
    truncateArgsSettings: {
      trigger: { mode: WORKING_CONTEXT_MODES.MESSAGES, value: 30 },
      keep: { mode: WORKING_CONTEXT_MODES.MESSAGES, value: 15 },
    },
    outputHeadroomTokens: 65536,
    trimTokensToSummarize: 16384,
  },
  [WORKING_CONTEXT_ROLES.DEFAULT]: {
    trigger: { mode: WORKING_CONTEXT_MODES.FRACTION, value: 0.8 },
    keep: { mode: WORKING_CONTEXT_MODES.MESSAGES, value: 10 },
    truncateArgsSettings: {
      trigger: { mode: WORKING_CONTEXT_MODES.MESSAGES, value: 20 },
      keep: { mode: WORKING_CONTEXT_MODES.MESSAGES, value: 10 },
    },
    outputHeadroomTokens: 4096,
    trimTokensToSummarize: 4096,
  },
};

/**
 * Business purpose: Map an arbitrary role string to a canonical WorkingContextRole.
 *
 * Business rules:
 * - Case-insensitive and punctuation-tolerant normalization (spaces/hyphens mapped to underscores).
 * - Recognized patterns for root, researcher, and preparation map to their canonical roles.
 * - Any unrecognized or empty role string falls back safely to DEFAULT.
 *
 * Execution flow:
 * 1. Clean and uppercase the role string.
 * 2. Match against known role identities.
 * 3. Return matching canonical role or DEFAULT.
 *
 * Failure cases:
 * - Empty, non-matching, or malformed role strings return the canonical DEFAULT role.
 *
 * Side effects:
 * - Pure mapping function; no mutation or external side effects.
 */
function normalizeRole(role: string): WorkingContextRole {
  const clean = role.trim().toUpperCase().replace(/-/g, "_");
  if (clean === "ASSESSMENT_ROOT" || clean === "ROOT") {
    return WORKING_CONTEXT_ROLES.ASSESSMENT_ROOT;
  }
  if (clean === "REPOSITORY_RESEARCHER" || clean === "RESEARCHER") {
    return WORKING_CONTEXT_ROLES.REPOSITORY_RESEARCHER;
  }
  if (clean === "RULE_SET_PREPARATION" || clean === "PREPARATION") {
    return WORKING_CONTEXT_ROLES.RULE_SET_PREPARATION;
  }
  return WORKING_CONTEXT_ROLES.DEFAULT;
}

export interface ResolveWorkingContextOptions {
  contextWindowTokens?: number | null;
  maxOutputTokens?: number | null;
}

/**
 * Business purpose: Resolve the authoritative working-context compaction and retention policy for an agent role.
 *
 * Business rules:
 * - Distinct policy configurations must be maintained per agent role (Assessment Root, Researcher, Rule Set Preparation, Default).
 * - Output headroom must be preserved so model responses do not hit hard provider context limits.
 * - When contextWindowTokens is supplied, trigger thresholds in token mode must not exceed (contextWindowTokens - outputHeadroomTokens).
 * - When maxOutputTokens is configured, outputHeadroomTokens must adapt to ensure sufficient generation headroom.
 *
 * Execution flow:
 * 1. Normalize the agent role to a canonical WorkingContextRole.
 * 2. Retrieve base role defaults (trigger, keep, truncateArgsSettings, outputHeadroom, trimTokens).
 * 3. Adjust output headroom if options specify a larger maxOutputTokens.
 * 4. Bound trigger threshold if contextWindowTokens is specified.
 * 5. Return validated WorkingContextPolicy.
 *
 * Failure cases:
 * - Invalid options (such as negative numbers) throw Zod validation errors.
 *
 * Side effects:
 * - Pure resolution function; no external API calls or database persistence.
 */
export function resolveWorkingContextPolicy(
  role: string,
  options?: ResolveWorkingContextOptions,
): WorkingContextPolicy {
  const canonicalRole = normalizeRole(role);
  const baseDefaults = DEFAULT_WORKING_CONTEXT_POLICIES[canonicalRole];

  let outputHeadroomTokens = baseDefaults.outputHeadroomTokens;
  if (options?.maxOutputTokens && options.maxOutputTokens > outputHeadroomTokens) {
    outputHeadroomTokens = options.maxOutputTokens;
  }

  const contextWindowTokens = options?.contextWindowTokens ?? null;

  let trigger = { ...baseDefaults.trigger };
  if (contextWindowTokens && contextWindowTokens > outputHeadroomTokens) {
    if (trigger.mode === WORKING_CONTEXT_MODES.TOKENS) {
      const maxAllowedTrigger = contextWindowTokens - outputHeadroomTokens;
      if (trigger.value > maxAllowedTrigger) {
        trigger = {
          mode: WORKING_CONTEXT_MODES.TOKENS,
          value: maxAllowedTrigger,
        };
      }
    }
  }

  return workingContextPolicySchema.parse({
    role,
    trigger,
    keep: baseDefaults.keep,
    truncateArgsSettings: baseDefaults.truncateArgsSettings,
    outputHeadroomTokens,
    trimTokensToSummarize: baseDefaults.trimTokensToSummarize,
    maxWorkingContextTokens: contextWindowTokens,
  });
}
