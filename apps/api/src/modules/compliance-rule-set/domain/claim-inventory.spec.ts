import { describe, expect, it } from "@jest/globals";
import { COMPLIANCE_RULE_SET_FAILURE_CODES as F } from "@lcsp/contracts/compliance-rule-set";
import {
  fixtureLegalSource,
  validPacket,
} from "../../../../test/support/compliance-rule-set-fixtures.js";
import { canonicalInventoryFixture } from "../../../../test/support/canonical-claim-inventory-fixture.js";
import { refreshStructuralAudits } from "../../../../test/support/structural-semantic-fixture.js";
import { signSemanticAuditFixture } from "./semantic-audit-attestation.js";
import {
  authoringReadinessGaps,
  canonicalClaimId,
  inventoryFingerprint,
  noOperativeObligationsFailures,
  validateClaimInventory,
  validateFrozenInventory,
} from "./claim-inventory.js";
import { validateSemanticClaimGraph } from "./semantic-claim-integrity.validator.js";
const RUN = "00000000-0000-4000-8000-000000000009";
function fixture() {
  const packet = validPacket();
  const inventory = canonicalInventoryFixture(
    packet,
    RUN,
    1,
    fixtureLegalSource().documentGraph!,
  );
  return { packet, ...inventory, source: fixtureLegalSource() };
}
describe("Frozen Preparation claim inventory", () => {
  it("validates discovery independently of Requirements and Rule accounting", () => {
    const f = fixture();
    expect(
      validateClaimInventory(RUN, 1, f.graph, f.identities, f.source).failures,
    ).toEqual([]);
    const discovery = validateClaimInventory(
      RUN,
      1,
      f.graph,
      f.identities,
      f.source,
    ).coverage.semanticClaims;
    expect(discovery.accounted).toBe(0);
    expect(discovery.unaccounted).toBe(discovery.relevant);
    f.packet.legalRequirements = [];
    f.packet.assessmentRules = [];
    expect(
      validateSemanticClaimGraph(f.packet, f.source).failures.some(
        (g) => g.code === F.UNACCOUNTED_SEMANTIC_CLAIM,
      ),
    ).toBe(true);
  });
  it("canonical identity survives ordering, normalization and prose edits but changes revision", () => {
    expect(canonicalClaimId(RUN, 1, ["b", "a"], "  Duty   A ")).toBe(
      canonicalClaimId(RUN, 1, ["a", "b"], "duty a"),
    );
    expect(canonicalClaimId(RUN, 1, ["a"], "duty a")).not.toBe(
      canonicalClaimId(RUN, 2, ["a"], "duty a"),
    );
    const f = fixture(),
      id = f.graph.claims[0].claimId;
    f.graph.claims[0].statement += " clarified wording";
    expect(
      validateClaimInventory(RUN, 1, f.graph, f.identities, f.source).failures,
    ).toContainEqual(
      expect.objectContaining({ code: F.SEMANTIC_AUDIT_REQUIRED }),
    );
    expect(f.graph.claims[0].claimId).toBe(id);
  });
  it("fingerprint ignores set ordering, retaining all claim and relation meaning", () => {
    const f = fixture(),
      expected = inventoryFingerprint(1, f.graph);
    f.graph.claims.reverse();
    f.graph.sourceAccounting.reverse();
    f.graph.relations.reverse();
    f.graph.claims.forEach((c) => c.sourceNodeIds.reverse());
    f.graph.sourceAccounting.forEach((r) => r.claimIds.reverse());
    expect(inventoryFingerprint(1, f.graph)).toBe(expected);
    f.graph.claims[0].statement += " changed";
    expect(inventoryFingerprint(1, f.graph)).not.toBe(expected);
  });
  it("requires every source-bearing node's explicit review", () => {
    const f = fixture();
    f.graph.sourceAccounting.pop();
    expect(
      validateClaimInventory(RUN, 1, f.graph, f.identities, f.source).failures,
    ).toContainEqual(
      expect.objectContaining({ code: F.INCOMPLETE_STRUCTURAL_ACCOUNTING }),
    );
  });
  it("rejects unknown provenance, foreign source pins and broken relations before freezing", () => {
    const f = fixture();
    f.graph.claims[0].sourceNodeIds = ["foreign-node"];
    f.graph.legalSourceVersionId = "00000000-0000-4000-8000-000000000002";
    f.graph.relations.push({
      relationId: "broken",
      fromClaimId: "missing",
      toClaimId: f.graph.claims[0].claimId,
      kind: "CONDITION",
      referenceId: null,
    });
    const result = validateClaimInventory(
      RUN,
      1,
      f.graph,
      f.identities,
      f.source,
    );
    expect(
      result.failures.filter((g) => g.code === F.SEMANTIC_CLAIM_INVALID).length,
    ).toBeGreaterThanOrEqual(3);
  });
  it("rejects duplicate structured normative identities even under different stable keys", () => {
    const f = fixture(),
      original = f.graph.claims.find((c) => c.operative)!;
    const id = canonicalClaimId(RUN, 1, original.sourceNodeIds, "duplicate");
    f.graph.claims.push({ ...original, claimId: id });
    f.identities[id] = "duplicate";
    f.graph.sourceAccounting.forEach((r) => {
      if (original.sourceNodeIds.includes(r.sourceNodeId)) r.claimIds.push(id);
    });
    expect(
      validateClaimInventory(RUN, 1, f.graph, f.identities, f.source).failures,
    ).toContainEqual(
      expect.objectContaining({
        detail: "Duplicate structured claim identity",
      }),
    );
  });
  it("rejects missing freeze, stale revisions, graph edits and stale Requirement bindings", () => {
    const f = fixture(),
      frozen = { ...f.binding, graph: structuredClone(f.graph) };
    expect(validateFrozenInventory(f.packet, frozen, 1)).toEqual([]);
    expect(validateFrozenInventory(f.packet, null, 1)[0].code).toBe(
      F.claimInventoryRequired,
    );
    expect(validateFrozenInventory(f.packet, frozen, 2)[0].code).toBe(
      F.staleInventoryBinding,
    );
    f.packet.legalRequirements[0].claimInventoryRevision = 2;
    expect(validateFrozenInventory(f.packet, frozen, 1)[0].code).toBe(
      F.staleInventoryBinding,
    );
    f.packet.legalRequirements[0].claimInventoryRevision = 1;
    f.graph.claims[0].claimType = "CONTEXT";
    expect(validateFrozenInventory(f.packet, frozen, 1)[0].code).toBe(
      F.staleInventoryBinding,
    );
  });
  it("validates source accounting for thousands of claims with bounded indexed passes", () => {
    const f = fixture(),
      seed = f.graph.claims[0],
      nodes = seed.sourceNodeIds;
    f.graph.claims = [];
    f.graph.relations = [];
    const identities: Record<string, string> = {};
    for (let i = 0; i < 2000; i++) {
      const key = `context.${i}`,
        id = canonicalClaimId(RUN, 1, nodes, key);
      identities[id] = key;
      f.graph.claims.push({
        ...seed,
        claimId: id,
        // One operative and one applicability claim keep the scale fixture authoring-ready.
        claimType: i === 0 ? "DUTY" : i === 1 ? "CONDITION" : "CONTEXT",
        operative:
          i === 0
            ? { actor: "operator", modality: "DUTY", action: "perform" }
            : null,
        statement: key,
      });
      if (i)
        f.graph.relations.push({
          relationId: `relation-${i}`,
          kind: "CONDITION",
          fromClaimId: f.graph.claims[i - 1].claimId,
          toClaimId: id,
          referenceId: null,
        });
    }
    f.graph.sourceAccounting = f.graph.sourceAccounting.map((review) => ({
      ...review,
      claimIds: nodes.includes(review.sourceNodeId)
        ? f.graph.claims.map((c) => c.claimId)
        : [],
      nonSemanticReason: nodes.includes(review.sourceNodeId)
        ? null
        : "No further semantic material in this scripted scale fixture",
    }));
    const started = performance.now();
    // This fixture deliberately has unaudited, unanchored synthetic context claims.
    // Benchmark the structural accounting layer, not V3 semantic freeze approval.
    const structural = validateSemanticClaimGraph(
      { semanticGraph: f.graph, legalRequirements: [], assessmentRules: [], contextRelations: [] } as ReturnType<typeof validPacket>,
      f.source,
      true,
    );
    expect(structural.coverage.semanticClaims.relevant).toBe(2000);
    expect(structural.coverage.structuralSource.total).toBeGreaterThan(0);
    expect(performance.now() - started).toBeLessThan(3000);
  });
  describe("authoring readiness (CLAIM_INVENTORY_READY must be authorable)", () => {
    const operative = (f: ReturnType<typeof fixture>) =>
      f.graph.claims.filter((c) => c.operative && c.state === "RELEVANT");
    const withoutApplicability = (f: ReturnType<typeof fixture>) => {
      // Re-type every applicability-bearing claim as context so only the role matrix decides.
      for (const c of f.graph.claims)
        if (["SCOPE", "CONDITION"].includes(c.claimType))
          c.claimType = "CONTEXT";
      return f;
    };
    it("accepts an inventory carrying operative and applicability-bearing claims", () => {
      const f = fixture();
      expect(authoringReadinessGaps(f.graph)).toEqual([]);
    });
    it("rejects the retained shape: normative claims but no claim able to ground applicability", () => {
      const f = withoutApplicability(fixture());
      const gaps = authoringReadinessGaps(f.graph);
      // External-fulfillment and non-assessable operative assertions need no
      // repository applicability, unlike repository-verifiable anchors.
      const repositoryAnchors = operative(f).filter((c) =>
        !["EXTERNAL_FULFILLMENT", "NON_ASSESSABLE"].includes(c.assessability!),
      );
      expect(gaps.filter((g) => g.code === F.APPLICABILITY_AUTHORITY_MISSING).map((g) => g.ref).sort()).toEqual(
        repositoryAnchors.map((c) => `claim:${c.claimId}`).sort(),
      );
      expect(gaps[0].detail).toMatch(/CONDITION or SCOPE/);
      // The authoritative gate that freezes the inventory reports the same machine-readable gaps.
      expect(
        validateClaimInventory(RUN, 1, f.graph, f.identities, f.source)
          .failures,
      ).toEqual(expect.arrayContaining(gaps));
    });
    it.each([
      "DEFINITION",
      "CONTEXT",
      "TEMPORAL_RULE",
      "TRANSITION_RULE",
      "QUALIFIER",
      "EXCEPTION",
      "CROSS_REFERENCE",
      "DUTY",
      "PROHIBITION",
      "PERMISSION",
    ])("%s never satisfies applicability merely by existing", (claimType) => {
      const f = withoutApplicability(fixture());
      const seed = f.graph.claims.find((c) => c.claimType === "CONTEXT")!;
      f.graph.claims.push({
        ...seed,
        claimId: "extra",
        claimType: claimType as typeof seed.claimType,
        operative: null,
      });
      expect(authoringReadinessGaps(f.graph).map((g) => g.code)).toContain(
        F.APPLICABILITY_AUTHORITY_MISSING,
      );
    });
    it.each(["SCOPE", "CONDITION"])(
      "%s satisfies applicability",
      (claimType) => {
        const f = withoutApplicability(fixture());
        const seed = f.graph.claims.find((c) => c.claimType === "CONTEXT")!;
        f.graph.claims.push({
          ...seed,
          claimId: "extra",
          claimType: claimType as typeof seed.claimType,
          operative: null,
        });
        // A matching claim type without an authoritative target is insufficient.
        expect(authoringReadinessGaps(f.graph).map((g) => g.code)).toContain(
          F.APPLICABILITY_AUTHORITY_MISSING,
        );
        const scope = f.graph.claims.find((c) => c.claimId === "extra")!;
        scope.semanticAuthority = "LEGAL_NORMATIVE";
        for (const anchor of operative(f))
          f.graph.relations.push({
            relationId: `scope-to-${anchor.claimId}`,
            kind: "CONDITION_OF",
            fromClaimId: scope.claimId,
            toClaimId: anchor.claimId,
            referenceId: null,
          });
        expect(authoringReadinessGaps(f.graph)).toEqual([]);
      },
    );
    it("an excluded applicability claim grants nothing", () => {
      const f = fixture();
      for (const c of f.graph.claims)
        if (["SCOPE", "CONDITION"].includes(c.claimType)) {
          c.state = "INTENTIONALLY_NON_OPERATIVE";
          c.nonOperativeReason = "excluded";
        }
      expect(authoringReadinessGaps(f.graph).map((g) => g.code)).toContain(
        F.APPLICABILITY_AUTHORITY_MISSING,
      );
    });
    it("rejects an inventory with no relevant operative claim", () => {
      const f = fixture();
      for (const c of f.graph.claims)
        if (c.operative) {
          c.claimType = "CONTEXT";
          c.operative = null;
        }
      expect(authoringReadinessGaps(f.graph).map((g) => g.code)).toEqual([
        F.OPERATIVE_CLAIM_MISSING,
      ]);
    });
    it("a scoped diagnostic cannot prove whole-Rule-Set capability and skips the gate", () => {
      const f = withoutApplicability(fixture());
      const scope = new Set(
        f.graph.sourceAccounting.map((r) => r.sourceNodeId),
      );
      const codes = validateClaimInventory(
        RUN,
        1,
        f.graph,
        f.identities,
        f.source,
        scope,
      ).failures.map((g) => g.code);
      expect(codes).not.toContain(F.APPLICABILITY_AUTHORITY_MISSING);
    });
  });

  describe("terminal non-operative outcome (INV-C2)", () => {
    /** Every unit reviewed and independently audited; the only claims left are non-operative (a definition). */
    const auditedWithoutOperativeClaims = (keepDefinition = true) => {
      const f = fixture();
      const keep = new Set(
        keepDefinition
          ? f.graph.claims
              .filter((c) => c.claimType === "DEFINITION")
              .map((c) => c.claimId)
          : [],
      );
      f.graph.claims = f.graph.claims.filter((c) => keep.has(c.claimId));
      f.graph.relations = f.graph.relations.filter(
        (r) => keep.has(r.fromClaimId) && keep.has(r.toClaimId),
      );
      f.graph.sourceAccounting = f.graph.sourceAccounting.map((r) => {
        const claimIds = r.claimIds.filter((id) => keep.has(id));
        return {
          ...r,
          claimIds,
          nonSemanticReason: claimIds.length
            ? null
            : "States no semantic material",
        };
      });
      f.identities = Object.fromEntries(
        Object.entries(f.identities).filter(([id]) => keep.has(id)),
      );
      refreshStructuralAudits(f.graph, f.source.documentGraph!, 1);
      f.graph.semanticAudits = f.graph.semanticAudits!.map((receipt) =>
        signSemanticAuditFixture(receipt, RUN),
      );
      return f;
    };
    const gate = (f: ReturnType<typeof fixture>) =>
      validateClaimInventory(RUN, 1, f.graph, f.identities, f.source).failures;
    const codes = (failures: { code: string }[]) =>
      failures.map((g) => g.code);

    it.each([true, false])(
      "is available only for a fully reviewed, audited inventory whose single gap is the absence of an operative claim (definition kept: %s)",
      (keepDefinition) => {
        const f = auditedWithoutOperativeClaims(keepDefinition);
        const failures = gate(f);
        expect(codes(failures)).toEqual([F.OPERATIVE_CLAIM_MISSING]);
        expect(noOperativeObligationsFailures(f.graph, failures)).toEqual([]);
        expect(f.graph.claims.length).toBe(keepDefinition ? 1 : 0);
      },
    );

    it("is unavailable while any review unit is unreviewed and reports the existing accounting code", () => {
      const f = auditedWithoutOperativeClaims();
      f.graph.sourceAccounting.pop();
      const failures = gate(f);
      const refusal = noOperativeObligationsFailures(f.graph, failures);
      expect(codes(refusal)).toContain(F.INCOMPLETE_STRUCTURAL_ACCOUNTING);
      expect(codes(refusal)).not.toContain(F.OPERATIVE_CLAIM_MISSING);
    });

    it.each([
      [
        "missing",
        (f: ReturnType<typeof fixture>) => {
          f.graph.semanticAudits!.pop();
        },
      ],
      [
        "failed",
        (f: ReturnType<typeof fixture>) => {
          const receipt = f.graph.semanticAudits![0];
          receipt.verdict = "MISSING_ASSERTION";
          receipt.gaps = [
            { code: "MISSING_ASSERTION", detail: "A stated duty is absent" },
          ];
        },
      ],
      [
        "stale",
        (f: ReturnType<typeof fixture>) => {
          f.graph.semanticAudits![0].inventoryRevision = 2;
        },
      ],
    ])("is unavailable when one independent audit is %s", (_name, mutate) => {
      const f = auditedWithoutOperativeClaims();
      mutate(f);
      const refusal = noOperativeObligationsFailures(f.graph, gate(f));
      expect(codes(refusal)).toContain(F.SEMANTIC_AUDIT_REQUIRED);
      expect(codes(refusal)).not.toContain(F.OPERATIVE_CLAIM_MISSING);
    });

    it("is unavailable for a source that states a duty, whether the duty is relevant or excluded", () => {
      const f = fixture();
      const passing = gate(f);
      expect(passing).toEqual([]);
      const unavailable = noOperativeObligationsFailures(f.graph, passing);
      expect(codes(unavailable)).toEqual([F.claimPhaseInvalid]);
      // Even if a stale gate result still reported the missing operative claim, an operative-typed claim blocks it.
      expect(
        codes(
          noOperativeObligationsFailures(f.graph, [
            {
              code: F.OPERATIVE_CLAIM_MISSING,
              ref: "claimInventory",
              detail: null,
            },
          ]),
        ),
      ).toEqual([F.claimPhaseInvalid]);
      // Excluding the duty as non-operative removes it from readiness but cannot launder it into "no obligations".
      for (const claim of f.graph.claims.filter((c) => c.operative)) {
        claim.state = "INTENTIONALLY_NON_OPERATIVE";
        claim.nonOperativeReason = "Out of scope";
      }
      const excluded = gate(f);
      expect(codes(excluded)).toContain(F.OPERATIVE_CLAIM_MISSING);
      expect(codes(noOperativeObligationsFailures(f.graph, excluded))).toEqual(
        [F.claimPhaseInvalid],
      );
    });

    it("never infers the outcome from silence: an empty gate result with no operative claim is refused", () => {
      const f = auditedWithoutOperativeClaims();
      expect(codes(noOperativeObligationsFailures(f.graph, []))).toEqual([
        F.claimPhaseInvalid,
      ]);
    });

    it("keeps the readiness gate for an operative inventory unchanged", () => {
      const f = fixture();
      expect(gate(f)).toEqual([]);
      expect(authoringReadinessGaps(f.graph)).toEqual([]);
    });
  });
});
