import {
  LEGAL_SEMANTIC_AUTHORITIES as AUTH,
  LEGAL_SEMANTIC_RELATION_KINDS as R,
  SEMANTIC_CONCEPT_USE_MODES as M,
  type LegalSemanticClaim,
  type SemanticAuditReceipt,
} from "@lcsp/contracts/compliance-rule-set";
import { inventoryHash } from "./claim-inventory.js";
import type { semanticAuditInput } from "./semantic-audit.js";

type Input = ReturnType<typeof semanticAuditInput>;
type Catalogs = SemanticAuditReceipt["relatedSourceCatalogs"];
type Concepts = NonNullable<SemanticAuditReceipt["sourceConceptAudit"]>;

export function semanticConceptInput(input: Input, catalogs?: Catalogs) {
  const nodes = new Map(input.sources.map((n) => [n.nodeId, n]));
  const rows = [...(catalogs ?? [])].sort((a, b) => a.sourceNodeId < b.sourceNodeId ? -1 : a.sourceNodeId > b.sourceNodeId ? 1 : 0);
  const facts = rows.flatMap((row) => [...row.catalog.facts].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    .map((f) => ({ ...f, id: `${row.sourceNodeId}:${f.id}` })));
  return {
    sourceRevision: input.sourceRevision,
    sources: rows.map((row) => {
      const n = nodes.get(row.sourceNodeId)!;
      return { nodeId: n.nodeId, structuralPath: n.structuralPath, content: n.content };
    }),
    catalogFingerprints: rows.map((r) => ({ sourceNodeId: r.sourceNodeId, fingerprint: r.catalog.sourceInputFingerprint })),
    facts,
    definitionFactIds: facts.filter((f) => f.semanticAuthority === AUTH.DEFINITION).map((f) => f.id),
  };
}

export function semanticConceptCurrent(input: Input, catalogs: Catalogs, receipt: Concepts | null | undefined) {
  if (!receipt) return false;
  const question = semanticConceptInput(input, catalogs);
  if (receipt.inputFingerprint !== inventoryHash(question)) return false;
  const definitions = new Set(question.definitionFactIds);
  const facts = new Set(question.facts.map((f) => f.id));
  if (receipt.definitions.length !== definitions.size || new Set(receipt.definitions.map((r) => r.factId)).size !== definitions.size ||
      receipt.definitions.some((r) => !definitions.has(r.factId)) || receipt.factUses.length !== facts.size ||
      new Set(receipt.factUses.map((r) => r.factId)).size !== facts.size || receipt.factUses.some((r) => !facts.has(r.factId))) return false;
  return receipt.factUses.every((r) => new Set(r.uses.map((u) => u.definitionFactId)).size === r.uses.length &&
    r.uses.every((u) => definitions.has(u.definitionFactId) && u.definitionFactId !== r.factId));
}

type Endpoint = { statement: string; sourceSupport?: LegalSemanticClaim["sourceSupport"] | null; operative?: LegalSemanticClaim["operative"] | null };
export function semanticDefinitionTarget(
  relation: { kind: string; fromAssertion: Endpoint; toAssertion: Endpoint },
  question: ReturnType<typeof semanticConceptInput>, concepts: Concepts | null,
) {
  if (relation.kind !== R.DEFINED_BY || !concepts) return null;
  // Exact source identity is the only deterministic alignment; paraphrases stay model-owned.
  const match = (claim: Endpoint) => {
    if (claim.sourceSupport?.length !== 1) return null;
    const rows = question.facts.filter((f) => inventoryHash(f.sourceSupport) === inventoryHash(claim.sourceSupport![0]) &&
      f.quote.split(/\s+/u).filter(Boolean).join(" ") === claim.statement.split(/\s+/u).filter(Boolean).join(" "));
    return rows.length === 1 ? rows[0]!.id : null;
  };
  const origin = match(relation.fromAssertion), target = match(relation.toAssertion);
  const definition = concepts.definitions.find((r) => r.factId === target);
  if (!origin || definition?.definedConcepts.length !== 1) return null;
  const uses = concepts.factUses.find((r) => r.factId === origin)?.uses ?? [];
  if (uses.some((u) => u.definitionFactId === target && u.mode === M.DEFINED_MEANING)) return true;
  if (uses.some((u) => u.definitionFactId === target && u.mode === M.CONTEXTUAL_ASSOCIATION)) return false;
  const colonIdx = origin.indexOf(":");
  const nodeId = colonIdx >= 0 ? origin.slice(0, colonIdx) : null;
  if (nodeId) {
    const definedTerm = definition.definedConcepts[0]!.toLowerCase();
    const claimActor = relation.fromAssertion.operative?.actor;
    const originFact = question.facts.find((f) => f.id === origin);
    const quoteWords = originFact?.quote.toLowerCase() ?? "";
    if (claimActor && claimActor.toLowerCase().includes(definedTerm) && !quoteWords.includes(definedTerm)) {
      const sameUnitFacts = question.facts.filter((f) => f.id.startsWith(`${nodeId}:`) && f.id !== origin);
      for (const sib of sameUnitFacts) {
        const sibUses = concepts.factUses.find((r) => r.factId === sib.id)?.uses ?? [];
        if (sibUses.some((u) => u.definitionFactId === target && u.mode === M.DEFINED_MEANING)) {
          return true;
        }
      }
    }
  }
  return false;
}
