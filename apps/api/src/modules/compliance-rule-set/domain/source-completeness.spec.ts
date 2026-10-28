import { describe, expect, it } from "@jest/globals";
import {
  LEGAL_CLAIM_ACCOUNTING_ROLES as ROLE,
  LEGAL_SEMANTIC_CLAIM_TYPES as C,
  LEGAL_SEMANTIC_RELATION_KINDS as R,
  SEMANTIC_INTEGRITY_GAP_CODES as G,
} from "@lcsp/contracts/compliance-rule-set";
import {
  fixtureLegalSource,
  validPacket,
} from "../../../../test/support/compliance-rule-set-fixtures.js";
import {
  requirementClosureFailures,
  semanticClosure,
  semanticTopologyFailures,
  sourceSupportFailures,
} from "./source-completeness.js";

describe("deterministic source support and complete modifier accounting", () => {
  it("rejects forged or foreign source spans without interpreting legal meaning", () => {
    const source = fixtureLegalSource().documentGraph!;
    const claim = validPacket().semanticGraph!.claims[0];
    expect(sourceSupportFailures(claim, source)).toEqual([]);
    const forged = structuredClone(claim);
    forged.sourceSupport![0].contentSha256 = "0".repeat(64);
    expect(sourceSupportFailures(forged, source)).not.toEqual([]);
    const foreign = structuredClone(claim);
    foreign.sourceNodeIds = ["foreign-node"];
    expect(sourceSupportFailures(foreign, source)).toContain(
      G.SOURCE_SUPPORT_ANCHOR_MISMATCH,
    );
  });

  it.each([
    [C.SCOPE, R.CONDITION_OF, ROLE.APPLICABILITY_CONDITION],
    [C.CONDITION, R.CONDITION_OF, ROLE.APPLICABILITY_CONDITION],
    [C.EXCEPTION, R.EXCEPTION_TO, ROLE.EXCEPTION],
    [C.QUALIFIER, R.QUALIFIES, ROLE.QUALIFIER],
    [C.TEMPORAL_RULE, R.TEMPORALLY_APPLIES_TO, ROLE.QUALIFIER],
    [C.TRANSITION_RULE, R.TEMPORALLY_APPLIES_TO, ROLE.QUALIFIER],
  ] as const)(
    "preserves %s through closure and rejects its omission",
    (type, kind, role) => {
      const packet = validPacket();
      const graph = packet.semanticGraph!;
      const requirement = packet.legalRequirements[0];
      const anchorId = requirement.claimBindings!.find(
        (b) => b.role === ROLE.OPERATIVE_PROPOSITION,
      )!.claimId;
      const anchor = graph.claims.find((c) => c.claimId === anchorId)!;
      const modifier = {
        ...structuredClone(anchor),
        claimId: `retained-${type}`,
        claimType: type,
        operative: null,
      };
      graph.claims.push(modifier);
      graph.relations.push({
        relationId: `retained-${kind}`,
        fromClaimId: modifier.claimId,
        toClaimId: anchorId,
        kind,
        referenceId: null,
      });
      expect(semanticClosure(graph, anchorId).claims).toContainEqual({
        claimId: modifier.claimId,
        role,
      });
      expect(
        requirementClosureFailures(
          graph,
          requirement.claimBindings!,
          false,
          false,
        ),
      ).toContain(G.INCOMPLETE_SEMANTIC_CLOSURE);
      graph.relations = graph.relations.filter(
        (r) => r.fromClaimId !== modifier.claimId,
      );
      expect(semanticTopologyFailures(graph)).toContain(
        `${G.UNANCHORED_MODIFIER}:${modifier.claimId}`,
      );
    },
  );

  it("rejects repository-assessable or mixed duties configured as non-repository or non-assessable", () => {
    const packet = validPacket();
    const graph = packet.semanticGraph!;
    const requirement = packet.legalRequirements[0];
    const anchorId = requirement.claimBindings!.find(
      (b) => b.role === ROLE.OPERATIVE_PROPOSITION,
    )!.claimId;
    const anchor = graph.claims.find((c) => c.claimId === anchorId)!;
    anchor.assessability = "MIXED";

    // When anchor is MIXED, nonRepositoryDuty=true must fail
    expect(
      requirementClosureFailures(
        graph,
        requirement.claimBindings!,
        true,
        false,
      ),
    ).toContain(G.REPOSITORY_ASSESSABLE_DUTY_NOT_COVERED);

    // When anchor is MIXED, nonAssessable=true must fail
    expect(
      requirementClosureFailures(
        graph,
        requirement.claimBindings!,
        false,
        true,
      ),
    ).toContain(G.REPOSITORY_ASSESSABLE_DUTY_NOT_COVERED);

    // When properly configured as covered by rules and repository duty, passes
    expect(
      requirementClosureFailures(
        graph,
        requirement.claimBindings!,
        false,
        false,
      ),
    ).toEqual([]);
  });
});
