import {
  sourceReviewPayloadSchema,
  type LegalSemanticClaim,
  type SourceReviewPayload,
} from "@lcsp/contracts/compliance-rule-set";
import {
  CLAIM_ENDPOINT_AVAILABILITY as E,
  REFERENCE_DEPENDENCY_STATES as D,
  LEGAL_REFERENCE_RESOLUTION_STATES as R,
  SOURCE_REVIEW_STATES as S,
  type LegalDocumentGraph,
} from "@lcsp/contracts/legal-source";
import { canonicalClaimId, inventoryHash } from "./claim-inventory.js";
import {
  completedReviewStates,
  referenceOnlyNodeIds,
  normalizeReviewPayload,
} from "./source-review-frontier.js";
import { semanticReferenceBindings } from "./semantic-reference-binding.js";

export type DependencyReview = {
  preparationRunId: string;
  inventoryRevision: number;
  legalSourceVersionId: string;
  materializationId: string;
  sourceNodeId: string;
  state: string;
  completionFingerprint: string | null;
  claimIds: string[];
  blockedReferenceIds: string[];
  payload: unknown;
};

// Python also treats C0 separators as whitespace; BOM remains semantic content.
const endpointWhitespace = new RegExp(
  String.raw`[\p{White_Space}${String.fromCodePoint(0x1c, 0x1d, 0x1e, 0x1f)}]+`,
  "gu",
);
/**
 * Business purpose: Normalize claim text for endpoint fingerprints so equivalent Unicode and whitespace do not look like changed meaning.
 *
 * Business rules:
 * - NFC normalization, Unicode whitespace and C0 separators collapse to one space; the BOM remains meaningful content.
 *
 * Execution flow:
 * 1. Normalize Unicode to NFC.
 * 2. Collapse configured whitespace and trim the result.
 *
 * Failure cases:
 * - Invalid Unicode input propagates the runtime normalization error.
 *
 * Side effects:
 * - None; returns normalized text without modifying the source claim.
 */
const text = (s: string) =>
  s
    .normalize("NFC")
    .replace(endpointWhitespace, " ")
    .replace(/^ +| +$/gu, "");
/**
 * Business purpose: Detect whether a committed claim endpoint's semantic identity changed for dependent reference reviews.
 *
 * Business rules:
 * - The fingerprint includes claim identity, source pin, type, normalized statement/operative fields, anchors, support/frame metadata when present, semantic state, and exclusion reason.
 * - Persistence timestamps, review leases, and review-row completion state are not endpoint meaning.
 *
 * Execution flow:
 * 1. Normalize the meaning-bearing text and sort source anchors.
 * 2. Include source-support and semantic metadata when the claim carries source support.
 * 3. Hash the semantic projection.
 *
 * Failure cases:
 * - Canonical hashing errors propagate; no replacement fingerprint is generated.
 *
 * Side effects:
 * - None; computes an endpoint fingerprint in memory.
 */
export function claimEndpointFingerprint(c: LegalSemanticClaim) {
  return inventoryHash({
    claimId: c.claimId,
    legalSourceVersionId: c.legalSourceVersionId,
    claimType: c.claimType,
    statement: text(c.statement),
    operative: c.operative
      ? {
          actor: text(c.operative.actor),
          modality: c.operative.modality,
          action: text(c.operative.action),
        }
      : null,
    sourceNodeIds: [...c.sourceNodeIds].sort(),
    ...(c.sourceSupport
      ? {
          sourceSupport: c.sourceSupport,
          semanticFrame: c.semanticFrame,
          semanticAuthority: c.semanticAuthority,
          assessability: c.assessability,
        }
      : {}),
    state: c.state,
    nonOperativeReason:
      c.nonOperativeReason === null ? null : text(c.nonOperativeReason),
  });
}

/**
 * Business purpose: Reconstruct the canonical claim endpoints and reference-target availability for one pinned Preparation inventory.
 *
 * Business rules:
 * - Rows must match the run, inventory revision, source version, and exact graph materialization; reference-only source nodes cannot own claim endpoints.
 * - An endpoint is usable only when its payload, canonical ID, source binding, ownership, and source anchors are valid; duplicate IDs are removed as ambiguous.
 * - Reference targets distinguish unresolved, outside-scope, unavailable, and available states from graph resolution, reviewed units, and valid claims.
 *
 * Execution flow:
 * 1. Build structural reference-binding helpers and the eligible review-row scope.
 * 2. Parse each candidate payload and validate each claim's canonical identity and pinned source ownership.
 * 3. Remove duplicate claim IDs, then expose target summaries, endpoint records, and completed-review lookup.
 *
 * Failure cases:
 * - Invalid row payloads and invalid claim bindings are omitted from endpoint authority rather than treated as valid evidence.
 * - Malformed graph or hash data errors propagate through parsing and hashing.
 *
 * Side effects:
 * - None; derives read-only endpoint and target views from supplied graph and review rows.
 */
export function referenceDependencyView(
  graph: LegalDocumentGraph,
  rows: DependencyReview[],
  runId: string,
  revision: number,
) {
  const binding = semanticReferenceBindings(graph);
  const referenceOnly = referenceOnlyNodeIds(graph);
  const nodes = new Set(
    graph.nodes
      .filter((n) => !referenceOnly.has(n.nodeId))
      .map((n) => n.nodeId),
  );
  const scoped = rows.filter(
    (r) =>
      r.preparationRunId === runId &&
      r.inventoryRevision === revision &&
      r.legalSourceVersionId === graph.legalSourceVersionId &&
      r.materializationId === graph.materializationId &&
      !referenceOnly.has(r.sourceNodeId),
  );
  const endpoints = new Map<
    string,
    {
      claim: LegalSemanticClaim;
      owner: string;
      fingerprint: string;
      identityKey: string;
    }
  >();
  const duplicates = new Set<string>();
  for (const row of scoped) {
    if (
      row.state === S.PENDING ||
      !row.completionFingerprint ||
      !/^[a-f0-9]{64}$/u.test(row.completionFingerprint)
    )
      continue;
    const parsed = sourceReviewPayloadSchema.safeParse(row.payload);
    if (!parsed.success) continue;
    for (const claim of parsed.data.claims) {
      const identity = parsed.data.identities[claim.claimId];
      if (
        !identity ||
        claim.legalSourceVersionId !== graph.legalSourceVersionId ||
        !row.claimIds.includes(claim.claimId) ||
        !claim.sourceNodeIds.includes(row.sourceNodeId) ||
        claim.sourceNodeIds.some((id) => !nodes.has(id)) ||
        canonicalClaimId(runId, revision, claim.sourceNodeIds, identity) !==
          claim.claimId
      )
        continue;
      if (endpoints.has(claim.claimId)) duplicates.add(claim.claimId);
      endpoints.set(claim.claimId, {
        claim,
        owner: row.sourceNodeId,
        fingerprint: claimEndpointFingerprint(claim),
        identityKey: identity,
      });
    }
  }
  for (const id of duplicates) endpoints.delete(id);
  /**
   * Business purpose: Report whether one explicit legal reference has a usable, in-scope target claim endpoint.
   *
   * Business rules:
   * - Unresolved references cannot expose target claims; resolved references outside reviewed scope remain outside scope.
   * - Only validated claim endpoints structurally under the target node can make binding proceed.
   *
   * Execution flow:
   * 1. Resolve the reference and collect scoped review rows under its target.
   * 2. Select validated target claims when the structural reference is resolved.
   * 3. Return target reviews, availability classification, and endpoint fingerprint.
   *
   * Failure cases:
   * - Missing or unresolved reference IDs produce an unresolved/no-claim projection rather than a false available target.
   *
   * Side effects:
   * - None; computes a target projection from the in-memory dependency view.
   */
  const target = (referenceId: string) => {
    const ref = graph.references.find((r) => r.referenceId === referenceId);
    const items = ref?.toNodeId
      ? scoped.filter((r) => binding.within(r.sourceNodeId, ref.toNodeId!))
      : [];
    const claims =
      ref?.toNodeId && ref.resolutionState === R.RESOLVED
        ? [...endpoints.values()]
            .filter((e) =>
              e.claim.sourceNodeIds.some((id) =>
                binding.within(id, ref.toNodeId!),
              ),
            )
            .sort((a, b) => a.claim.claimId.localeCompare(b.claim.claimId))
        : [];
    const classification =
      ref?.resolutionState !== R.RESOLVED
        ? D.UNRESOLVED
        : !items.length
          ? D.OUTSIDE_SCOPE
          : claims.length
            ? D.AVAILABLE
            : D.UNAVAILABLE;
    return {
      referenceId,
      targetNodeId: ref?.toNodeId ?? null,
      inScope: items.length > 0,
      targetReviewState: items.length === 1 ? items[0].state : null,
      targetReviews: items.map((r) => ({
        sourceNodeId: r.sourceNodeId,
        state: r.state,
      })),
      targetReviewComplete:
        items.length > 0 &&
        items.every((r) => completedReviewStates.includes(r.state as never)),
      targetClaimAvailability: claims.length ? E.AVAILABLE : E.NOT_AVAILABLE,
      bindingCanProceed: classification === D.AVAILABLE,
      classification,
      claims,
      endpointFingerprint: inventoryHash([
        ...claims.map((e) => [e.claim.claimId, e.fingerprint]),
      ]),
    };
  };
  /**
   * Business purpose: Check whether a target node has an accepted completed review unit in this pinned inventory.
   *
   * Business rules:
   * - Only the completed-with-claims and completed-without-claims states count as complete.
   * - The lookup is restricted to the already validated run/revision/source scope.
   *
   * Execution flow:
   * 1. Find the scoped row for the requested source node.
   * 2. Return whether its state belongs to the completed review set.
   *
   * Failure cases:
   * - Missing or non-completed units return false.
   *
   * Side effects:
   * - None; performs a read-only lookup.
   */
  const reviewComplete = (sourceNodeId: string) =>
    scoped.some(
      (r) =>
        r.sourceNodeId === sourceNodeId &&
        completedReviewStates.includes(r.state as never),
    );
  return { endpoints, target, binding, reviewComplete };
}

/**
 * Business purpose: Decide whether a blocked source review unit can be reconsidered after target evidence changes.
 *
 * Business rules:
 * - A blocked reference wakes when a newly available endpoint differs from the saved snapshot, all legacy blockers are available, or every explicitly awaited owner has completed review.
 * - Structural cycles do not by themselves authorize a model retry or semantic decision.
 *
 * Execution flow:
 * 1. Resolve each blocked reference against the current dependency view.
 * 2. Compare available endpoint fingerprints with the unit's recorded snapshots.
 * 3. Check whether all named blocked source units have completed, then return the wake decision and blocker details.
 *
 * Failure cases:
 * - Malformed stored review payloads fail schema parsing instead of being treated as wakeable.
 *
 * Side effects:
 * - None; computes whether the caller may reopen the unit.
 */
export function referenceDependencyWake(
  row: DependencyReview,
  view: ReturnType<typeof referenceDependencyView>,
) {
  const blockers = row.blockedReferenceIds.map(view.target);
  const payload = sourceReviewPayloadSchema.parse(row.payload);
  const changed = blockers.some(
    (b) =>
      b.bindingCanProceed &&
      payload.blockedEndpointFingerprints?.[b.referenceId] !==
        b.endpointFingerprint,
  );
  // Recover legacy or inconsistent idle states even when their snapshot was already available.
  const allAvailable =
    blockers.length > 0 && blockers.every((b) => b.bindingCanProceed);
  const ownersRecommitted =
    !!payload.blockedSourceNodeIds?.length &&
    payload.blockedSourceNodeIds.every(view.reviewComplete);
  return { wake: changed || allAvailable || ownersRecommitted, blockers };
}

/**
 * Business purpose: Mark semantic relations that depend on changed claim endpoints as requiring explicit repair.
 *
 * Business rules:
 * - Relations touching any changed endpoint are listed as invalidated; unaffected payload decisions remain intact.
 * - Invalidated relations are excluded when normalized material reference accounting is derived, but their IDs remain available for repair workflows.
 *
 * Execution flow:
 * 1. Find payload relations whose source or target claim changed.
 * 2. Return null when no relation is affected.
 * 3. Union and sort invalidated relation IDs, then normalize the retained payload.
 *
 * Failure cases:
 * - Invalid payload shapes or normalization errors propagate; the original payload is not rewritten in place.
 *
 * Side effects:
 * - None; returns a repair-marked payload copy for the caller to persist.
 */
export function invalidateDependentPayload(
  payload: SourceReviewPayload,
  changedClaims: Set<string>,
) {
  const invalidated = payload.relations.filter(
    (r) => changedClaims.has(r.fromClaimId) || changedClaims.has(r.toClaimId),
  );
  if (!invalidated.length) return null;
  const invalidatedRelationIds = [
    ...new Set([
      ...(payload.invalidatedRelationIds ?? []),
      ...invalidated.map((r) => r.relationId),
    ]),
  ].sort();
  return normalizeReviewPayload({ ...payload, invalidatedRelationIds });
}

/**
 * Business purpose: Explain why reference-blocked review units are waiting and whether any blocked state is incorrectly idle.
 *
 * Business rules:
 * - Wait edges include blocked structural targets and explicit cross-unit dependencies, restricted to currently blocked units.
 * - Strongly connected components expose cycles; a cycle is diagnostic and is not itself treated as a completion decision.
 * - A false-deadlock warning requires blocked work, no pending/reopened/in-review unit, and at least one dependency that is already wakeable.
 *
 * Execution flow:
 * 1. Build the blocked-unit wait graph from target reviews and explicit owner waits.
 * 2. Find its strongly connected components and cycles.
 * 3. Return cycle details, wakeability status, and per-unit target classifications.
 *
 * Failure cases:
 * - Malformed stored payloads or dependency-view computation errors propagate; unresolved or out-of-scope targets remain diagnostic classifications from the supplied view.
 *
 * Side effects:
 * - None; diagnoses durable dependency state without reopening rows.
 */
export function referenceDependencyWaits(
  rows: DependencyReview[],
  view: ReturnType<typeof referenceDependencyView>,
) {
  const blocked = rows.filter((r) => r.state === S.BLOCKED_REFERENCE);
  const ids = new Set(blocked.map((r) => r.sourceNodeId));
  const edges = new Map(
    blocked.map((r) => [
      r.sourceNodeId,
      [
        ...r.blockedReferenceIds.flatMap((id) =>
          view.target(id).targetReviews.map((target) => target.sourceNodeId),
        ),
        ...(sourceReviewPayloadSchema.parse(r.payload).blockedSourceNodeIds ??
          []),
      ].filter((id) => ids.has(id)),
    ]),
  );
  const index = new Map<string, number>(),
    low = new Map<string, number>(),
    stack: string[] = [],
    active = new Set<string>();
  const cycles: string[][] = [];
  let next = 0;
  /**
   * Business purpose: Find one strongly connected component in the blocked-unit dependency graph.
   *
   * Business rules:
   * - Tarjan indexes each node once and treats multi-node components or self-edges as cycles.
   * - The component analysis reports wait cycles without deciding their legal meaning or changing review state.
   *
   * Execution flow:
   * 1. Assign discovery and low-link indexes and push the node onto the active stack.
   * 2. Traverse dependency edges, propagating low-link values for descendants and active back-edges.
   * 3. Pop a root component and retain it when it contains a cycle.
   *
   * Failure cases:
   * - Malformed graph references fail through ordinary map/stack operations and are not reinterpreted as resolution.
   *
   * Side effects:
   * - Mutates only local Tarjan traversal maps, stack, active set, and cycle collection.
   */
  const visit = (id: string) => {
    index.set(id, next);
    low.set(id, next++);
    stack.push(id);
    active.add(id);
    for (const target of edges.get(id) ?? []) {
      if (!index.has(target)) {
        visit(target);
        low.set(id, Math.min(low.get(id)!, low.get(target)!));
      } else if (active.has(target))
        low.set(id, Math.min(low.get(id)!, index.get(target)!));
    }
    if (low.get(id) !== index.get(id)) return;
    const component: string[] = [];
    let member: string;
    do {
      member = stack.pop()!;
      active.delete(member);
      component.push(member);
    } while (member !== id);
    if (component.length > 1 || edges.get(id)?.includes(id))
      cycles.push(component.sort());
  };
  for (const id of ids) if (!index.has(id)) visit(id);
  return {
    cycles,
    falseDeadlock:
      blocked.length > 0 &&
      !rows.some((r) =>
        [S.PENDING, S.REOPENED, S.IN_REVIEW].includes(r.state as never),
      ) &&
      blocked.some((r) => referenceDependencyWake(r, view).wake),
    units: blocked.map((r) => ({
      sourceNodeId: r.sourceNodeId,
      blockers: r.blockedReferenceIds.map((id) => {
        const target = view.target(id);
        return {
          referenceId: id,
          targetNodeId: target.targetNodeId,
          classification: target.classification,
          targetClaimAvailability: target.targetClaimAvailability,
          targetReviewComplete: target.targetReviewComplete,
          cyclicInternalWait: cycles.some(
            (c) =>
              c.includes(r.sourceNodeId) &&
              target.targetReviews.some((t) => c.includes(t.sourceNodeId)),
          ),
        };
      }),
    })),
  };
}
