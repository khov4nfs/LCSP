"""Bounded Rule Authoring working set and the model-facing digest derived from it.

Runtime state, never chain-of-thought. The frozen inventory stays the only authority; this is an index over it plus the
few facts a model loses when history compaction drops old tool rounds: what it has read, what it authored, and the
rejections it has not yet fixed. The digest is a pure function of the run context, so any new transcript (compaction,
summarization, provider retry, a rebuilt agent graph over the same run) gets the same state back.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from typing import Any

from orchestration.agent_stream import DURABLE, SEMANTIC_SCHEMA_VERSION, publish_agent_stream_event
from rule_set_preparation.authoring_rejections import args_fingerprint, draft_fingerprint
from rule_set_preparation.claim_inventory import AUTHORING, CLAIM_ROLES, READY, RULE_VALIDATION, SUBMISSION_READY
from rule_set_preparation.semantic_closure import claim_role, operative

AUTHORING_PHASES = frozenset({READY, AUTHORING, RULE_VALIDATION, SUBMISSION_READY})
# Tools that only read; a successful call never changes the draft and resolves any earlier rejection of the same tool.
READ_TOOLS = frozenset({"get_claim_inventory", "get_rule_authoring_context", "get_rule_authoring_status", "get_semantic_closure"})
ROLE_ORDER = ("APPLICABILITY_CONDITION", "OPERATIVE_PROPOSITION", "QUALIFIER", "EXCEPTION", "CONTEXT", "DEFINITION")
MAX_PAGE = 20
DIGEST_MAX_CLAIM_LINES = 48
DIGEST_MAX_REQUIREMENT_LINES = 30
DIGEST_MAX_REJECTIONS = 3
RESOLVED_LOG = 40
MAX_OUTSTANDING = 32  # memory bound only: older entries beyond it are recorded as superseded, never silently dropped
SUMMARY_CHARS = 110
VIEW_MAX_PAGE = 40
MARKER = "RULE AUTHORING STATE"
# A successful call of one of these on a candidate abandons any unresolved rejection of that same candidate.
ABANDONING = {"remove_rule_candidate": ("author_legal_requirement", "author_assessment_rule")}
AUTHORED_BY = {"author_legal_requirement": "LEGAL_REQUIREMENT", "author_assessment_rule": "ASSESSMENT_RULE"}


def summary(claim: dict) -> str:
    return " ".join(claim["statement"].split())[:SUMMARY_CHARS]


def normalize_page(limit: Any, offset: Any, maximum: int = MAX_PAGE) -> tuple[int, int]:
    """Safe read pagination only: a harmless oversized or missing page size must not poison convergence."""
    applied = maximum if not isinstance(limit, int) or limit < 1 else min(limit, maximum)
    return applied, offset if isinstance(offset, int) and offset > 0 else 0


def target_of(args: dict) -> str:
    for name in ("requirement_key", "assessment_rule_id", "candidate_id"):
        value = args.get(name)
        if isinstance(value, str) and value:
            return value
    return ""


def referenced_ids(tool: str, args: dict) -> set[str]:
    """The IDs a mutation points at. Two calls that point at the same IDs are attempts at the same thing, whatever key they carry."""
    if tool == "author_legal_requirement":
        # A Requirement is identified by its operative claims. Applicability, qualifier and context claims are shared across Requirements by design.
        value = args.get("operative_claim_ids")
        return {v for v in value if isinstance(v, str)} if isinstance(value, list) else set()
    if tool == "author_assessment_rule":
        value = args.get("legal_requirement_ids")
        return {v for v in value if isinstance(v, str)} if isinstance(value, list) else set()
    if tool == "remove_rule_candidate":
        return {args["candidate_id"]} if isinstance(args.get("candidate_id"), str) else set()
    return set()


def rejection_key(tool: str, args: dict) -> str:
    return f"{tool}:{target_of(args)}"


@dataclass
class AuthoringWorkingSet:
    context: Any
    revision: int = 0
    surfaced: set[str] = field(default_factory=set)
    cursors: dict[str, dict] = field(default_factory=dict)
    outstanding: dict[str, dict] = field(default_factory=dict)
    resolved: list[dict] = field(default_factory=list)
    last_mutation: dict | None = None
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
            counts[claim_role(claim)] = counts.get(claim_role(claim), 0) + 1
        return {role: counts[role] for role in ROLE_ORDER if role in counts}

    def ordered(self, role: str | None = None, unaccounted_only: bool = False) -> list[dict]:
        bound = self.bound()
        rows = [c for c in self.claims() if (role is None or claim_role(c) == role) and (not unaccounted_only or c["claimId"] not in bound)]
        return sorted(rows, key=lambda c: (ROLE_ORDER.index(claim_role(c)), c["claimId"]))

    def requirement_rows(self) -> list[dict]:
        """Every authored Requirement with the AssessmentRules that already cite it: the model must not have to remember these IDs."""
        rules: dict[str, list[str]] = {}
        for rule_id, rule in self.context.draft["assessmentRules"].items():
            for rid in rule.get("legalRequirementIds", []):
                rules.setdefault(rid, []).append(rule_id)
        rows = []
        for rid, requirement in sorted(self.context.draft["legalRequirements"].items()):
            assessable = requirement["coverage"]["state"] == "COVERED_BY_ASSESSMENT_RULES"
            rows.append({"legalRequirementId": rid, "title": " ".join(str(requirement.get("title", "")).split())[:60], "assessable": assessable,
                         "assessmentRuleIds": sorted(rules.get(rid, [])), "needsAssessmentRule": assessable and not rules.get(rid)})
        return rows

    # --- volatile facts the model would otherwise lose --------------------------------------------------------------
    def surface(self, claim_ids) -> None:
        self.surfaced.update(cid for cid in claim_ids if isinstance(cid, str))

    def note_page(self, view: str, result: dict) -> None:
        self.cursors[view] = {k: result.get(k) for k in ("offset", "appliedLimit", "returnedCount", "total", "nextOffset", "hasMore")}

    def _resolve(self, key: str, how: str, call_id: str | None, by_tool: str | None = None) -> None:
        entry = self.outstanding.pop(key, None)
        if entry is None:
            return
        context = self.context
        context.event_sequence += 1
        record = {"key": key, "toolName": entry["toolName"], "rejectionCode": entry["rejectionCode"], "rejectionSequence": entry["sequence"],
                  "resolution": how, "rejectionResolvedByToolCallId": call_id, "resolvedAtSequence": context.event_sequence}
        self.resolved.append(record)
        del self.resolved[:-RESOLVED_LOG]
        # Durable: without this the final evidence could show a rejection but never what ended it.
        publish_agent_stream_event("CUSTOM_PROGRESS", status="RUNNING", data={
            "durability": DURABLE, "schema_version": SEMANTIC_SCHEMA_VERSION, "activity_kind": "RULE_AUTHORING_REJECTION_RESOLVED", "event_sequence": context.event_sequence,
            "model_turn": context.model_turn, "draft_revision": context.draft_revision, "rejection_sequence": entry["sequence"], "rejection_tool_call_id": entry.get("toolCallId"),
            "rejection_tool": entry["toolName"], "rejection_code": entry["rejectionCode"], "resolution": how, "resolved_by_tool_call_id": call_id, "resolved_by_tool": by_tool,
            "outstanding_remaining": len(self.outstanding)})

    def observe_tool(self, tool: str, args: dict, result: dict, *, call_id: str | None = None, envelope: dict | None = None) -> None:
        """Record or resolve the model's unresolved correction after every tool call."""
        if not self.active():
            return
        key = rejection_key(tool, args)
        target = target_of(args)
        if result.get("outcome") == "FAILED":
            failure = next(iter(result.get("gaps", {}).items()), (None, {"examples": [{}]}))
            example = (failure[1].get("examples") or [{}])[0]
            fingerprint = (envelope or {}).get("argsFingerprint") or args_fingerprint(args)
            previous = self.outstanding.get(key)
            repeats = previous["repeats"] + 1 if previous and previous.get("argsFingerprint") == fingerprint else 1
            if previous is not None:
                # The older rejection of this same object ends here: it was not corrected, it was followed by another rejection. Say so durably.
                self._resolve(key, "REPLACED_BY_LATER_REJECTION", call_id, tool)
            self.outstanding[key] = {
                **(envelope or {"toolName": tool, "rejectionLayer": None, "rejectionCode": failure[0], "ref": example.get("ref"), "detail": example.get("detail"),
                                   "fieldPaths": example.get("fieldPaths") or [], "requiredAction": result.get("requiredAction") or example.get("requiredAction"),
                                   "repair": example.get("repair"), "sequence": self.context.event_sequence, "draftUnchanged": True}),
                "key": key, "target": target or None, "argsFingerprint": fingerprint, "repeats": repeats, "toolCallId": call_id,
                "referenced": sorted(referenced_ids(tool, args))[:64], "kind": args.get("kind") if isinstance(args.get("kind"), str) else None,
                "constraints": {k: example[k] for k in ("suppliedField", "expectedField", "expectedRole", "actualRole", "suppliedClaimId", "candidateCount") if k in example}}
            for stale in sorted(self.outstanding, key=lambda k: self.outstanding[k]["sequence"])[:max(0, len(self.outstanding) - MAX_OUTSTANDING)]:
                self._resolve(stale, "SUPERSEDED", call_id, tool)
        else:
            refs = referenced_ids(tool, args)
            for stale_key, entry in list(self.outstanding.items()):
                source = entry.get("rejectionSource")
                if source == "FRAMEWORK_UNKNOWN_TOOL":
                    corrected = True  # a call to a tool that does not exist has no draft object: the model's next valid call is its correction
                elif source == "FRAMEWORK_UNPARSEABLE_ARGUMENTS":
                    corrected = entry["toolName"] in (tool, "UNKNOWN")
                else:
                    # A semantic (layer B) rejection is corrected by a later success of the same tool aimed at the same thing: the same target,
                    # overlapping referenced IDs (the same operative claims retried under a new key), the same removal kind, or an attempt that
                    # never identified its object.
                    corrected = entry["toolName"] == tool and (
                        # a malformed call shape is a tool-wide mistake: the next valid call of that tool shows the contract is now met
                        entry.get("rejectionLayer") == "TOOL_SCHEMA"
                        or entry.get("target") == (target or None) or not entry.get("target") or bool(refs & set(entry.get("referenced", ())))
                        or (tool == "remove_rule_candidate" and entry.get("kind") == args.get("kind")))
                if corrected:
                    self._resolve(stale_key, "CORRECTED", call_id, tool)
            for abandoned_tool in ABANDONING.get(tool, ()):
                if (args.get("kind") == "LEGAL_REQUIREMENT") == (AUTHORED_BY[abandoned_tool] == "LEGAL_REQUIREMENT"):
                    self._resolve(f"{abandoned_tool}:{target}", "ABANDONED", call_id, tool)
            if tool in AUTHORED_BY or tool == "remove_rule_candidate":
                self.last_mutation = {"toolName": tool, "target": target or None, "toolCallId": call_id, "sequence": self.context.event_sequence}
            if tool in READ_TOOLS and not result.get("error"):
                rows = result.get("items") or result.get("claims") or []
                rows = rows if isinstance(rows, list) else []  # a status view reports claims as counts, not rows
                # Navigation bookkeeping only: a row of an unexpected shape is skipped, never allowed to end the run.
                self.surface([r["claim"]["claimId"] if isinstance(r.get("claim"), dict) else r.get("claimId") for r in rows if isinstance(r, dict)])
        self.revision += 1

    def reset(self) -> None:
        """A new phase makes every old correction irrelevant."""
        for key in list(self.outstanding):
            self._resolve(key, "PHASE_CHANGED", None)
        self.cursors.clear()
        self.surfaced.clear()
        self.last_mutation = None

    # --- model-facing views -----------------------------------------------------------------------------------------
    def page_view(self, role: str | None, offset: Any, limit: Any) -> dict:
        applied, start = normalize_page(limit, offset, VIEW_MAX_PAGE)
        unaccounted = role == "UNACCOUNTED"
        rows = [c for c in self.ordered(None if unaccounted else role, unaccounted_only=unaccounted) if role != "OPERATIVE_PROPOSITION" or operative(c)]
        bound = self.bound()
        page = rows[start:start + applied]
        items = [{"claimId": c["claimId"], "claimType": c["claimType"], "accountingRole": claim_role(c), "summary": summary(c),
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

    def next_actions(self) -> list[str]:
        if self.outstanding:
            newest = max(self.outstanding.values(), key=lambda item: item["sequence"])
            return [f"Repair the unresolved {newest['toolName']} rejection (requiredAction: {newest.get('requiredAction')}), then continue."]
        unbound = self.ordered(unaccounted_only=True)
        rows = self.requirement_rows()
        needing = [r["legalRequirementId"] for r in rows if r["needsAssessmentRule"]]
        actions = []
        if unbound:
            actions.append(f"author_legal_requirement for the {len(unbound)} relevant claim(s) not yet bound (get_rule_authoring_context, then get_semantic_closure for a verified operative anchor).")
        if needing:
            actions.append(f"author_assessment_rule for the {len(needing)} assessable Requirement(s) without a rule: {', '.join(needing[:8])}{' …' if len(needing) > 8 else ''}.")
        if not actions:
            actions.append("validate_compliance_rule_set, then submit_compliance_rule_set once it PASSES." if rows else "author_legal_requirement.")
        return actions

    def status_view(self, offset: Any, limit: Any) -> dict:
        applied, start = normalize_page(limit, offset, VIEW_MAX_PAGE)
        rows = self.requirement_rows()
        page = rows[start:start + applied]
        ledger, context = self.context.inventory, self.context
        unbound = self.ordered(unaccounted_only=True)
        by_role: dict[str, int] = {}
        for claim in unbound:
            by_role[claim_role(claim)] = by_role.get(claim_role(claim), 0) + 1
        return {
            "outcome": "PASSED", "phase": ledger.phase, "frozenInventory": {"revision": ledger.revision, "fingerprint": ledger.frozen_fingerprint},
            "draft": {"revision": context.draft_revision, "fingerprint": context.draft_fp or draft_fingerprint(context.draft)},
            "requirements": {"total": len(rows), "assessable": sum(r["assessable"] for r in rows), "nonAssessable": sum(not r["assessable"] for r in rows),
                             "withoutRule": sum(r["needsAssessmentRule"] for r in rows), "items": page, "requestedLimit": limit, "appliedLimit": applied, "offset": start,
                             "returnedCount": len(page), "hasMore": start + len(page) < len(rows), "nextOffset": start + len(page) if start + len(page) < len(rows) else None},
            "assessmentRules": {"total": len(context.draft["assessmentRules"]), "ids": sorted(context.draft["assessmentRules"])[:VIEW_MAX_PAGE]},
            "unresolvedSemanticClaims": {"count": len(unbound), "byRole": by_role},
            "outstandingRejections": [self.public_rejection(item) for item in sorted(self.outstanding.values(), key=lambda i: -i["sequence"])[:DIGEST_MAX_REJECTIONS]],
            "nextValidActions": self.next_actions(),
        }

    @staticmethod
    def public_rejection(item: dict) -> dict:
        keys = ("toolName", "target", "rejectionLayer", "rejectionSource", "rejectionCode", "fieldPaths", "ref", "detail", "requiredAction", "repair", "sequence", "modelTurn",
                "argsFingerprint", "repeats", "draftUnchanged", "draftRevisionBefore", "constraints", "toolCallId")
        return {k: item.get(k) for k in keys if item.get(k) not in (None, [], {})}

    def digest(self) -> str | None:
        if not self.active():
            return None
        ledger, context = self.context.inventory, self.context
        unaccounted = self.ordered(unaccounted_only=True)
        rows = self.requirement_rows()
        lines = [f"{MARKER} (runtime-generated from the frozen inventory and your draft; it replaces your memory of old tool results)",
                 f"Phase {ledger.phase} | inventory revision {ledger.revision} | fingerprint {str(ledger.frozen_fingerprint)[:16]} | {len(self.claims())} relevant claims "
                 f"| draft revision {context.draft_revision}",
                 "Relevant claims by accounting role: " + ", ".join(f"{role} {n}" for role, n in self.role_counts().items()),
                 f"Authored: {len(rows)} Requirements ({sum(r['assessable'] for r in rows)} assessable, {sum(not r['assessable'] for r in rows)} non-assessable); "
                 f"{len(context.draft['assessmentRules'])} AssessmentRules",
                 f"Claims not yet bound to any Requirement: {len(unaccounted)}"]
        if rows:
            lines.append("Your Requirements (use these exact legalRequirementId values for author_assessment_rule):")
            for row in rows[:DIGEST_MAX_REQUIREMENT_LINES]:
                state = ("rules: " + ", ".join(row["assessmentRuleIds"])) if row["assessmentRuleIds"] else ("NEEDS AssessmentRule" if row["assessable"] else "non-assessable")
                lines.append(f"- {row['legalRequirementId']} | {row['title']} | {state}")
            if len(rows) > DIGEST_MAX_REQUIREMENT_LINES:
                lines.append(f"(+{len(rows) - DIGEST_MAX_REQUIREMENT_LINES} more: page with get_rule_authoring_status)")
        validation = getattr(context, "last_validation", None)
        if validation and validation.get("outcome") == "FAILED":
            gaps: dict[str, int] = {}
            for failure in validation.get("failures") or []:
                gaps[failure.get("code", "?")] = gaps.get(failure.get("code", "?"), 0) + 1
            lines.append("Latest Rule validation gaps (stale once you change the draft): " + ", ".join(f"{k} x{n}" for k, n in sorted(gaps.items())))
        if self.outstanding:
            ordered = sorted(self.outstanding.values(), key=lambda item: -item["sequence"])
            lines.append(f"OUTSTANDING AUTHORING REJECTION ({len(ordered)} unresolved{'; newest ' + str(DIGEST_MAX_REJECTIONS) + ' shown' if len(ordered) > DIGEST_MAX_REJECTIONS else ''}): "
                         "fix these before anything else; each stays here until a corrected call succeeds")
            for number, item in enumerate(ordered[:DIGEST_MAX_REJECTIONS], 1):
                constraint = item.get("constraints") or {}
                lines.append(f"{number}) tool: {item['toolName']}{'[' + item['target'] + ']' if item.get('target') else ''} | layer: {item.get('rejectionLayer') or 'API'} | code: {item['rejectionCode']}"
                             f"{' | repeated ' + str(item['repeats']) + 'x with identical arguments' if item['repeats'] > 1 else ''}")
                if item.get("fieldPaths"):
                    lines.append(f"   invalid fields: {', '.join(item['fieldPaths'])}")
                if constraint:
                    lines.append("   expected: " + "; ".join(f"{k}={v}" for k, v in constraint.items()))
                if item.get("detail"):
                    lines.append(f"   detail: {item['detail']}")
                lines.append(f"   required action: {item.get('requiredAction')}")
                if item.get("repair"):
                    lines.append(f"   repair: {item['repair']}")
                lines.append(f"   draft unchanged: {str(bool(item.get('draftUnchanged'))).lower()}")
        reads = "; ".join(f"{view.split(':')[-1]} offset {c['offset']} -> next {c['nextOffset']} of {c['total']}" for view, c in sorted(self.cursors.items()))
        lines.append(f"Inventory reading: {len(self.surfaced)} of {len(self.claims())} claims surfaced so far" + (f"; last pages: {reads}" if reads else ""))
        bound = self.bound()
        shown = [c for c in self.ordered() if operative(c) and c["claimId"] not in bound]
        lines.append("Verified operative anchors (claimId TYPE summary): choose an anchor and call get_semantic_closure. "
                     "Requirements inherit only its verified reachable modifiers/context; global role pools cannot establish compatibility. "
                     "Use get_rule_authoring_status for existing Requirement IDs.")
        lines += [f"{c['claimId']} {c['claimType']} {summary(c)}" for c in shown[:DIGEST_MAX_CLAIM_LINES]]
        if len(shown) > DIGEST_MAX_CLAIM_LINES:
            lines.append(f"(+{len(shown) - DIGEST_MAX_CLAIM_LINES} more: page with get_rule_authoring_context)")
        lines.append("Next: " + " ".join(self.next_actions()) + " Respond with a tool call.")
        return "\n".join(lines)

    def telemetry(self, digest: str) -> dict:
        ledger, context = self.context.inventory, self.context
        newest = max(self.outstanding.values(), key=lambda item: item["sequence"]) if self.outstanding else None
        rows = self.requirement_rows()
        return {"frozenInventoryRevision": ledger.revision, "authoringContextRevision": self.revision, "inventoryPagesSurfaced": len(self.cursors),
                "unreadClaimCount": len(self.claims()) - len(self.surfaced & {c["claimId"] for c in self.claims()}),
                "outstandingRejectionCode": newest["rejectionCode"] if newest else None, "outstandingRejectionCount": len(self.outstanding),
                "authoredRequirements": len(rows), "authoredAssessmentRules": len(context.draft["assessmentRules"]),
                "requirementCount": len(rows), "assessmentRuleCount": len(context.draft["assessmentRules"]), "requirementsWithoutRule": sum(r["needsAssessmentRule"] for r in rows),
                "draftRevision": context.draft_revision, "draftFingerprint": context.draft_fp or draft_fingerprint(context.draft), "modelTurn": context.model_turn,
                "lastMutationTool": (self.last_mutation or {}).get("toolName"), "digestBytes": len(digest.encode())}

    def publish_if_changed(self, digest: str) -> None:
        fingerprint = hashlib.sha256(digest.encode()).hexdigest()
        if fingerprint == self._last_digest:
            return
        self._last_digest = fingerprint
        context = self.context
        context.event_sequence += 1
        publish_agent_stream_event("CUSTOM_PROGRESS", status="RUNNING", data={
            "durability": DURABLE, "schema_version": SEMANTIC_SCHEMA_VERSION, "activity_kind": "RULE_AUTHORING_CONTEXT", "eventSequence": context.event_sequence, **self.telemetry(digest)})
