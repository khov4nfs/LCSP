import { createHash } from "node:crypto";
import {
  LEGAL_CLAIM_STATES as CS,
  LEGAL_SEMANTIC_CLAIM_TYPES as CT,
  LEGAL_SEMANTIC_RELATION_KINDS as RK,
  type LegalSemanticClaim,
} from "@lcsp/contracts/compliance-rule-set";
import {
  SOURCE_REVIEW_STATES as S,
  LEGAL_REFERENCE_RESOLUTION_STATES as R,
  REFERENCE_DEPENDENCY_STATES as D,
} from "@lcsp/contracts/legal-source";
import { retainedBindingCase } from "./retained-reference-binding-fixture.js";
import {
  canonicalClaimId,
  inventoryHash,
} from "../../src/modules/compliance-rule-set/domain/claim-inventory.js";
import {
  referenceDependencyView,
  referenceDependencyWake,
  type DependencyReview,
} from "../../src/modules/compliance-rule-set/domain/reference-dependencies.js";
import { normalizeReviewPayload } from "../../src/modules/compliance-rule-set/domain/source-review-frontier.js";

export const modelHash = (s: string) =>
  createHash("sha256").update(s).digest("hex");
export type ModelEdge = {
  from: number;
  to: number;
  material?: boolean;
  resolved?: boolean;
};
const base = retainedBindingCase().fixture.graph;
export function dependencyModel(n: number, edges: ModelEdge[]) {
  const runId = "d8990f8a-c42d-4ccf-8a77-4fa5985c9910";
  const nodes = Array.from({ length: n }, (_, i) => ({
    ...base.nodes[0],
    nodeId: modelHash("unit" + i),
    parentNodeId: null,
    ordinal: i,
    structuralPath: "/document/model/article/" + i,
    content: "Model proposition " + i,
  }));
  const graph = {
    ...base,
    nodes,
    references: edges.map((e, i) => ({
      ...base.references[0],
      referenceId: modelHash("edge" + i),
      fromNodeId: nodes[e.from].nodeId,
      toNodeId: e.resolved === false ? null : nodes[e.to].nodeId,
      resolutionState: e.resolved === false ? R.UNRESOLVED : R.RESOLVED,
    })),
  };
  const claims: LegalSemanticClaim[][] = nodes.map((node, i) =>
    [0, 1].map((j) => ({
      claimId: canonicalClaimId(runId, 1, [node.nodeId], `claim-${i}-${j}`),
      legalSourceVersionId: graph.legalSourceVersionId,
      sourceNodeIds: [node.nodeId],
      claimType: CT.DEFINITION,
      statement: `Model definition ${i} ${j}`,
      operative: null,
      state: CS.RELEVANT,
      nonOperativeReason: null,
    })),
  );
  const rows: DependencyReview[] = nodes.map((node, i) => ({
    preparationRunId: runId,
    inventoryRevision: 1,
    materializationId: graph.materializationId,
    legalSourceVersionId: graph.legalSourceVersionId,
    sourceNodeId: node.nodeId,
    state: S.PENDING,
    completionFingerprint: null,
    claimIds: [],
    blockedReferenceIds: [],
    payload: {
      claims: claims[i],
      identities: Object.fromEntries(
        claims[i].map((c, j) => [c.claimId, `claim-${i}-${j}`]),
      ),
      relations: [],
      referenceAccounting: [],
    },
  }));
  return { graph, rows, claims, runId };
}

/** Explore every unit acquisition/commit ordering. Domain readiness/wake rules are the real implementation. */
export function exploreDependencyModel(
  n: number,
  edges: ModelEdge[],
  legacyCompletionOnly = false,
) {
  const model = dependencyModel(n, edges);
  const initial = model.rows.map((r) => ({
    ...r,
    payload: structuredClone(r.payload),
  }));
  const queue = [{ rows: initial, trace: [] as string[] }];
  const seen = new Set<string>();
  let transitions = 0,
    terminals = 0,
    prerequisiteWaits = 0;
  const views = new Map<string, ReturnType<typeof referenceDependencyView>>();
  const readiness = (rows: DependencyReview[]) => {
    const authorityKey = rows
      .map(
        (r) =>
          `${Number(!!r.completionFingerprint)}${Number(r.state === S.REVIEWED_WITH_CLAIMS)}`,
      )
      .join("");
    if (views.has(authorityKey)) return views.get(authorityKey)!;
    const view = referenceDependencyView(model.graph, rows, model.runId, 1);
    if (legacyCompletionOnly) {
      const original = view.target;
      view.target = (id: string) => {
        const result = original(id);
        return {
          ...result,
          bindingCanProceed:
            result.bindingCanProceed && result.targetReviewComplete,
        };
      };
    }
    views.set(authorityKey, view);
    return view;
  };
  let canonicalTerminal: string | undefined;
  while (queue.length) {
    const { rows, trace } = queue.pop()!;
    const key = JSON.stringify(
      rows.map((r) => [
        r.state,
        !!r.completionFingerprint,
        (r.payload as ReturnType<typeof normalizeReviewPayload>).relations.map(
          (edge) => edge.relationId,
        ),
        r.blockedReferenceIds,
      ]),
    );
    if (seen.has(key)) continue;
    seen.add(key);
    const view = readiness(rows);
    const completed = rows.every((r) => r.state === S.REVIEWED_WITH_CLAIMS);
    const active = rows.findIndex((r) => r.state === S.IN_REVIEW);
    const runnable = rows.flatMap((r, i) =>
      [S.PENDING, S.REOPENED].includes(r.state as never) ? [i] : [],
    );
    const witness = () =>
      JSON.stringify({
        graph: edges,
        units: rows.map((r) => ({
          id: r.sourceNodeId,
          state: r.state,
          available: model.claims[rows.indexOf(r)].map((c) =>
            view.endpoints.has(c.claimId),
          ),
          blockers: r.blockedReferenceIds.map((id) => ({
            id,
            state: view.target(id).classification,
          })),
        })),
        trace,
      });
    if (!completed && active < 0 && !runnable.length) {
      const blockers = rows.flatMap((r) =>
        r.blockedReferenceIds.map(view.target),
      );
      if (blockers.some((b) => b.classification === D.AVAILABLE))
        throw new Error("FALSE_DEADLOCK " + witness());
      prerequisiteWaits++;
      continue;
    }
    for (const [i, row] of rows.entries()) {
      const payload = row.payload as ReturnType<typeof normalizeReviewPayload>;
      if (
        !row.completionFingerprint &&
        model.claims[i].some((c) => view.endpoints.has(c.claimId))
      )
        throw new Error("UNCOMMITTED_ENDPOINT " + witness());
      if (row.state === S.REVIEWED_WITH_CLAIMS)
        for (const relation of payload.relations)
          if (
            view.binding.failure(
              relation,
              new Map([...view.endpoints].map(([id, e]) => [id, e.claim])),
            )
          )
            throw new Error("INVALID_BINDING " + witness());
    }
    if (completed) {
      terminals++;
      const canonical = inventoryHash(rows.map((r) => r.payload));
      if (canonicalTerminal && canonicalTerminal !== canonical)
        throw new Error("ORDER_DEPENDENT_GRAPH " + witness());
      canonicalTerminal = canonical;
      continue;
    }
    if (active < 0) {
      for (const i of runnable) {
        const next = structuredClone(rows);
        next[i].state = S.IN_REVIEW;
        queue.push({ rows: next, trace: [...trace, `ACQUIRE ${i}`] });
        transitions++;
      }
      continue;
    }
    const next = structuredClone(rows),
      item = next[active];
    const outgoing = edges.flatMap((edge, index) =>
      edge.from === active
        ? [{ edge, ref: model.graph.references[index] }]
        : [],
    );
    const unavailable = outgoing.filter(
      ({ edge, ref }) =>
        edge.material !== false &&
        edge.to !== active &&
        !view.target(ref.referenceId).bindingCanProceed,
    );
    const payload = structuredClone(model.rows[active].payload) as ReturnType<
      typeof normalizeReviewPayload
    >;
    payload.dependencyFingerprints = {};
    for (const { edge, ref } of outgoing) {
      if (edge.material === false) {
        payload.referenceAccounting.push({
          referenceId: ref.referenceId,
          material: false,
          relationIds: [],
          nonMaterialReason: "Explicit non-material model edge",
        });
      } else if (
        !unavailable.some((e) => e.ref.referenceId === ref.referenceId)
      ) {
        const fromClaimId = model.claims[active][0].claimId,
          toClaimId = model.claims[edge.to][edge.to === active ? 1 : 0].claimId;
        const relation = {
          fromClaimId,
          toClaimId,
          kind: RK.CROSS_REFERENCE,
          referenceId: ref.referenceId,
        };
        payload.relations.push({
          ...relation,
          relationId: inventoryHash(relation),
        });
        if (edge.to !== active)
          payload.dependencyFingerprints[toClaimId] =
            view.endpoints.get(toClaimId)!.fingerprint;
      }
    }
    payload.blockedEndpointFingerprints = Object.fromEntries(
      unavailable.map(({ ref }) => [
        ref.referenceId,
        view.target(ref.referenceId).endpointFingerprint,
      ]),
    );
    item.payload = normalizeReviewPayload(payload);
    item.claimIds = model.claims[active].map((c) => c.claimId);
    item.completionFingerprint = inventoryHash(item.payload);
    item.blockedReferenceIds = unavailable.map(({ ref }) => ref.referenceId);
    item.state = unavailable.length
      ? S.BLOCKED_REFERENCE
      : S.REVIEWED_WITH_CLAIMS;
    const published = readiness(next);
    for (const row of next)
      if (
        row.state === S.BLOCKED_REFERENCE &&
        referenceDependencyWake(row, published).wake
      )
        row.state = S.REOPENED;
    queue.push({
      rows: next,
      trace: [...trace, `PUBLISH ${active} ${item.state}`],
    });
    transitions++;
  }
  return {
    states: seen.size,
    transitions,
    terminals,
    prerequisiteWaits,
    canonicalTerminal,
  };
}
