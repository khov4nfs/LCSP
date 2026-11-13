import {
  WORKING_CONTEXT_ROLES,
  WORKING_CONTEXT_MODES,
  DEFAULT_WORKING_CONTEXT_POLICIES,
  workingContextClauseSchema,
  workingContextTruncateArgsSchema,
  workingContextPolicySchema,
  resolveWorkingContextPolicy,
} from "../src/assessment-domain/index.ts";

describe("working-context policy contracts", () => {
  it("validates working context roles and modes as canonical constants", () => {
    expect(WORKING_CONTEXT_ROLES.ASSESSMENT_ROOT).toBe("ASSESSMENT_ROOT");
    expect(WORKING_CONTEXT_ROLES.REPOSITORY_RESEARCHER).toBe(
      "REPOSITORY_RESEARCHER",
    );
    expect(WORKING_CONTEXT_ROLES.RULE_SET_PREPARATION).toBe(
      "RULE_SET_PREPARATION",
    );
    expect(WORKING_CONTEXT_ROLES.DEFAULT).toBe("DEFAULT");

    expect(WORKING_CONTEXT_MODES.FRACTION).toBe("FRACTION");
    expect(WORKING_CONTEXT_MODES.TOKENS).toBe("TOKENS");
    expect(WORKING_CONTEXT_MODES.MESSAGES).toBe("MESSAGES");
  });

  it("validates schemas for clauses and policies", () => {
    const clause = workingContextClauseSchema.parse({
      mode: WORKING_CONTEXT_MODES.FRACTION,
      value: 0.8,
    });
    expect(clause.mode).toBe("FRACTION");
    expect(clause.value).toBe(0.8);

    const truncateArgs = workingContextTruncateArgsSchema.parse({
      trigger: { mode: WORKING_CONTEXT_MODES.MESSAGES, value: 20 },
      keep: { mode: WORKING_CONTEXT_MODES.MESSAGES, value: 10 },
    });
    expect(truncateArgs.trigger.value).toBe(20);

    const policy = workingContextPolicySchema.parse({
      role: "assessment-root",
      trigger: { mode: WORKING_CONTEXT_MODES.FRACTION, value: 0.8 },
      keep: { mode: WORKING_CONTEXT_MODES.MESSAGES, value: 10 },
      truncateArgsSettings: truncateArgs,
      outputHeadroomTokens: 8192,
      trimTokensToSummarize: 8192,
      maxWorkingContextTokens: 200000,
    });
    expect(policy.role).toBe("assessment-root");
    expect(policy.outputHeadroomTokens).toBe(8192);
  });

  it("resolves role-specific working context policies accurately", () => {
    const rootPolicy = resolveWorkingContextPolicy("assessment-root");
    expect(rootPolicy.role).toBe("assessment-root");
    expect(rootPolicy.outputHeadroomTokens).toBe(8192);
    expect(rootPolicy.trigger.value).toBe(0.8);
    expect(rootPolicy.keep.value).toBe(10);

    const researcherPolicy = resolveWorkingContextPolicy("repository-researcher");
    expect(researcherPolicy.outputHeadroomTokens).toBe(4096);
    expect(researcherPolicy.trigger.value).toBe(0.75);
    expect(researcherPolicy.keep.value).toBe(6);

    const rspPolicy = resolveWorkingContextPolicy("rule-set-preparation");
    expect(rspPolicy.outputHeadroomTokens).toBe(65536);
    expect(rspPolicy.trigger.value).toBe(0.85);
    expect(rspPolicy.keep.mode).toBe("FRACTION");
    expect(rspPolicy.keep.value).toBe(0.1);
  });

  it("adapts output headroom when maxOutputTokens is larger than base headroom", () => {
    const policy = resolveWorkingContextPolicy("assessment-root", {
      maxOutputTokens: 32768,
    });
    expect(policy.outputHeadroomTokens).toBe(32768);
  });

  it("bounds token trigger threshold below contextWindowTokens minus headroom", () => {
    const policy = resolveWorkingContextPolicy("custom-role", {
      contextWindowTokens: 100000,
      maxOutputTokens: 20000,
    });
    expect(policy.maxWorkingContextTokens).toBe(100000);
    expect(policy.outputHeadroomTokens).toBe(20000);
  });
});

