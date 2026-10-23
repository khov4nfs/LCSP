import { describe, expect, it } from "@jest/globals";
import {
  LEGAL_SEMANTIC_AUTHORITIES as A,
  LEGAL_SEMANTIC_CLAIM_TYPES as C,
  LEGAL_SEMANTIC_RELATION_KINDS as R,
  SEMANTIC_SOURCE_DEPENDENCIES as D,
  SEMANTIC_SOURCE_MODALITIES as M,
  SEMANTIC_SOURCE_OPERATOR_POLARITIES as F,
  SEMANTIC_SOURCE_DEPENDENCY_EFFECTS as E,
  SEMANTIC_SOURCE_ROLES as S,
  SEMANTIC_SOURCE_REPRESENTATIONS as P,
  SEMANTIC_INTEGRITY_GAP_CODES as G,
  type SemanticSourceCatalog,
  type SemanticSourceCoverage,
} from "@lcsp/contracts/compliance-rule-set";
import { createHash } from "node:crypto";
import {
  validPacket,
  fixtureLegalSource,
} from "../../../../test/support/compliance-rule-set-fixtures.js";
import { structuralReceipt } from "../../../../test/support/structural-semantic-fixture.js";
import {
  semanticAuditInput,
  semanticAuditReceiptFailures,
  semanticCompletenessInput,
} from "./semantic-audit.js";
import {
  semanticSourceMaterialInput,
  semanticSourceCatalogCurrent,
  semanticSourceCoveragePassed,
  semanticSourceSpans,
  semanticDependencyEffectInput,
  semanticEffectiveClassification,
  semanticSourceRoleInput,
} from "./source-completeness.js";
import { inventoryHash } from "./claim-inventory.js";

function fixture() {
  const packet = validPacket(),
    source = fixtureLegalSource().documentGraph!;
  const claim = packet.semanticGraph!.claims.find(
    (c) => c.claimType === C.DUTY,
  )!;
  const input = semanticAuditInput(
    source,
    packet.semanticGraph!,
    claim.sourceNodeIds[0],
    1,
  );
  const unit = input.sources.find((n) => n.completenessTarget)!;
  const catalog: SemanticSourceCatalog = {
    sourceInputFingerprint: inventoryHash(semanticSourceMaterialInput(input)),
    verifierOperationId: "00000000-0000-4000-8000-000000000001",
    facts: [
      {
        id: "duty",
        dependency: D.NONE,
        modality: M.DUTY,
        semanticAuthority: A.LEGAL_NORMATIVE,
        quote: unit.content,
        meaning: "Scripted source material for integrity tests",
        sourceSupport: {
          nodeId: unit.nodeId,
          startOffset: 0,
          endOffset: unit.content.length,
          contentSha256: createHash("sha256")
            .update(unit.content)
            .digest("hex"),
        },
      },
    ],
    noMaterialReason: null,
    nonMaterialSpans: [],
    reviewedReading: {
      verifierOperationId: "00000000-0000-4000-8000-000000000003",
      facts: [],
      noMaterialReason: null,
      nonMaterialSpans: [],
    },
    dependencyAudit: null,
    classification: {
      verifierOperationId: "00000000-0000-4000-8000-000000000001",
      inputFingerprint: "0".repeat(64),
      readings: [
        {
          id: "duty",
          addressee: "actor",
          sourceRole: A.LEGAL_NORMATIVE,
          modalOperator: M.DUTY,
          operatorPolarity: F.AFFIRMED,
          dependency: D.NONE,
        },
      ],
    },
    initialReading: {
      verifierOperationId: "00000000-0000-4000-8000-000000000002",
      facts: [],
      noMaterialReason: "Scripted initial source reading",
      nonMaterialSpans: semanticSourceMaterialInput(input).sourceSpans.map(
        (s) => ({ spanId: s.id, reason: "Mechanical fixture only" }),
      ),
    },
  };
  catalog.reviewedReading.facts = catalog.facts.map(
    ({ modality: _, dependency: __, semanticAuthority: ___, ...fact }) => {
      void [_, __, ___];
      return fact;
    },
  );
  catalog.classification.inputFingerprint = inventoryHash(
    semanticSourceRoleInput(
      semanticSourceMaterialInput(input),
      catalog.reviewedReading,
    ),
  );
  const coverage: SemanticSourceCoverage = [
    {
      sourceId: "duty",
      representation: P.ASSERTION,
      claimIds: [claim.claimId],
      relationIds: [],
      finding: null,
    },
  ];
  return {
    input,
    catalog,
    coverage,
    claim: input.claims.find((c) => c.claimId === claim.claimId)!,
  };
}

describe("independent source material coverage integrity (scripted facts, not legal acceptance)", () => {
  it("requires the full owned neighborhood for a selected semantic unit", () => {
    const { input, catalog, coverage, claim } = fixture();
    coverage[0].representation = P.SEMANTIC_UNIT;
    coverage[0].relationIds = input.relations
      .filter((r) => r.fromClaimId === claim.claimId)
      .map((r) => r.relationId);
    expect(semanticSourceCoveragePassed(input, catalog, coverage)).toBe(true);
    if (coverage[0].relationIds.length) coverage[0].relationIds.pop();
    else coverage[0].relationIds.push("unknown");
    expect(semanticSourceCoveragePassed(input, catalog, coverage)).toBe(false);
  });
  it("keeps the complete canonical heading selectable apart from the body", () => {
    const { input } = fixture();
    const unit = input.sources.find((n) => n.completenessTarget)!;
    const heading = "Article X. Retention 📁";
    const body = "The operator must retain the export log.";
    Object.assign(unit, {
      label: "X",
      title: "Retention 📁",
      content: heading + "\n" + body,
    });
    const spans = semanticSourceSpans(unit);
    expect(spans.map((span) => span.quote)).toEqual([heading, body]);
    expect(spans[0].sourceSupport.endOffset).toBe(heading.length);
    expect(spans[1].sourceSupport.startOffset).toBe(heading.length + 1);
    expect(spans[1].sourceSupport.contentSha256).toBe(
      createHash("sha256").update(body).digest("hex"),
    );
  });
  it("uses canonical heading metadata only for non-operative structural context", () => {
    const { input, catalog, coverage } = fixture();
    const unit = input.sources.find((n) => n.completenessTarget)!;
    const heading = "Article X. Retention";
    unit.label = "X";
    unit.title = "Retention";
    unit.content = heading + "\n" + unit.content;
    Object.assign(catalog.facts[0], {
      semanticAuthority: A.CONTEXT,
      modality: M.NON_OPERATIVE,
      quote: heading,
      sourceSupport: {
        nodeId: unit.nodeId,
        startOffset: 0,
        endOffset: heading.length,
        contentSha256: createHash("sha256").update(heading).digest("hex"),
      },
    });
    coverage[0].representation = P.SOURCE_STRUCTURE;
    coverage[0].claimIds = [];
    expect(semanticSourceCoveragePassed(input, catalog, coverage)).toBe(true);
    catalog.facts[0].semanticAuthority = A.LEGAL_NORMATIVE;
    expect(semanticSourceCoveragePassed(input, catalog, coverage)).toBe(false);
    catalog.facts[0].semanticAuthority = A.CONTEXT;
    catalog.facts[0].sourceSupport.startOffset = heading.length + 1;
    catalog.facts[0].sourceSupport.endOffset = unit.content.length;
    expect(semanticSourceCoveragePassed(input, catalog, coverage)).toBe(false);
  });
  it("keeps AST numbering structural without absorbing body text or decimals", () => {
    const { input, catalog, coverage } = fixture();
    const unit = input.sources.find((n) => n.completenessTarget)!;
    unit.label = "2";
    unit.title = "";
    unit.content = "2. " + unit.content;
    Object.assign(catalog.facts[0], {
      semanticAuthority: A.CONTEXT,
      modality: M.NON_OPERATIVE,
      quote: "2.",
      sourceSupport: {
        nodeId: unit.nodeId,
        startOffset: 0,
        endOffset: 2,
        contentSha256: createHash("sha256").update("2.").digest("hex"),
      },
    });
    coverage[0].representation = P.SOURCE_STRUCTURE;
    coverage[0].claimIds = [];
    expect(semanticSourceCoveragePassed(input, catalog, coverage)).toBe(true);
    catalog.facts[0].sourceSupport.endOffset = unit.content.length;
    expect(semanticSourceCoveragePassed(input, catalog, coverage)).toBe(false);
    unit.content = "2.5 is a threshold, not the paragraph label.";
    expect(
      semanticSourceMaterialInput(input).sourceStructure.headingSupport,
    ).toBeNull();
  });
  it("resolves repeated source text to distinct exact UTF16 spans", () => {
    const { input } = fixture();
    const unit = {
      ...input.sources[0],
      content: "😀  Same sentence.\n Same sentence.\nĐiều kiện khác。",
    };
    const spans = semanticSourceSpans(unit);
    expect(spans).toHaveLength(3);
    expect(new Set(spans.map((s) => s.id)).size).toBe(3);
    expect(spans[1].quote).toBe("Same sentence.");
    for (const span of spans) {
      expect(
        unit.content.slice(
          span.sourceSupport.startOffset,
          span.sourceSupport.endOffset,
        ),
      ).toBe(span.quote);
      expect(createHash("sha256").update(span.quote).digest("hex")).toBe(
        span.sourceSupport.contentSha256,
      );
    }
  });
  it("keeps blind source inventory input independent of Producer claims and edges", () => {
    const { input } = fixture();
    expect(
      semanticSourceMaterialInput({
        ...input,
        claims: [],
        contextClaims: [],
        relations: [],
        inventoryRevision: 99,
      }),
    ).toEqual(semanticSourceMaterialInput(input));
  });
  it("requires current exact support and unique source identities", () => {
    const { input, catalog } = fixture();
    expect(semanticSourceCatalogCurrent(input, catalog)).toBe(true);
    catalog.facts[0].sourceSupport.contentSha256 = "0".repeat(64);
    expect(semanticSourceCatalogCurrent(input, catalog)).toBe(false);
    catalog.facts.push(catalog.facts[0]);
    expect(semanticSourceCatalogCurrent(input, catalog)).toBe(false);
  });
  it("does not map a source duty to permission/condition or an unsupported definition", () => {
    const { input, catalog, coverage, claim } = fixture();
    expect(semanticSourceCoveragePassed(input, catalog, coverage)).toBe(true);
    claim.claimType = C.CONDITION;
    claim.operative = null;
    expect(semanticSourceCoveragePassed(input, catalog, coverage)).toBe(false);
    catalog.facts[0].semanticAuthority = A.DEFINITION;
    coverage[0].representation = P.DEFINITION_BINDING;
    expect(semanticSourceCoveragePassed(input, catalog, coverage)).toBe(false);
  });
  it("keeps expressed force and representation constraints separate from legal authority", () => {
    const { input, catalog, coverage } = fixture();
    const role = catalog.classification.readings[0];
    role.sourceRole = S.EVIDENCE_GUIDANCE;
    role.modalOperator = M.PERMISSION;
    catalog.facts[0].semanticAuthority = A.EVIDENCE_GUIDANCE;
    catalog.facts[0].modality = M.PERMISSION;
    expect(semanticSourceCatalogCurrent(input, catalog)).toBe(true);
    role.sourceRole = S.REPRESENTATION_GUIDANCE;
    role.modalOperator = M.NON_OPERATIVE;
    role.dependency = D.PRESERVATION;
    Object.assign(catalog.facts[0], {
      semanticAuthority: A.CONTEXT,
      modality: M.NON_OPERATIVE,
      dependency: D.PRESERVATION,
    });
    catalog.dependencyAudit = {
      inputFingerprint: inventoryHash(
        semanticDependencyEffectInput(
          semanticSourceMaterialInput(input),
          catalog,
        ),
      ),
      verifierOperationId: catalog.verifierOperationId,
      readings: [
        {
          id: "duty",
          effect: E.OTHER,
          effectStatement: "Synthetic unchanged classification",
        },
      ],
    };
    expect(semanticSourceCatalogCurrent(input, catalog)).toBe(true);
    expect(semanticSourceCoveragePassed(input, catalog, coverage)).toBe(true);
    role.sourceRole = S.LEGAL_NORMATIVE;
    catalog.facts[0].semanticAuthority = A.LEGAL_NORMATIVE;
    expect(semanticSourceCatalogCurrent(input, catalog)).toBe(true);
    expect(semanticSourceCoveragePassed(input, catalog, coverage)).toBe(false);
  });
  it.each([
    [E.ACTUAL_PERFORMANCE_NOT_ESTABLISHED, A.CONTEXT, D.EXPLANATION, true],
    [E.LEGAL_POSITION_CONTINUES, A.LEGAL_NORMATIVE, D.PRESERVATION, false],
  ])(
    "binds the source-only %s effect without erasing required legal edges",
    (effect, authority, dependency, covered) => {
      const { input, catalog, coverage } = fixture();
      catalog.classification.readings[0].dependency = D.PRESERVATION;
      const question = semanticDependencyEffectInput(
        semanticSourceMaterialInput(input),
        catalog,
      );
      expect(question).not.toHaveProperty("sourceSpans");
      catalog.dependencyAudit = {
        inputFingerprint: inventoryHash(question),
        verifierOperationId: catalog.verifierOperationId,
        readings: [
          {
            id: "duty",
            effect,
            effectStatement:
              "Synthetic source effect; no model acceptance claimed",
          },
        ],
      };
      Object.assign(catalog.facts[0], {
        semanticAuthority: authority,
        modality: M.NON_OPERATIVE,
        dependency,
      });
      expect(semanticEffectiveClassification(catalog)[0].modalOperator).toBe(
        M.NON_OPERATIVE,
      );
      expect(semanticSourceCatalogCurrent(input, catalog)).toBe(true);
      expect(semanticSourceCoveragePassed(input, catalog, coverage)).toBe(
        covered,
      );
      const audit = structuredClone(catalog.dependencyAudit);
      for (const invalid of [
        null,
        { ...audit, inputFingerprint: "0".repeat(64) },
        { ...audit, readings: [] },
        { ...audit, readings: [...audit.readings, ...audit.readings] },
      ]) {
        catalog.dependencyAudit = invalid;
        expect(semanticSourceCatalogCurrent(input, catalog)).toBe(false);
      }
    },
  );
  it.each([M.DUTY, M.PROHIBITION, M.PERMISSION])(
    "retains a denied %s without inventing its opposite",
    (operator) => {
      const { input, catalog } = fixture();
      const role = catalog.classification.readings[0];
      role.modalOperator = operator;
      role.operatorPolarity = F.DENIED;
      catalog.facts[0].modality = M.NON_OPERATIVE;
      expect(semanticSourceCatalogCurrent(input, catalog)).toBe(true);
      role.operatorPolarity = F.AFFIRMED;
      expect(semanticSourceCatalogCurrent(input, catalog)).toBe(false);
      catalog.facts[0].modality = operator;
      expect(semanticSourceCatalogCurrent(input, catalog)).toBe(true);
      role.modalOperator = M.NON_OPERATIVE;
      role.operatorPolarity = F.DENIED;
      catalog.facts[0].modality = M.NON_OPERATIVE;
      expect(semanticSourceCatalogCurrent(input, catalog)).toBe(false);
    },
  );
  it.each([
    [S.EVIDENCE_GUIDANCE, F.AFFIRMED],
    [S.ASSESSMENT_GUIDANCE, F.AFFIRMED],
    [S.REPRESENTATION_GUIDANCE, F.AFFIRMED],
    [S.LEGAL_NORMATIVE, F.DENIED],
  ])("allows an impersonal %s with %s force", (sourceRole, polarity) => {
    const { input, catalog } = fixture();
    const role = catalog.classification.readings[0];
    role.addressee = null;
    role.sourceRole = sourceRole;
    role.operatorPolarity = polarity;
    catalog.facts[0].semanticAuthority =
      sourceRole === S.REPRESENTATION_GUIDANCE ? A.CONTEXT : sourceRole;
    catalog.facts[0].modality =
      polarity === F.AFFIRMED ? M.DUTY : M.NON_OPERATIVE;
    expect(semanticSourceCatalogCurrent(input, catalog)).toBe(true);
    role.sourceRole = S.LEGAL_NORMATIVE;
    role.operatorPolarity = F.AFFIRMED;
    catalog.facts[0].semanticAuthority = A.LEGAL_NORMATIVE;
    catalog.facts[0].modality = M.DUTY;
    expect(semanticSourceCatalogCurrent(input, catalog)).toBe(false);
  });
  it.each([
    R.CONDITION_OF,
    R.QUALIFIES,
    R.EXCEPTION_TO,
    R.TEMPORALLY_APPLIES_TO,
  ])("allows an owned %s modifier to bind its normative target", (kind) => {
    const { input, catalog, coverage, claim } = fixture();
    const target = structuredClone(claim);
    target.claimId = "norm";
    input.contextClaims.push(target);
    claim.claimType = C.CONDITION;
    claim.operative = null;
    input.relations = [
      {
        relationId: "binding",
        kind,
        fromClaimId: claim.claimId,
        toClaimId: target.claimId,
        referenceId: null,
      },
    ];
    coverage[0].representation = P.SEMANTIC_UNIT;
    coverage[0].relationIds = ["binding"];
    expect(semanticSourceCoveragePassed(input, catalog, coverage)).toBe(true);
    input.relations[0].kind = R.CROSS_REFERENCE;
    expect(semanticSourceCoveragePassed(input, catalog, coverage)).toBe(false);
    input.relations[0].kind = kind;
    target.claimType = C.PERMISSION;
    target.operative = { ...target.operative!, modality: M.PERMISSION };
    expect(semanticSourceCoveragePassed(input, catalog, coverage)).toBe(false);
    input.relations[0].fromClaimId = target.claimId;
    expect(semanticSourceCoveragePassed(input, catalog, coverage)).toBe(false);
  });
  it("requires actual owned preservation edges and allows a preserving evidence slice", () => {
    const { input, catalog, coverage, claim } = fixture();
    catalog.facts[0].dependency = D.PRESERVATION;
    catalog.facts[0].modality = M.NON_OPERATIVE;
    coverage[0].representation = P.RELATION;
    expect(semanticSourceCoveragePassed(input, catalog, coverage)).toBe(false);
    input.relations = [
      {
        relationId: "edge",
        kind: R.EXCEPTION_TO,
        fromClaimId: claim.claimId,
        toClaimId: claim.claimId,
        referenceId: null,
      },
    ];
    coverage[0].claimIds = [];
    coverage[0].relationIds = ["edge"];
    expect(semanticSourceCoveragePassed(input, catalog, coverage)).toBe(false);
    input.relations[0].kind = R.EVIDENCE_SLICE_OF;
    expect(semanticSourceCoveragePassed(input, catalog, coverage)).toBe(true);
    input.relations[0].fromClaimId = "outside";
    expect(semanticSourceCoveragePassed(input, catalog, coverage)).toBe(false);
  });
  it("blocks a supported receipt with missing coverage or a stale catalog at freeze", () => {
    const { input, catalog, coverage } = fixture();
    const receipt = structuralReceipt(input);
    receipt.sourceCatalog = catalog;
    receipt.completenessAudit = {
      ...receipt.completenessAudit,
      inputFingerprint: inventoryHash(
        semanticCompletenessInput(input, catalog),
      ),
      coverage,
    };
    expect(semanticAuditReceiptFailures(input, receipt)).toEqual([]);
    receipt.completenessAudit.coverage = [];
    expect(semanticAuditReceiptFailures(input, receipt)).toEqual([
      G.COMPLETENESS_AUDIT_REQUIRED,
    ]);
    receipt.completenessAudit.coverage = coverage;
    catalog.sourceInputFingerprint = "0".repeat(64);
    expect(semanticAuditReceiptFailures(input, receipt)).toEqual([
      G.COMPLETENESS_AUDIT_REQUIRED,
    ]);
  });

  it("accepts single-pass independent review receipts via deterministic integrity validation", () => {
    const { input } = fixture();
    const receipt = structuralReceipt(input);
    const singlePassReceipt = {
      ...receipt,
      sourceCatalog: undefined,
      completenessAudit: undefined,
      relationAudits: [],
      relatedSourceCatalogs: [],
      sourceConceptAudit: null,
    };
    expect(semanticAuditReceiptFailures(input, singlePassReceipt)).toEqual([]);
  });
});
