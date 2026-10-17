"""Bounded Rule Authoring working set and the model-facing digest derived from it.

Runtime state, never chain-of-thought. The frozen inventory stays the only authority; this is an index over it plus the
few facts a model loses when history compaction drops old tool rounds: what it has read, what it authored, and the one
rejection it has not yet fixed. Everything but the volatile parts is re-derivable after a restart.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import Any

from orchestration.agent_stream import DURABLE, SEMANTIC_SCHEMA_VERSION, publish_agent_stream_event
from rule_set_preparation.claim_inventory import AUTHORING, CLAIM_ROLES, READY, RULE_VALIDATION, SUBMISSION_READY

AUTHORING_PHASES = frozenset({READY, AUTHORING, RULE_VALIDATION, SUBMISSION_READY})
# Tools that only read; a successful call never changes the draft and resolves any earlier rejection of the same tool.
READ_TOOLS = frozenset({"get_claim_inventory", "get_rule_authoring_context"})
ROLE_ORDER = ("APPLICABILITY_CONDITION", "OPERATIVE_PROPOSITION", "QUALIFIER", "EXCEPTION", "CONTEXT", "DEFINITION")
MAX_PAGE = 20
DIGEST_MAX_CLAIM_LINES = 48
SUMMARY_CHARS = 110
VIEW_MAX_PAGE = 40
MARKER = "RULE AUTHORING STATE"


def summary(claim: dict) -> str:
    return " ".join(claim["statement"].split())[:SUMMARY_CHARS]


def normalize_page(limit: Any, offset: Any, maximum: int = MAX_PAGE) -> tuple[int, int]:
    """Safe read pagination only: a harmless oversized or missing page size must not poison convergence."""
    applied = maximum if not isinstance(limit, int) or limit < 1 else min(limit, maximum)
    return applied, offset if isinstance(offset, int) and offset > 0 else 0


def rejection_key(tool: str, args: dict) -> str:
    return f"{tool}:{args.get('requirement_key') or args.get('assessment_rule_id') or args.get('candidate_id') or ''}"


@dataclass
class AuthoringWorkingSet:
    context: Any
    revision: int = 0
    surfaced: set[str] = field(default_factory=set)
    cursors: dict[str, dict] = field(default_factory=dict)
    outstanding: dict[str, dict] = field(default_factory=dict)
    _last_digest: str | None = field(default=None, repr=False)

    # --- derived from the authority ------------------------------------------------------------------------------
    def active(self) -> bool:
        ledger = self.context.inventory
        return ledger is not None and ledger.frozen is not None and ledger.phase in AUTHORING_PHASES

    def claims(self) -> list[dict]:
        return [c for c in self.context.inventory.frozen["claims"] if c["state"] == "RELEVANT"]

    def bound(self) -> dict[str, list[str]]:
        owners: dict[str, list[str]] = {}
        for key, requirement in self.context.draft["legalRequirements"].items():
            for binding in requirement.get("claimBindings", []):
                owners.setdefault(binding["claimId"], []).append(key)
        return owners

    def role_counts(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for claim in self.claims():
            counts[CLAIM_ROLES[claim["claimType"]]] = counts.get(CLAIM_ROLES[claim["claimType"]], 0) + 1
        return {role: counts[role] for role in ROLE_ORDER if role in counts}

    def ordered(self, role: str | None = None, unaccounted_only: bool = False) -> list[dict]:
        bound = self.bound()
        rows = [c for c in self.claims() if (role is None or CLAIM_ROLES[c["claimType"]] == role) and (not unaccounted_only or c["claimId"] not in bound)]
        return sorted(rows, key=lambda c: (ROLE_ORDER.index(CLAIM_ROLES[c["claimType"]]), c["claimId"]))

    # --- volatile facts the model would otherwise lose --------------------------------------------------------------
    def surface(self, claim_ids) -> None:
        self.surfaced.update(cid for cid in claim_ids if isinstance(cid, str))

    def note_page(self, view: str, result: dict) -> None:
        self.cursors[view] = {k: result.get(k) for k in ("offset", "appliedLimit", "returnedCount", "total", "nextOffset", "hasMore")}

    def observe_tool(self, tool: str, args: dict, result: dict) -> None:
        """Record or resolve the model's unresolved correction after every tool call."""
        if not self.active():
            return
        key = rejection_key(tool, args)
        if result.get("outcome") == "FAILED":
            failure = next(iter(result.get("gaps", {}).items()), (None, {"examples": [{}]}))
            example = (failure[1].get("examples") or [{}])[0]
            self.outstanding[key] = {"tool": tool, "target": key.split(":", 1)[1] or None, "code": failure[0], "ref": example.get("ref"),
                                     "detail": example.get("detail"), "requiredAction": result.get("requiredAction") or example.get("requiredAction"),
                                     "constraints": {k: example[k] for k in ("suppliedField", "expectedField", "expectedRole", "candidateCount") if k in example},
                                     "argumentKeys": sorted(args)}
        else:
            self.outstanding.pop(key, None)
            if tool in READ_TOOLS and not result.get("error"):
                rows = result.get("items") or []
                self.surface([r["claim"]["claimId"] if "claim" in r else r.get("claimId") for r in rows])
        self.revision += 1

    def reset(self) -> None:
        """A new phase makes every old correction irrelevant."""
        self.outstanding.clear()
        self.cursors.clear()
        self.surfaced.clear()

    # --- model-facing views -----------------------------------------------------------------------------------------
    def page_view(self, role: str | None, offset: Any, limit: Any) -> dict:
        applied, start = normalize_page(limit, offset, VIEW_MAX_PAGE)
        unaccounted = role == "UNACCOUNTED"
        rows = self.ordered(None if unaccounted else role, unaccounted_only=unaccounted)
        bound = self.bound()
        page = rows[start:start + applied]
        items = [{"claimId": c["claimId"], "claimType": c["claimType"], "accountingRole": CLAIM_ROLES[c["claimType"]], "summary": summary(c),
                  "sourceNodeCount": len(c["sourceNodeIds"]), "boundTo": bound.get(c["claimId"], [])} for c in page]
        ledger = self.context.inventory
        result = {"outcome": "PASSED", "frozenInventory": {"revision": ledger.revision, "fingerprint": ledger.frozen_fingerprint}, "roleCounts": self.role_counts(),
                  "unaccountedCount": len(self.ordered(unaccounted_only=True)), "items": items, "requestedLimit": limit, "appliedLimit": applied, "offset": start,
                  "returnedCount": len(items), "total": len(rows), "hasMore": start + len(items) < len(rows),
                  "nextOffset": start + len(items) if start + len(items) < len(rows) else None, "endReached": start + len(items) >= len(rows),
                  "role": role or "ALL", "authored": {"requirements": sorted(self.context.draft["legalRequirements"]), "assessmentRules": sorted(self.context.draft["assessmentRules"])}}
        self.surface(c["claimId"] for c in page)
        self.note_page("rule_authoring_context:" + (role or "ALL"), result)
        return result

    def digest(self) -> str | None:
        if not self.active():
            return None
        ledger, context = self.context.inventory, self.context
        bound = self.bound()
        unaccounted = self.ordered(unaccounted_only=True)
        lines = [f"{MARKER} (runtime-generated from the frozen inventory; it replaces your memory of old tool results)",
                 f"Phase {ledger.phase} | inventory revision {ledger.revision} | fingerprint {str(ledger.frozen_fingerprint)[:16]} | {len(self.claims())} relevant claims",
                 "Relevant claims by accounting role: " + ", ".join(f"{role} {n}" for role, n in self.role_counts().items()),
                 f"Authored: {len(context.draft['legalRequirements'])} Requirements [{', '.join(sorted(context.draft['legalRequirements']))}]; "
                 f"{len(context.draft['assessmentRules'])} AssessmentRules [{', '.join(sorted(context.draft['assessmentRules']))}]",
                 f"Claims not yet bound to any Requirement: {len(unaccounted)}"]
        validation = getattr(context, "last_validation", None)
        if validation and validation.get("outcome") == "FAILED":
            gaps: dict[str, int] = {}
            for failure in validation.get("failures") or []:
                gaps[failure.get("code", "?")] = gaps.get(failure.get("code", "?"), 0) + 1
            lines.append("Latest Rule validation gaps (stale once you change the draft): " + ", ".join(f"{k} x{n}" for k, n in sorted(gaps.items())))
        if self.outstanding:
            lines.append("OUTSTANDING PROBLEM(S): fix these before anything else; each stays here until a corrected call succeeds")
            for item in self.outstanding.values():
                constraint = "; ".join(f"{k}={v}" for k, v in item["constraints"].items())
                lines.append(f"- {item['tool']}{'[' + item['target'] + ']' if item['target'] else ''} {item['code']} ref={item['ref']}: {item['detail']}"
                             f"{' (' + constraint + ')' if constraint else ''}; requiredAction={item['requiredAction']}")
        reads = "; ".join(f"{view.split(':')[-1]} offset {c['offset']} -> next {c['nextOffset']} of {c['total']}" for view, c in sorted(self.cursors.items()))
        lines.append(f"Inventory reading: {len(self.surfaced)} of {len(self.claims())} claims surfaced so far" + (f"; last pages: {reads}" if reads else ""))
        shown = [c for c in self.ordered() if CLAIM_ROLES[c["claimType"]] == "APPLICABILITY_CONDITION" or c["claimId"] not in bound]
        lines.append("Claim index (claimId TYPE summary): every applicability-bearing claim (reusable by several Requirements) and every claim not yet bound. "
                     "Fetch an exact claim with get_claim_inventory(kind=CLAIMS, claim_id=...); page the role-grouped view with get_rule_authoring_context.")
        lines += [f"{c['claimId']} {c['claimType']} {summary(c)}" for c in shown[:DIGEST_MAX_CLAIM_LINES]]
        if len(shown) > DIGEST_MAX_CLAIM_LINES:
            lines.append(f"(+{len(shown) - DIGEST_MAX_CLAIM_LINES} more: page with get_rule_authoring_context)")
        lines.append("Next: apply the requiredAction of the outstanding problem(s) above, then continue. Respond with a tool call." if self.outstanding else
                     "Next: author the next Requirement or AssessmentRule from these claim IDs, and call validate_compliance_rule_set once every relevant "
                     "claim is bound. Respond with a tool call.")
        return "\n".join(lines)

    def telemetry(self, digest: str) -> dict:
        ledger = self.context.inventory
        return {"frozenInventoryRevision": ledger.revision, "authoringContextRevision": self.revision, "inventoryPagesSurfaced": len(self.cursors),
                "unreadClaimCount": len(self.claims()) - len(self.surfaced & {c["claimId"] for c in self.claims()}),
                "outstandingRejectionCode": next((i["code"] for i in self.outstanding.values()), None),
                "authoredRequirements": len(self.context.draft["legalRequirements"]), "authoredAssessmentRules": len(self.context.draft["assessmentRules"]),
                "digestBytes": len(digest.encode())}

    def publish_if_changed(self, digest: str) -> None:
        fingerprint = hashlib.sha256(digest.encode()).hexdigest()
        if fingerprint == self._last_digest:
            return
        self._last_digest = fingerprint
        publish_agent_stream_event("CUSTOM_PROGRESS", status="RUNNING", data={
            "durability": DURABLE, "schema_version": SEMANTIC_SCHEMA_VERSION, "activity_kind": "RULE_AUTHORING_CONTEXT", **self.telemetry(digest)})
