import { describe, expect, it } from "@jest/globals";
import {
  RULE_DECISION_APPLICABILITIES,
  RULE_DECISION_BASIS_FINDINGS,
  RULE_DECISION_BASIS_KINDS,
  RULE_DECISION_COMPLIANCE_OUTCOMES,
  RULE_DECISION_CRITERION_OUTCOMES,
  RULE_DECISION_REFERENCE_TYPES,
  ruleDecisionSchema,
  type RuleDecision,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_DECISION_SCOPE,
  ASSESSMENT_EVIDENCE_TYPES,
  ASSESSMENT_FACT_AUTHORITIES,
  SEARCH_COVERAGE_SCOPE_KINDS,
  DECISION_VALIDATION_FAILURE_CODES as FAIL,
} from "@lcsp/contracts/assessment-domain";

import {
  validateRuleDecision,
  type DecisionValidationContext,
} from "./decision-validator.js";

const ids = {
  ruleSet: "11111111-1111-4111-8111-111111111111",
  snapshot: "66666666-6666-4666-8666-666666666666",
  evidence: "22222222-2222-4222-8222-222222222222",
  fact: "33333333-3333-4333-8333-333333333333",
};
const COMMIT = "a".repeat(40);

const context = (): DecisionValidationContext => ({
  caseRevision: 3,
  pins: {
    ruleSetVersionId: ids.ruleSet,
    repositorySnapshotId: ids.snapshot,
    repositoryCommit: COMMIT,
  },
  rule: {
    assessmentRuleId: "ER-RET",
    assessmentRuleVersion: "v1",
    criterionIds: new Set(["C-1", "C-2"]),
    legalContextIds: new Set(["LR-RET", "LR-EXC"]),
    declaredElements: new Map(),
  },
  evidence: new Map([
    [
      ids.evidence,
      {
        state: "ACCEPTED",
        repositoryCommit: COMMIT,
        type: ASSESSMENT_EVIDENCE_TYPES.REPOSITORY_SOURCE,
        payload: {},
      },
    ],
  ]),
  facts: new Map([
    [
      ids.fact,
      {
        state: "ACCEPTED",
        caseRevision: 2,
        authority: ASSESSMENT_FACT_AUTHORITIES.HUMAN_PROVIDED,
        evidenceIds: [],
      },
    ],
  ]),
});

const evidenceRef = {
  type: RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE,
  evidenceId: ids.evidence,
} as const;
const factRef = {
  type: RULE_DECISION_REFERENCE_TYPES.CONFIRMED_FACT,
  factId: ids.fact,
  caseRevision: 3,
} as const;

function applicable(
  overrides: Partial<Record<string, unknown>> = {},
): RuleDecision {
  return ruleDecisionSchema.parse({
    assessmentRuleId: "ER-RET",
    assessmentRuleVersion: "v1",
    scopeId: ASSESSMENT_DECISION_SCOPE,
    ruleSetVersionId: ids.ruleSet,
    repositorySnapshotId: ids.snapshot,
    repositoryCommit: COMMIT,
    caseRevision: 3,
    legalContextRefs: [{ legalContextId: "LR-RET" }],
    applicability: RULE_DECISION_APPLICABILITIES.APPLICABLE,
    rationale: "The retention duty applies to production records.",
    references: [evidenceRef],
    criteria: ["C-1", "C-2"].map((criterionId) => ({
      criterionId,
      outcome: RULE_DECISION_CRITERION_OUTCOMES.MET,
      rationale: "Verified in source.",
      references: [evidenceRef, factRef],
    })),
    compliance: RULE_DECISION_COMPLIANCE_OUTCOMES.COMPLIANT,
    ...overrides,
  });
}

const codes = (decision: RuleDecision, ctx = context()) =>
  validateRuleDecision(decision, ctx).map((failure) => failure.code);

describe("validateRuleDecision (identity and provenance only)", () => {
  it.each([
    ["complete", null],
    ["truncated", FAIL.SEARCH_COVERAGE_INCOMPLETE],
    ["known-gap", FAIL.SEARCH_COVERAGE_INCOMPLETE],
    ["missing-payload", FAIL.SEARCH_COVERAGE_INCOMPLETE],
    ["unknown", FAIL.UNKNOWN_EVIDENCE_REFERENCE],
    ["invalidated", FAIL.EVIDENCE_NOT_ACCEPTED],
    ["mispinned", FAIL.EVIDENCE_PIN_MISMATCH],
  ])(
    "checks %s evidence reached only through a cited fact",
    (scenario, code) => {
      const ctx = context();
      ctx.facts = new Map([
        [
          ids.fact,
          {
            state: "ACCEPTED",
            caseRevision: 2,
            authority: ASSESSMENT_FACT_AUTHORITIES.EVIDENCE_CITED,
            evidenceIds: [ids.evidence],
          },
        ],
      ]);
      ctx.evidence =
        scenario === "unknown"
          ? new Map()
          : new Map([
              [
                ids.evidence,
                {
                  state:
                    scenario === "invalidated" ? "INVALIDATED" : "ACCEPTED",
                  repositoryCommit:
                    scenario === "mispinned" ? "b".repeat(40) : COMMIT,
                  type: ASSESSMENT_EVIDENCE_TYPES.SEARCH_COVERAGE,
                  payload:
                    scenario === "missing-payload"
                      ? {}
                      : {
                          scopes: [
                            {
                              kind: SEARCH_COVERAGE_SCOPE_KINDS.SOURCE_DIRECTORY,
                              path: ".",
                            },
                          ],
                          queries: [
                            {
                              tool: "search_code",
                              query: "retention",
                              resultCount: 0,
                              truncated: scenario === "truncated",
                            },
                          ],
                          inspectedEntryPoints: ["service.py"],
                          knownGaps:
                            scenario === "known-gap"
                              ? ["Incomplete index."]
                              : [],
                          directSourceFallbacks: [],
                        },
                },
              ],
            ]);
      const decision = applicable({
        references: [factRef],
        criteria: applicable().criteria.map((c) => ({
          ...c,
          references: [factRef],
        })),
      });
      expect(validateRuleDecision(decision, ctx)).toEqual(
        code ? [{ code, ref: ids.evidence }] : [],
      );
    },
  );

  it("rejects an evidence-cited fact with no linked evidence", () => {
    const ctx = context();
    ctx.facts = new Map([
      [
        ids.fact,
        {
          state: "ACCEPTED",
          caseRevision: 2,
          authority: ASSESSMENT_FACT_AUTHORITIES.EVIDENCE_CITED,
          evidenceIds: [],
        },
      ],
    ]);
    expect(validateRuleDecision(applicable(), ctx)).toEqual([
      { code: FAIL.FACT_EVIDENCE_MISSING, ref: ids.fact },
    ]);
  });

  it("allows a human-provided fact without repository evidence", () => {
    const ctx = context();
    ctx.facts = new Map([
      [
        ids.fact,
        {
          state: "ACCEPTED",
          caseRevision: 2,
          authority: ASSESSMENT_FACT_AUTHORITIES.HUMAN_PROVIDED,
          evidenceIds: [],
        },
      ],
    ]);
    expect(codes(applicable(), ctx)).toEqual([]);
  });

  it.each(["known-gap", "truncated", "missing-payload"])(
    "rejects %s search coverage as final decision provenance",
    (scenario) => {
      const ctx = context();
      const payload = {
        scopes: [
          { kind: SEARCH_COVERAGE_SCOPE_KINDS.SOURCE_DIRECTORY, path: "." },
        ],
        queries: [
          {
            tool: "search_code",
            query: "retention",
            resultCount: 0,
            truncated: scenario === "truncated",
          },
        ],
        inspectedEntryPoints: [],
        knownGaps:
          scenario === "known-gap" ? ["Index coverage is incomplete."] : [],
        directSourceFallbacks: [],
      };
      const evidence = {
        state: "ACCEPTED",
        repositoryCommit: COMMIT,
        type: ASSESSMENT_EVIDENCE_TYPES.SEARCH_COVERAGE,
        payload: scenario === "missing-payload" ? {} : payload,
      };
      expect(
        validateRuleDecision(applicable(), {
          ...ctx,
          evidence: new Map([[ids.evidence, evidence]]),
        }),
      ).toEqual([{ code: FAIL.SEARCH_COVERAGE_INCOMPLETE, ref: ids.evidence }]);
    },
  );

  it.each([
    RULE_DECISION_CRITERION_OUTCOMES.MET,
    RULE_DECISION_CRITERION_OUTCOMES.NOT_MET,
  ])(
    "accepts complete search coverage without judging a %s conclusion",
    (outcome) => {
      const ctx = context();
      ctx.evidence = new Map([
        [
          ids.evidence,
          {
            state: "ACCEPTED",
            repositoryCommit: COMMIT,
            type: ASSESSMENT_EVIDENCE_TYPES.SEARCH_COVERAGE,
            payload: {
              scopes: [
                {
                  kind: SEARCH_COVERAGE_SCOPE_KINDS.SOURCE_DIRECTORY,
                  path: ".",
                },
              ],
              queries: [
                {
                  tool: "search_code",
                  query: "retention",
                  resultCount: 0,
                  truncated: false,
                },
              ],
              inspectedEntryPoints: ["service.py"],
              knownGaps: [],
              directSourceFallbacks: [
                {
                  path: "service.py",
                  reason: "Read the bounded source directly.",
                },
              ],
            },
          },
        ],
      ]);
      const decision = applicable({
        criteria: applicable().criteria.map((criterion) => ({
          ...criterion,
          outcome,
        })),
        compliance:
          outcome === RULE_DECISION_CRITERION_OUTCOMES.MET
            ? RULE_DECISION_COMPLIANCE_OUTCOMES.COMPLIANT
            : RULE_DECISION_COMPLIANCE_OUTCOMES.NON_COMPLIANT,
      });
      expect(codes(decision, ctx)).toEqual([]);
      ctx.evidence = new Map();
      expect(codes(decision, ctx)).toEqual([FAIL.UNKNOWN_EVIDENCE_REFERENCE]);
    },
  );

  it("accepts a complete, correctly pinned decision without judging it", () => {
    expect(codes(applicable())).toEqual([]);
    // The validator never second-guesses meaning: a NON_COMPLIANT, a COMPLIANT and a
    // NOT_APPLICABLE decision with valid references are all accepted.
    expect(
      codes(
        applicable({
          criteria: [
            {
              criterionId: "C-1",
              outcome: RULE_DECISION_CRITERION_OUTCOMES.NOT_MET,
              rationale: "Missing.",
              references: [evidenceRef],
            },
            {
              criterionId: "C-2",
              outcome: RULE_DECISION_CRITERION_OUTCOMES.MET,
              rationale: "Ok.",
              references: [evidenceRef],
            },
          ],
          compliance: RULE_DECISION_COMPLIANCE_OUTCOMES.NON_COMPLIANT,
        }),
      ),
    ).toEqual([]);
    expect(
      codes(
        applicable({
          applicability: RULE_DECISION_APPLICABILITIES.NOT_APPLICABLE,
          criteria: [],
          compliance: null,
        }),
      ),
    ).toEqual([]);
  });

  it("rejects an unknown rule, a version mismatch and unknown legal context", () => {
    const ctx = { ...context(), rule: null };
    expect(codes(applicable(), ctx)).toContain(FAIL.UNKNOWN_ASSESSMENT_RULE);
    expect(codes(applicable({ assessmentRuleVersion: "v2" }))).toContain(
      FAIL.ASSESSMENT_RULE_VERSION_MISMATCH,
    );
    expect(
      codes(applicable({ legalContextRefs: [{ legalContextId: "LR-OTHER" }] })),
    ).toContain(FAIL.UNKNOWN_LEGAL_CONTEXT);
  });

  it("rejects incomplete and foreign criteria for an applicable rule", () => {
    const one = applicable().criteria.slice(0, 1);
    expect(codes(applicable({ criteria: one }))).toContain(
      FAIL.CRITERIA_INCOMPLETE,
    );
    const extra = [
      ...applicable().criteria,
      {
        criterionId: "C-9",
        outcome: RULE_DECISION_CRITERION_OUTCOMES.MET,
        rationale: "x",
        references: [evidenceRef],
      },
    ];
    expect(codes(applicable({ criteria: extra }))).toContain(
      FAIL.UNKNOWN_CRITERION,
    );
  });

  it("rejects stale pins and revisions", () => {
    expect(
      codes(
        applicable({
          ruleSetVersionId: "44444444-4444-4444-8444-444444444444",
        }),
      ),
    ).toContain(FAIL.RULE_SET_PIN_MISMATCH);
    expect(codes(applicable({ repositoryCommit: "b".repeat(40) }))).toContain(
      FAIL.REPOSITORY_PIN_MISMATCH,
    );
    expect(
      codes(
        applicable({
          caseRevision: 2,
          criteria: applicable().criteria.map((c) => ({
            ...c,
            references: [evidenceRef],
          })),
        }),
      ),
    ).toContain(FAIL.CASE_REVISION_STALE);
    expect(codes(applicable({ scopeId: "ELSEWHERE" }))).toContain(
      FAIL.UNKNOWN_SCOPE,
    );
  });

  it("rejects references that are unknown, invalidated, mispinned or from the future", () => {
    const unknown = {
      type: RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE,
      evidenceId: "55555555-5555-4555-8555-555555555555",
    } as const;
    expect(codes(applicable({ references: [unknown] }))).toContain(
      FAIL.UNKNOWN_EVIDENCE_REFERENCE,
    );
    const invalidated = context();
    invalidated.evidence = new Map([
      [
        ids.evidence,
        { ...context().evidence.get(ids.evidence)!, state: "INVALIDATED" },
      ],
    ]);
    expect(codes(applicable(), invalidated)).toContain(
      FAIL.EVIDENCE_NOT_ACCEPTED,
    );
    const wrongCommit = context();
    wrongCommit.evidence = new Map([
      [
        ids.evidence,
        {
          ...context().evidence.get(ids.evidence)!,
          repositoryCommit: "c".repeat(40),
        },
      ],
    ]);
    expect(codes(applicable(), wrongCommit)).toContain(
      FAIL.EVIDENCE_PIN_MISMATCH,
    );
    const futureFact = context();
    futureFact.facts = new Map([
      [ids.fact, { ...context().facts.get(ids.fact)!, caseRevision: 9 }],
    ]);
    expect(codes(applicable(), futureFact)).toContain(
      FAIL.FACT_REVISION_MISMATCH,
    );
    const noFact = context();
    noFact.facts = new Map();
    expect(codes(applicable(), noFact)).toContain(FAIL.UNKNOWN_FACT_REFERENCE);
  });

  it("is deterministic and never mutates its inputs", () => {
    const decision = applicable();
    const ctx = context();
    const snapshot = JSON.stringify(decision);
    expect(validateRuleDecision(decision, ctx)).toEqual(
      validateRuleDecision(decision, ctx),
    );
    expect(JSON.stringify(decision)).toBe(snapshot);
  });
});

describe("applicability basis (structure only, whatever the legal source calls its elements)", () => {
  const CONDITION = RULE_DECISION_BASIS_KINDS.APPLICABILITY_CONDITION;
  const EXCEPTION = RULE_DECISION_BASIS_KINDS.EXCEPTION;
  const { ESTABLISHED, REFUTED, NOT_ESTABLISHED } =
    RULE_DECISION_BASIS_FINDINGS;

  // Two unrelated synthetic legal sources: different languages and vocabularies, same structure.
  const legalSources = {
    "register keepers": {
      requirement: "LR-A",
      declared: { applicabilityConditions: 2, qualifiers: 0, exceptions: 1 },
    },
    "Betreiber von Anlagen": {
      requirement: "LR-B",
      declared: { applicabilityConditions: 3, qualifiers: 1, exceptions: 0 },
    },
  } as const;

  const contextFor = (requirement: string, declared: object) => {
    const ctx = context();
    ctx.rule = {
      ...ctx.rule!,
      legalContextIds: new Set([requirement]),
      declaredElements: new Map([[requirement, declared as never]]),
    };
    return ctx;
  };
  const basis = (
    requirement: string,
    kind: string,
    index: number,
    finding: string,
    references: unknown[] = [evidenceRef],
  ) => ({
    legalRequirementId: requirement,
    kind,
    index,
    finding,
    rationale: "Element-specific rationale.",
    references,
  });
  const notApplicable = (
    requirement: string,
    applicabilityBasis?: unknown[],
  ): RuleDecision =>
    ruleDecisionSchema.parse({
      assessmentRuleId: "ER-RET",
      assessmentRuleVersion: "v1",
      scopeId: ASSESSMENT_DECISION_SCOPE,
      ruleSetVersionId: ids.ruleSet,
      repositorySnapshotId: ids.snapshot,
      repositoryCommit: COMMIT,
      caseRevision: 3,
      legalContextRefs: [{ legalContextId: requirement }],
      applicability: RULE_DECISION_APPLICABILITIES.NOT_APPLICABLE,
      rationale: "Reasoned from the pinned elements.",
      references: [factRef],
      ...(applicabilityBasis ? { applicabilityBasis } : {}),
      criteria: [],
      compliance: null,
    });
  const applicableWith = (
    requirement: string,
    applicabilityBasis?: unknown[],
  ) =>
    applicable({
      legalContextRefs: [{ legalContextId: requirement }],
      ...(applicabilityBasis ? { applicabilityBasis } : {}),
    });

  it("keeps accepting a decision without a basis when the pinned requirements declare no elements", () => {
    expect(codes(notApplicable("LR-RET"))).toEqual([]);
    expect(codes(applicableWith("LR-RET"))).toEqual([]);
  });

  describe.each(Object.entries(legalSources))(
    "legal source: %s",
    (_name, { requirement, declared }) => {
      const ctx = () => contextFor(requirement, declared);

      it("one broad factual answer cannot silently disposition the rule", () => {
        // A confirmed fact is cited, but no element of THIS rule is refuted or established.
        expect(codes(notApplicable(requirement), ctx())).toEqual([
          FAIL.APPLICABILITY_BASIS_REQUIRED,
        ]);
      });

      it("an element the evidence does not settle never supports NOT_APPLICABLE", () => {
        const decision = notApplicable(requirement, [
          basis(requirement, CONDITION, 0, NOT_ESTABLISHED, []),
          basis(requirement, CONDITION, 1, NOT_ESTABLISHED, []),
        ]);
        expect(codes(decision, ctx())).toEqual([
          FAIL.APPLICABILITY_BASIS_REQUIRED,
        ]);
      });

      it("an independently refuted condition, with its references, proves NOT_APPLICABLE", () => {
        const decision = notApplicable(requirement, [
          basis(requirement, CONDITION, 1, REFUTED, [evidenceRef, factRef]),
        ]);
        expect(codes(decision, ctx())).toEqual([]);
      });

      it("a refuted element must carry references", () => {
        const decision = notApplicable(requirement, [
          basis(requirement, CONDITION, 0, REFUTED, []),
        ]);
        expect(codes(decision, ctx())).toEqual(
          expect.arrayContaining([FAIL.APPLICABILITY_BASIS_UNREFERENCED]),
        );
      });

      it("rejects an element the requirement does not declare", () => {
        const tooFar = declared.applicabilityConditions;
        const decision = notApplicable(requirement, [
          basis(requirement, CONDITION, tooFar, REFUTED),
        ]);
        expect(codes(decision, ctx())).toEqual(
          expect.arrayContaining([FAIL.UNKNOWN_APPLICABILITY_ELEMENT]),
        );
        const foreign = notApplicable(requirement, [
          basis("LR-NOT-LINKED", CONDITION, 0, REFUTED),
        ]);
        expect(codes(foreign, ctx())).toEqual(
          expect.arrayContaining([FAIL.UNKNOWN_APPLICABILITY_ELEMENT]),
        );
      });

      it("APPLICABLE needs an established condition and cannot also report a refuting element", () => {
        expect(codes(applicableWith(requirement), ctx())).toEqual([
          FAIL.APPLICABILITY_BASIS_REQUIRED,
        ]);
        expect(
          codes(
            applicableWith(requirement, [
              basis(requirement, CONDITION, 0, ESTABLISHED),
            ]),
            ctx(),
          ),
        ).toEqual([]);
        expect(
          codes(
            applicableWith(requirement, [
              basis(requirement, CONDITION, 0, ESTABLISHED),
              basis(requirement, CONDITION, 1, REFUTED),
            ]),
            ctx(),
          ),
        ).toEqual([FAIL.APPLICABILITY_BASIS_CONTRADICTION]);
      });

      it("basis references are authority-checked like every other reference", () => {
        const unknown = {
          type: RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE,
          evidenceId: "99999999-9999-4999-8999-999999999999",
        };
        const decision = notApplicable(requirement, [
          basis(requirement, CONDITION, 0, REFUTED, [unknown]),
        ]);
        expect(codes(decision, ctx())).toEqual([
          FAIL.UNKNOWN_EVIDENCE_REFERENCE,
        ]);
      });
    },
  );

  it("an established exception proves NOT_APPLICABLE and contradicts APPLICABLE", () => {
    const { requirement, declared } = legalSources["register keepers"];
    const ctx = contextFor(requirement, declared);
    expect(
      codes(
        notApplicable(requirement, [
          basis(requirement, EXCEPTION, 0, ESTABLISHED),
        ]),
        ctx,
      ),
    ).toEqual([]);
    expect(
      codes(
        applicableWith(requirement, [
          basis(requirement, CONDITION, 0, ESTABLISHED),
          basis(requirement, EXCEPTION, 0, ESTABLISHED),
        ]),
        ctx,
      ),
    ).toEqual([FAIL.APPLICABILITY_BASIS_CONTRADICTION]);
  });

  it("the stored decision shape is unchanged for decisions without a basis, and bad bases are rejected by the schema", () => {
    const plain = applicable();
    expect("applicabilityBasis" in plain).toBe(false);
    expect(ruleDecisionSchema.parse(JSON.parse(JSON.stringify(plain)))).toEqual(
      plain,
    );

    const duplicate = () =>
      applicable({
        applicabilityBasis: [
          basis("LR-RET", CONDITION, 0, ESTABLISHED),
          basis("LR-RET", CONDITION, 0, REFUTED),
        ],
      });
    expect(duplicate).toThrow();
    const staleFact = () =>
      applicable({
        applicabilityBasis: [
          basis("LR-RET", CONDITION, 0, ESTABLISHED, [
            { ...factRef, caseRevision: 1 },
          ]),
        ],
      });
    expect(staleFact).toThrow();
  });
});
