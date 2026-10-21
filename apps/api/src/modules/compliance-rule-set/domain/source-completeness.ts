/** Validate verifier-declared source coverage; semantic classification remains the model's responsibility. */
import { createHash } from "node:crypto";
import {
  LEGAL_SEMANTIC_AUTHORITIES as A,
  LEGAL_SEMANTIC_RELATION_KINDS as R,
  SEMANTIC_SOURCE_DEPENDENCIES as D,
  SEMANTIC_SOURCE_ROLES as S,
  SEMANTIC_SOURCE_MODALITIES as M,
  SEMANTIC_SOURCE_OPERATOR_POLARITIES as F,
  SEMANTIC_SOURCE_DEPENDENCY_EFFECTS as E,
  SEMANTIC_SOURCE_REPRESENTATIONS as P,
  type SemanticSourceCatalog,
  type SemanticSourceCoverage,
} from "@lcsp/contracts/compliance-rule-set";
import type { semanticAuditInput } from "./semantic-audit.js";
import { inventoryHash } from "./claim-inventory.js";

type Input = ReturnType<typeof semanticAuditInput>;
const normativeBindings = new Set<string>([
  R.INCORPORATES,
  R.PRESERVES,
  R.CONDITION_OF,
  R.QUALIFIES,
  R.EXCEPTION_TO,
  R.TEMPORALLY_APPLIES_TO,
]);
export function semanticSourceRoleInput(
  material: ReturnType<typeof semanticSourceMaterialInput>,
  reading: Pick<SemanticSourceCatalog["reviewedReading"], "facts">,
) {
  const { sourceSpans: _locatorSpans, ...source } = material;
  void _locatorSpans;
  return {
    ...source,
    propositions: reading.facts.map((fact) => ({
      id: fact.id,
      proposedMeaning: fact.meaning,
      ownedEvidence: { quote: fact.quote, sourceSupport: fact.sourceSupport },
    })),
  };
}

export function semanticDependencyEffectInput(
  material: ReturnType<typeof semanticSourceMaterialInput>,
  catalog: SemanticSourceCatalog,
) {
  const ids = new Set(
    catalog.classification.readings
      .filter((r) => r.dependency === D.PRESERVATION)
      .map((r) => r.id),
  );
  const { propositions, ...source } = semanticSourceRoleInput(
    material,
    catalog.reviewedReading,
  );
  return { ...source, facts: propositions.filter((f) => ids.has(f.id)) };
}

export function semanticEffectiveClassification(
  catalog: SemanticSourceCatalog,
) {
  const effects = new Map(
    catalog.dependencyAudit?.readings.map((r) => [r.id, r.effect]),
  );
  return catalog.classification.readings.map((row) => {
    const effect = effects.get(row.id);
    const target =
      effect === E.LEGAL_POSITION_CONTINUES
        ? ([A.LEGAL_NORMATIVE, D.PRESERVATION] as const)
        : effect === E.ACTUAL_PERFORMANCE_NOT_ESTABLISHED
          ? ([A.CONTEXT, D.EXPLANATION] as const)
          : effect === E.ASSESSMENT_SCOPE_ONLY
            ? ([A.EVIDENCE_GUIDANCE, D.EVIDENCE_LIMIT] as const)
            : effect === E.REPRESENTATION_MEANING_RETAINED
              ? ([S.REPRESENTATION_GUIDANCE, D.PRESERVATION] as const)
              : null;
    return target
      ? {
          ...row,
          sourceRole: target[0],
          dependency: target[1],
          modalOperator: M.NON_OPERATIVE,
          operatorPolarity: F.AFFIRMED,
          addressee: null,
        }
      : row;
  });
}
export function semanticSourceMaterialInput(input: Input) {
  const nodes = new Map(input.sources.map((n) => [n.nodeId, n]));
  const unit = nodes.get(input.sourceNodeId)!;
  const within = (id: string, root: string) =>
    id === root ||
    !!nodes
      .get(id)
      ?.structuralPath.startsWith(nodes.get(root)!.structuralPath + "/");
  const targets = input.references
    .filter((r) => nodes.has(r.fromNodeId) && within(r.fromNodeId, unit.nodeId))
    .flatMap((r) => (r.toNodeId && nodes.has(r.toNodeId) ? [r.toNodeId] : []));
  const source = (n: typeof unit) => ({
    nodeId: n.nodeId,
    structuralPath: n.structuralPath,
    content: n.content,
    legalEffectStatus: n.legalEffectStatus,
  });
  return {
    schemaRevision: input.schemaRevision,
    sourceRevision: input.sourceRevision,
    sourceNodeId: unit.nodeId,
    source: source(unit),
    sourceStructure: semanticSourceStructure(unit),
    sourceSpans: semanticSourceSpans(unit),
    references: input.references.filter(
      (r) => nodes.has(r.fromNodeId) && within(r.fromNodeId, unit.nodeId),
    ),
    referenceSources: input.sources
      .filter((n) => targets.some((t) => within(n.nodeId, t)))
      .map(source),
  };
}

function semanticSourceStructure(unit: Input["sources"][number]) {
  const heading = unit.content.split("\n", 1)[0];
  const marker = unit.label ? `${unit.label}.` : null;
  const structuralText =
    unit.title && heading.endsWith(unit.title)
      ? heading
      : marker &&
          unit.content.startsWith(marker) &&
          (unit.content.length === marker.length ||
            /\s/u.test(unit.content[marker.length]))
        ? marker
        : null;
  const headingSupport = structuralText
    ? {
        nodeId: unit.nodeId,
        startOffset: 0,
        endOffset: structuralText.length,
        contentSha256: createHash("sha256")
          .update(structuralText)
          .digest("hex"),
      }
    : null;
  return {
    nodeType: unit.nodeType,
    label: unit.label,
    title: unit.title,
    headingSupport,
  };
}

export function semanticSourceSpans(unit: Input["sources"][number]) {
  const spans: Array<{
    id: string;
    quote: string;
    sourceSupport: SemanticSourceCatalog["facts"][number]["sourceSupport"];
  }> = [];
  const boundary = semanticSourceStructure(unit).headingSupport?.endOffset ?? 0;
  // Keep canonical structure selectable without forcing its support into the body.
  const ranges = [
    ...(boundary ? [{ text: unit.content.slice(0, boundary), offset: 0 }] : []),
    ...Array.from(
      unit.content
        .slice(boundary)
        .matchAll(/[^.!?。！？]+[.!?。！？]*|[.!?。！？]+/gu),
      (match) => ({ text: match[0], offset: boundary + match.index }),
    ),
  ];
  for (const range of ranges) {
    const text = range.text.trim();
    let startOffset =
      range.offset + range.text.length - range.text.trimStart().length;
    const characters = Array.from(text);
    for (let i = 0; i < characters.length; i += 2000) {
      const quote = characters.slice(i, i + 2000).join("");
      const sourceSupport = {
        nodeId: unit.nodeId,
        startOffset,
        endOffset: startOffset + quote.length,
        contentSha256: createHash("sha256").update(quote).digest("hex"),
      };
      const id = createHash("sha256")
        .update(
          `${unit.nodeId}:${sourceSupport.startOffset}:${sourceSupport.endOffset}:${sourceSupport.contentSha256}`,
        )
        .digest("hex")
        .slice(0, 24);
      spans.push({ id, quote, sourceSupport });
      startOffset = sourceSupport.endOffset;
    }
  }
  return spans;
}

export function semanticSourceCatalogCurrent(
  input: Input,
  catalog: SemanticSourceCatalog | undefined,
) {
  if (
    !catalog ||
    catalog.sourceInputFingerprint !==
      inventoryHash(semanticSourceMaterialInput(input)) ||
    new Set(catalog.facts.map((f) => f.id)).size !== catalog.facts.length ||
    !!catalog.facts.length === !!catalog.noMaterialReason
  )
    return false;
  const unit = input.sources.find((n) => n.nodeId === input.sourceNodeId)!;
  const initial = catalog.initialReading;
  const reviewed = catalog.reviewedReading;
  const classification = catalog.classification;
  if (
    !initial ||
    !reviewed ||
    !classification ||
    classification.verifierOperationId !== catalog.verifierOperationId ||
    new Set(initial.facts.map((f) => f.id)).size !== initial.facts.length ||
    !!initial.facts.length === !!initial.noMaterialReason ||
    new Set(reviewed.facts.map((f) => f.id)).size !== reviewed.facts.length ||
    !!reviewed.facts.length === !!reviewed.noMaterialReason ||
    classification.readings.length !== reviewed.facts.length ||
    classification.readings.some(
      (r) =>
        (r.sourceRole === A.LEGAL_NORMATIVE &&
          r.operatorPolarity === F.AFFIRMED &&
          r.modalOperator !== M.NON_OPERATIVE &&
          r.addressee === null) ||
        (r.modalOperator === M.NON_OPERATIVE &&
          r.operatorPolarity === F.DENIED),
    ) ||
    new Set(classification.readings.map((r) => r.id)).size !==
      reviewed.facts.length ||
    classification.inputFingerprint !==
      inventoryHash(
        semanticSourceRoleInput(semanticSourceMaterialInput(input), reviewed),
      )
  )
    return false;
  const effectQuestion = semanticDependencyEffectInput(
    semanticSourceMaterialInput(input),
    catalog,
  );
  const effects = catalog.dependencyAudit;
  if (effectQuestion.facts.length) {
    const ids = new Set(effectQuestion.facts.map((f) => f.id));
    if (
      !effects ||
      effects.inputFingerprint !== inventoryHash(effectQuestion) ||
      effects.readings.length !== ids.size ||
      new Set(effects.readings.map((r) => r.id)).size !== ids.size ||
      effects.readings.some((r) => !ids.has(r.id))
    )
      return false;
  } else if (effects !== null) return false;
  const roles = new Map(
    semanticEffectiveClassification(catalog).map((r) => [r.id, r]),
  );
  const projected = reviewed.facts.map((f) => {
    const r = roles.get(f.id);
    if (
      !r ||
      (r.sourceRole === A.LEGAL_NORMATIVE &&
        r.operatorPolarity === F.AFFIRMED &&
        r.modalOperator !== M.NON_OPERATIVE &&
        r.addressee === null) ||
      (r.modalOperator === M.NON_OPERATIVE && r.operatorPolarity === F.DENIED)
    )
      return null;
    return {
      ...f,
      dependency: r.dependency,
      modality:
        r.operatorPolarity === F.AFFIRMED ? r.modalOperator : M.NON_OPERATIVE,
      semanticAuthority:
        r.sourceRole === S.REPRESENTATION_GUIDANCE ? A.CONTEXT : r.sourceRole,
    };
  });
  if (
    projected.some((f) => f === null) ||
    inventoryHash(projected) !== inventoryHash(catalog.facts) ||
    inventoryHash(reviewed.nonMaterialSpans) !==
      inventoryHash(catalog.nonMaterialSpans) ||
    reviewed.noMaterialReason !== catalog.noMaterialReason
  )
    return false;
  const spans = semanticSourceSpans(unit);
  if (
    ![catalog, initial, reviewed].every((reading) => {
      const excluded = new Set(reading.nonMaterialSpans.map((s) => s.spanId));
      return (
        excluded.size === reading.nonMaterialSpans.length &&
        [...excluded].every((id) => spans.some((s) => s.id === id)) &&
        spans.every(
          (span) =>
            reading.facts.some(
              (f) =>
                f.sourceSupport.startOffset <= span.sourceSupport.startOffset &&
                f.sourceSupport.endOffset >= span.sourceSupport.endOffset,
            ) !== excluded.has(span.id),
        )
      );
    })
  )
    return false;
  return [...catalog.facts, ...initial.facts, ...reviewed.facts].every(
    (f) =>
      f.sourceSupport.nodeId === unit.nodeId &&
      f.sourceSupport.startOffset >= 0 &&
      f.sourceSupport.startOffset < f.sourceSupport.endOffset &&
      f.sourceSupport.endOffset <= unit.content.length &&
      unit.content.slice(
        f.sourceSupport.startOffset,
        f.sourceSupport.endOffset,
      ) === f.quote &&
      createHash("sha256").update(f.quote).digest("hex") ===
        f.sourceSupport.contentSha256,
  );
}

export function semanticSourceCoveragePassed(
  input: Input,
  catalog: SemanticSourceCatalog,
  rows: SemanticSourceCoverage,
) {
  if (
    rows.length !== catalog.facts.length ||
    new Set(rows.map((r) => r.sourceId)).size !== rows.length
  )
    return false;
  const claims = new Map(input.claims.map((c) => [c.claimId, c]));
  const edges = new Map(
    input.relations
      .filter((r) => claims.has(r.fromClaimId))
      .map((r) => [r.relationId, r]),
  );
  const facts = new Map(catalog.facts.map((f) => [f.id, f]));
  const targets = new Map(
    [...input.contextClaims, ...input.claims].map((c) => [c.claimId, c]),
  );
  return rows.every((row) => {
    const fact = facts.get(row.sourceId);
    if (
      !fact ||
      row.finding !== null ||
      new Set(row.claimIds).size !== row.claimIds.length ||
      new Set(row.relationIds).size !== row.relationIds.length ||
      row.claimIds.some((id) => !claims.has(id)) ||
      row.relationIds.some((id) => !edges.has(id))
    )
      return false;
    const selected = row.relationIds.map((id) => edges.get(id)!);
    const normative =
      fact.semanticAuthority === A.LEGAL_NORMATIVE &&
      fact.modality !== M.NON_OPERATIVE;
    const modalityMatches = (
      claim: (typeof input.claims)[number] | undefined,
    ) =>
      !!claim &&
      claim.semanticAuthority === A.LEGAL_NORMATIVE &&
      claim.claimType === fact.modality &&
      claim.operative?.modality === fact.modality;
    const overlaps = (claim: (typeof input.claims)[number]) =>
      (claim.sourceSupport ?? []).some(
        (s) =>
          s.nodeId === fact.sourceSupport.nodeId &&
          s.startOffset < fact.sourceSupport.endOffset &&
          s.endOffset > fact.sourceSupport.startOffset,
      );
    const boundNorm =
      !!selected.length &&
      selected.every(
        (r) =>
          normativeBindings.has(r.kind) &&
          modalityMatches(targets.get(r.toClaimId)) &&
          overlaps(claims.get(r.fromClaimId)!),
      );
    let supported = false;
    if (row.representation === P.SEMANTIC_UNIT) {
      const expected = [...edges.values()]
        .filter((r) => row.claimIds.includes(r.fromClaimId))
        .map((r) => r.relationId);
      if (
        expected.length !== selected.length ||
        expected.some((id) => !row.relationIds.includes(id))
      )
        return false;
      supported = !!row.claimIds.length;
      if (normative)
        supported &&=
          row.claimIds.some(
            (id) =>
              modalityMatches(claims.get(id)) && overlaps(claims.get(id)!),
          ) ||
          selected.some(
            (r) =>
              normativeBindings.has(r.kind) &&
              modalityMatches(targets.get(r.toClaimId)) &&
              overlaps(claims.get(r.fromClaimId)!),
          );
      else if (fact.semanticAuthority === A.DEFINITION)
        supported &&= row.claimIds.some((id) => overlaps(claims.get(id)!));
    } else if (
      row.representation === P.RELATION ||
      row.representation === P.INCORPORATED_ASSERTION
    ) {
      supported = !!selected.length;
      if (row.representation === P.INCORPORATED_ASSERTION)
        supported &&= selected.every((r) => r.kind === R.INCORPORATES);
      if (normative) supported &&= boundNorm;
    } else if (row.representation === P.DEFINITION_BINDING) {
      supported =
        !normative &&
        (row.claimIds.some(
          (id) =>
            claims.get(id)!.semanticAuthority === A.DEFINITION &&
            overlaps(claims.get(id)!),
        ) ||
          selected.some(
            (r) =>
              r.kind === R.DEFINED_BY &&
              targets.get(r.toClaimId)?.semanticAuthority === A.DEFINITION,
          ));
    } else if (row.representation === P.SOURCE_STRUCTURE) {
      const heading = semanticSourceStructure(
        input.sources.find((n) => n.nodeId === input.sourceNodeId)!,
      ).headingSupport;
      const support = fact.sourceSupport;
      supported =
        !row.claimIds.length &&
        !selected.length &&
        fact.semanticAuthority === A.CONTEXT &&
        fact.modality === M.NON_OPERATIVE &&
        !!heading &&
        support.nodeId === heading.nodeId &&
        heading.startOffset <= support.startOffset &&
        support.startOffset < support.endOffset &&
        support.endOffset <= heading.endOffset;
    } else if (
      row.representation === P.ASSERTION ||
      row.representation === P.QUALIFIED_ASSERTION
    ) {
      supported = !!row.claimIds.length;
      if (normative)
        supported &&=
          row.claimIds.some(
            (id) =>
              modalityMatches(claims.get(id)) && overlaps(claims.get(id)!),
          ) || boundNorm;
      else if (fact.semanticAuthority === A.DEFINITION)
        supported &&= row.claimIds.every((id) => overlaps(claims.get(id)!));
    }
    if (
      fact.semanticAuthority === A.LEGAL_NORMATIVE &&
      (fact.dependency === D.PRESERVATION ||
        fact.dependency === D.SUBSTANTIVE_ADOPTION)
    ) {
      const allowed =
        fact.dependency === D.PRESERVATION
          ? [R.PRESERVES, R.EVIDENCE_SLICE_OF]
          : [R.INCORPORATES];
      if (row.representation === P.SEMANTIC_UNIT)
        supported &&= selected.some(
          (r) =>
            (allowed as readonly string[]).includes(r.kind) &&
            overlaps(claims.get(r.fromClaimId)!),
        );
      else
        supported &&=
          (row.representation === P.RELATION ||
            row.representation === P.INCORPORATED_ASSERTION) &&
          !!selected.length &&
          selected.every((r) =>
            (allowed as readonly string[]).includes(r.kind),
          );
    }
    return supported;
  });
}
