import {
  WORKLOAD_SCOPES,
  ASSESSMENT_BUDGET_REASONS,
  assessmentBudgetLimitsSchema,
  assessmentCumulativeUsageSchema,
  assessmentBudgetStateSchema,
  evaluateBudgetAdmission,
  parseConfiguredPositiveInt,
  resolveConfiguredBudgetLimits,
  finishAssessmentRootRequestSchema,
  ASSESSMENT_DOMAIN_ERROR_CODES,
  assessmentBudgetExtensionSchema,
  applyBudgetExtension,
} from "../src/assessment-domain/index.ts";

describe("assessment budget kernel contracts", () => {
  it("validates workload scopes and budget reasons", () => {
    expect(WORKLOAD_SCOPES.ASSESSMENT_ROOT).toBe("ASSESSMENT_ROOT");
    expect(WORKLOAD_SCOPES.RULE_SET_PREPARATION).toBe("RULE_SET_PREPARATION");
    expect(ASSESSMENT_BUDGET_REASONS.CALL_LIMIT_EXCEEDED).toBe(
      "CALL_LIMIT_EXCEEDED",
    );
    expect(ASSESSMENT_BUDGET_REASONS.TOKEN_LIMIT_EXCEEDED).toBe(
      "TOKEN_LIMIT_EXCEEDED",
    );
    expect(ASSESSMENT_BUDGET_REASONS.NO_PROGRESS_LIMIT_EXCEEDED).toBe(
      "NO_PROGRESS_LIMIT_EXCEEDED",
    );
    expect(ASSESSMENT_BUDGET_REASONS.AGENT_BUDGET_REACHED).toBe(
      "AGENT_BUDGET_REACHED",
    );
    expect(ASSESSMENT_DOMAIN_ERROR_CODES.BUDGET_EXHAUSTED).toBe(
      "ASSESSMENT_BUDGET_EXHAUSTED",
    );
    expect(ASSESSMENT_DOMAIN_ERROR_CODES.NO_PROGRESS_LIMIT_REACHED).toBe(
      "ASSESSMENT_NO_PROGRESS_LIMIT_REACHED",
    );
  });

  it("validates assessmentBudgetLimitsSchema and assessmentCumulativeUsageSchema", () => {
    const limits = assessmentBudgetLimitsSchema.parse({
      maxModelCalls: 50,
      maxInputTokens: 2_000_000,
      maxOutputTokens: 100_000,
      maxTotalTokens: 2_100_000,
      noProgressLimit: 10,
    });
    expect(limits.maxModelCalls).toBe(50);

    const usage = assessmentCumulativeUsageSchema.parse({
      modelCalls: 10,
      inputTokens: 500_000,
      outputTokens: 20_000,
      totalTokens: 520_000,
      consecutiveTurnsWithoutProgress: 2,
    });
    expect(usage.modelCalls).toBe(10);

    const state = assessmentBudgetStateSchema.parse({
      workloadScope: WORKLOAD_SCOPES.ASSESSMENT_ROOT,
      limits,
      cumulativeUsage: usage,
      status: "ADMITTED",
    });
    expect(state.status).toBe("ADMITTED");
  });

  it("admits invocations within limits", () => {
    const limits = {
      maxModelCalls: 50,
      maxInputTokens: 2_000_000,
      maxOutputTokens: 100_000,
      maxTotalTokens: 2_100_000,
      noProgressLimit: 10,
    };
    const usage = {
      modelCalls: 49,
      inputTokens: 1_900_000,
      outputTokens: 90_000,
      totalTokens: 1_990_000,
      consecutiveTurnsWithoutProgress: 9,
    };
    const result = evaluateBudgetAdmission(limits, usage);
    expect(result.admitted).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.status).toBe("ADMITTED");
  });

  it("denies invocation when model call limit reached", () => {
    const limits = {
      maxModelCalls: 50,
      maxInputTokens: 2_000_000,
      maxOutputTokens: 100_000,
      maxTotalTokens: 2_100_000,
      noProgressLimit: 10,
    };
    const usage = {
      modelCalls: 50,
      inputTokens: 1_000_000,
      outputTokens: 50_000,
      totalTokens: 1_050_000,
      consecutiveTurnsWithoutProgress: 0,
    };
    const result = evaluateBudgetAdmission(limits, usage);
    expect(result.admitted).toBe(false);
    expect(result.reason).toBe(ASSESSMENT_BUDGET_REASONS.CALL_LIMIT_EXCEEDED);
    expect(result.status).toBe("EXHAUSTED");
  });

  it("denies invocation when input token limit reached", () => {
    const limits = {
      maxModelCalls: 50,
      maxInputTokens: 2_000_000,
      maxOutputTokens: 100_000,
      maxTotalTokens: 2_100_000,
      noProgressLimit: 10,
    };
    const usage = {
      modelCalls: 20,
      inputTokens: 2_000_001,
      outputTokens: 50_000,
      totalTokens: 2_050_001,
      consecutiveTurnsWithoutProgress: 0,
    };
    const result = evaluateBudgetAdmission(limits, usage);
    expect(result.admitted).toBe(false);
    expect(result.reason).toBe(ASSESSMENT_BUDGET_REASONS.TOKEN_LIMIT_EXCEEDED);
    expect(result.status).toBe("EXHAUSTED");
  });

  it("denies invocation when no-progress limit reached", () => {
    const limits = {
      maxModelCalls: 50,
      maxInputTokens: 2_000_000,
      maxOutputTokens: 100_000,
      maxTotalTokens: 2_100_000,
      noProgressLimit: 5,
    };
    const usage = {
      modelCalls: 15,
      inputTokens: 300_000,
      outputTokens: 15_000,
      totalTokens: 315_000,
      consecutiveTurnsWithoutProgress: 5,
    };
    const result = evaluateBudgetAdmission(limits, usage);
    expect(result.admitted).toBe(false);
    expect(result.reason).toBe(
      ASSESSMENT_BUDGET_REASONS.NO_PROGRESS_LIMIT_EXCEEDED,
    );
    expect(result.status).toBe("NO_PROGRESS");
  });

  it("admits invocations when limits are unconstrained (all null) even for large usage", () => {
    const limits = {
      maxModelCalls: null,
      maxInputTokens: null,
      maxOutputTokens: null,
      maxTotalTokens: null,
      noProgressLimit: null,
    };
    const usage = {
      modelCalls: 500,
      inputTokens: 20_000_000,
      outputTokens: 1_000_000,
      totalTokens: 21_000_000,
      consecutiveTurnsWithoutProgress: 50,
    };
    const result = evaluateBudgetAdmission(limits, usage);
    expect(result.admitted).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.status).toBe("ADMITTED");
  });

  describe("parseConfiguredPositiveInt", () => {
    it("returns null for undefined, null, or empty string", () => {
      expect(parseConfiguredPositiveInt("TEST_VAR", undefined)).toBeNull();
      expect(parseConfiguredPositiveInt("TEST_VAR", null)).toBeNull();
      expect(parseConfiguredPositiveInt("TEST_VAR", "")).toBeNull();
      expect(parseConfiguredPositiveInt("TEST_VAR", "   ")).toBeNull();
    });

    it("parses valid positive integer strings", () => {
      expect(parseConfiguredPositiveInt("TEST_VAR", "1")).toBe(1);
      expect(parseConfiguredPositiveInt("TEST_VAR", " 42 ")).toBe(42);
      expect(parseConfiguredPositiveInt("TEST_VAR", "1000000")).toBe(1_000_000);
    });

    it("throws error for malformed or non-positive values", () => {
      expect(() => parseConfiguredPositiveInt("TEST_VAR", "0")).toThrow(
        /expected a positive integer/,
      );
      expect(() => parseConfiguredPositiveInt("TEST_VAR", "-5")).toThrow(
        /expected a positive integer/,
      );
      expect(() => parseConfiguredPositiveInt("TEST_VAR", "abc")).toThrow(
        /expected a positive integer/,
      );
      expect(() => parseConfiguredPositiveInt("TEST_VAR", "1.5")).toThrow(
        /expected a positive integer/,
      );
    });
  });

  describe("resolveConfiguredBudgetLimits", () => {
    it("resolves all null limits when environment variables are unset", () => {
      const rootLimits = resolveConfiguredBudgetLimits(
        {},
        WORKLOAD_SCOPES.ASSESSMENT_ROOT,
      );
      expect(rootLimits.maxModelCalls).toBeNull();
      expect(rootLimits.maxInputTokens).toBeNull();
      expect(rootLimits.maxOutputTokens).toBeNull();
      expect(rootLimits.maxTotalTokens).toBeNull();
      expect(rootLimits.noProgressLimit).toBeNull();

      const rspLimits = resolveConfiguredBudgetLimits(
        {},
        WORKLOAD_SCOPES.RULE_SET_PREPARATION,
      );
      expect(rspLimits.maxModelCalls).toBeNull();
      expect(rspLimits.maxInputTokens).toBeNull();
      expect(rspLimits.maxOutputTokens).toBeNull();
      expect(rspLimits.maxTotalTokens).toBeNull();
      expect(rspLimits.noProgressLimit).toBeNull();
    });

    it("resolves configured environment variables for ASSESSMENT_ROOT", () => {
      const limits = resolveConfiguredBudgetLimits(
        {
          LCSP_ASSESSMENT_MAX_MODEL_CALLS: "150",
          LCSP_ASSESSMENT_MAX_INPUT_TOKENS: "5000000",
          LCSP_ASSESSMENT_MAX_OUTPUT_TOKENS: "250000",
          LCSP_ASSESSMENT_MAX_TOTAL_TOKENS: "5250000",
          LCSP_ASSESSMENT_NO_PROGRESS_LIMIT: "25",
        },
        WORKLOAD_SCOPES.ASSESSMENT_ROOT,
      );
      expect(limits.maxModelCalls).toBe(150);
      expect(limits.maxInputTokens).toBe(5_000_000);
      expect(limits.maxOutputTokens).toBe(250_000);
      expect(limits.maxTotalTokens).toBe(5_250_000);
      expect(limits.noProgressLimit).toBe(25);
    });

    it("applies overrideNoProgress option to clear noProgressLimit", () => {
      const limits = resolveConfiguredBudgetLimits(
        { LCSP_ASSESSMENT_NO_PROGRESS_LIMIT: "15" },
        WORKLOAD_SCOPES.ASSESSMENT_ROOT,
        { overrideNoProgress: true },
      );
      expect(limits.noProgressLimit).toBeNull();
    });

    it("throws error when environment variable is malformed", () => {
      expect(() =>
        resolveConfiguredBudgetLimits(
          { LCSP_ASSESSMENT_MAX_MODEL_CALLS: "not_a_number" },
          WORKLOAD_SCOPES.ASSESSMENT_ROOT,
        ),
      ).toThrow(/Invalid configuration for LCSP_ASSESSMENT_MAX_MODEL_CALLS/);
    });
  });

  it("validates finishAssessmentRootRequestSchema with reason for PAUSED state", () => {
    const validWithReason = finishAssessmentRootRequestSchema.safeParse({
      state: "PAUSED",
      checkpointId: "11111111-1111-4111-8111-111111111111",
      reason: "AGENT_BUDGET_REACHED",
    });
    expect(validWithReason.success).toBe(true);

    const validWithControlId = finishAssessmentRootRequestSchema.safeParse({
      state: "PAUSED",
      checkpointId: "11111111-1111-4111-8111-111111111111",
      controlRequestId: "22222222-2222-4222-8222-222222222222",
    });
    expect(validWithControlId.success).toBe(true);

    const invalidPausedNoReasonOrControl =
      finishAssessmentRootRequestSchema.safeParse({
        state: "PAUSED",
        checkpointId: "11111111-1111-4111-8111-111111111111",
      });
    expect(invalidPausedNoReasonOrControl.success).toBe(false);

    const invalidPausedNoCheckpoint =
      finishAssessmentRootRequestSchema.safeParse({
        state: "PAUSED",
        reason: "AGENT_BUDGET_REACHED",
      });
    expect(invalidPausedNoCheckpoint.success).toBe(false);
  });

  describe("assessmentBudgetExtension and applyBudgetExtension", () => {
    it("validates a compliant assessmentBudgetExtension schema", () => {
      const validExtension = {
        version: 1,
        authorizedBy: "admin-1",
        authorizedAt: "2026-11-14T12:00:00.000Z",
        auditReason: "Customer requested additional analysis turns",
        additionalModelCalls: 50,
        additionalInputTokens: 1_000_000,
        additionalOutputTokens: 50_000,
        additionalTotalTokens: 1_050_000,
      };
      const result = assessmentBudgetExtensionSchema.safeParse(validExtension);
      expect(result.success).toBe(true);
    });

    it("applies budget extension to increase configured limits", () => {
      const baseLimits = {
        maxModelCalls: 100,
        maxInputTokens: 2_000_000,
        maxOutputTokens: 100_000,
        maxTotalTokens: 2_100_000,
        noProgressLimit: 15,
      };
      const extension = {
        version: 1,
        authorizedBy: "admin-1",
        authorizedAt: "2026-11-14T12:00:00.000Z",
        auditReason: "Approved expansion",
        additionalModelCalls: 50,
        additionalInputTokens: 500_000,
        additionalOutputTokens: 25_000,
        additionalTotalTokens: 525_000,
      };

      const extended = applyBudgetExtension(baseLimits, extension);
      expect(extended.maxModelCalls).toBe(150);
      expect(extended.maxInputTokens).toBe(2_500_000);
      expect(extended.maxOutputTokens).toBe(125_000);
      expect(extended.maxTotalTokens).toBe(2_625_000);
      expect(extended.noProgressLimit).toBe(15);
    });

    it("leaves null/unbounded limits unchanged when extending", () => {
      const unboundedBase = {
        maxModelCalls: null,
        maxInputTokens: null,
        maxOutputTokens: null,
        maxTotalTokens: null,
        noProgressLimit: null,
      };
      const extension = {
        version: 1,
        authorizedBy: "admin-1",
        authorizedAt: "2026-11-14T12:00:00.000Z",
        auditReason: "Approved expansion",
        additionalModelCalls: 50,
      };

      const extended = applyBudgetExtension(unboundedBase, extension);
      expect(extended.maxModelCalls).toBeNull();
      expect(extended.maxInputTokens).toBeNull();
      expect(extended.maxTotalTokens).toBeNull();
    });

    it("returns identical base limits when extension is omitted", () => {
      const baseLimits = {
        maxModelCalls: 100,
        maxInputTokens: 2_000_000,
        maxOutputTokens: 100_000,
        maxTotalTokens: 2_100_000,
        noProgressLimit: 15,
      };
      const extended = applyBudgetExtension(baseLimits);
      expect(extended).toEqual(baseLimits);
    });
  });
});
