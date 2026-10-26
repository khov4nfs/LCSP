"""File discovery adapter over the existing claim inventory and persisted frontier."""
from __future__ import annotations

import json
import re
from copy import deepcopy
from pathlib import Path, PurePosixPath

from jsonschema import Draft7Validator
from langchain_core.tools import tool

from orchestration.agent_stream import publish_agent_stream_event
from rule_set_preparation.claim_inventory import ClaimInventory, FRAME_FIELDS, NORMATIVE, claim_id, identity_key, utf16_slice
from rule_set_preparation.claim_tools import build_claim_tools, locate_quote, support_span
from rule_set_preparation.reference_binding import valid_binding

SCHEMA = json.loads(Path(__file__).with_name("claim-file.schema.json").read_text())
VALIDATOR = Draft7Validator(SCHEMA)
CLAIMS_ROOT = "/work/claims"


def claim_path(source_path):
    return source_path.replace("/legal-source/", CLAIMS_ROOT + "/", 1).removesuffix(".md") + ".json"


def disk_path(context, virtual):
    path = PurePosixPath(virtual)
    if not path.is_absolute() or ".." in path.parts or not path.is_relative_to(CLAIMS_ROOT) or path.suffix != ".json":
        raise ValueError("Use an absolute .json path under /work/claims; traversal is forbidden")
    root = context.source_root.resolve()
    local = root / str(path).lstrip("/")
    if not local.resolve().is_relative_to(root / "work/claims"):
        raise ValueError("Claim path escapes /work/claims through a symlink")
    return local


def global_key(path, key):
    return path.removeprefix(CLAIMS_ROOT + "/") + "#" + key


def target_key(path, target):
    if "#" not in target:
        return path, target
    file, key = target.rsplit("#", 1)
    return (file if file.startswith("/") else CLAIMS_ROOT + "/" + file), key


# relation kind -> the claim types that may be its FROM (the modifier); the relation points TO the claim it modifies
modifier_types = {"CONDITION_OF": {"SCOPE", "CONDITION"}, "QUALIFIES": {"QUALIFIER"}, "EXCEPTION_TO": {"EXCEPTION"}, "TEMPORALLY_APPLIES_TO": {"TEMPORAL_RULE", "TRANSITION_RULE"}}


def _normalize(value):
    """Mechanical defaults for omitted fields, applied after schema validation: the rest of the pipeline sees the full shape."""
    value.setdefault("noClaims", {})
    value.setdefault("references", {})
    for claim in value["claims"]:
        claim.setdefault("actor", None)
        claim.setdefault("action", None)
        if claim.get("frame") is None:
            claim["frame"] = {}
        claim.setdefault("nonOperativeReason", None)
        claim.setdefault("relevant", not claim["nonOperativeReason"])
        claim.setdefault("relations", [])
    # A modifier relation written on the claim it modifies (duty -> CONDITION_OF -> scope) is the same fact written backwards: turn it around.
    by_key = {claim["key"]: claim for claim in value["claims"]}
    for claim in value["claims"]:
        for relation in list(claim["relations"]):
            modifier = by_key.get(relation["to"])
            if (modifier and not relation.get("referenceId") and claim["type"] not in modifier_types.get(relation["kind"], {claim["type"]})
                    and modifier["type"] in modifier_types[relation["kind"]]):
                claim["relations"].remove(relation)
                turned = {**relation, "to": claim["key"]}
                if turned not in modifier["relations"]:
                    modifier["relations"].append(turned)
    # A bound reference is declared once, in `references`; its relation on the FROM claim follows from it.
    for rid, decision in value["references"].items():
        binding = decision.get("binding") if decision.get("material") is True else None
        for claim in value["claims"]:
            if binding and claim["key"] == binding["from"] and not any(r.get("referenceId") == rid for r in claim["relations"]):
                claim["relations"].append({"kind": binding["kind"], "to": binding["to"], "referenceId": rid})


def _cite_effect_targets(source, value):
    """A legalEffect target is cited as printed under /legal-source (<document>#<locator>); its node id is looked up here."""
    for claim in value.get("claims", []) if isinstance(value, dict) else []:
        effect = (claim.get("frame") or {}).get("legalEffect") if isinstance(claim, dict) and isinstance(claim.get("frame"), dict) else None
        for target in (effect or {}).get("targets", []):
            document, _, locator = str(target.get("nodeId", "")).partition("#")
            node = source.resolve_locator(document, locator) if locator else None
            if node:
                target["nodeId"] = node


def _schema_issues(issue):
    if issue.validator == "anyOf":
        nested = [child for child in issue.context if child.validator != "type" or child.absolute_path != issue.absolute_path]
        if nested:
            return [leaf for child in nested for leaf in _schema_issues(child)]
    return [issue]


def _load(context, path):
    raw = disk_path(context, path).read_text(encoding="utf-8")
    try:
        value = json.loads(raw)
        _cite_effect_targets(context.source_graph, value)
    except json.JSONDecodeError as exc:
        # Point at the fault so one targeted edit repairs it instead of a rewrite of the whole file.
        raise ValueError(f"{exc.msg} at line {exc.lineno} column {exc.colno}: ...{raw[max(0, exc.pos - 60):exc.pos]}<<HERE>>{raw[exc.pos:exc.pos + 60]}...") from exc
    errors = sorted((leaf for issue in VALIDATOR.iter_errors(value) for leaf in _schema_issues(issue)), key=lambda e: str(list(e.absolute_path)))
    if not errors:
        _normalize(value)
    return value, errors


class SupportError(ValueError):
    def __init__(self, code, detail, fix):
        super().__init__(detail)
        self.code, self.detail, self.fix = code, detail, fix


def resolve_support(source, document, ids, support):
    """(node id, span, printed locator) of one support entry.

    A wrong or invented locator is corrected when the verbatim quote sits in exactly one node of this file: the stored
    span is always the source's own slice, so provenance stays exact while the author saves a repair round.
    """
    locator, quote = support["locator"], support["quote"]
    nid = source.resolve_locator(document, locator)
    reason = None
    if nid in ids:
        try:
            return nid, support_span(source, nid, quote), locator
        except ValueError as exc:
            reason = str(exc)
    other = locate_quote(source, ids, quote)
    if other is not None:
        return other, support_span(source, other, quote), source.locators[other]
    if nid in ids:
        text = source.nodes[nid]["content"]
        raise SupportError("SOURCE_SUPPORT_INVALID", f"{reason}: {locator}", "Copy a short verbatim passage of this locator; a quote that fits no node of this file is rejected. "
                           f"Pinned text at {locator} (first 800 characters): {text[:800]}")
    printed = ", ".join(source.locators[n] for n in ids)
    raise SupportError("LOCATOR_UNKNOWN", locator, "Use a printed locator of this file (" + printed + ") or quote a passage verbatim")


def _reference_only_target(source, reference_id):
    reference = source.references.get(reference_id, {})
    return reference.get("resolutionState") == "RESOLVED" and source.is_reference_only(reference.get("toNodeId"))


def check_claims(context, paths):
    """Collect every deterministic error. No draft mutation, API call or model invocation."""
    if not paths:
        return {"outcome": "FAILED", "errors": {"_request": {"_file": [{"code": "CLAIM_PATHS_EMPTY", "fix": "Supply at least one /work/claims .json path"}]}}}, {}, {}
    source, errors, files, candidates = context.source_graph, {}, {}, {}
    reference_owners = source.reference_owners()
    review_units = source.review_node_ids()
    file_nodes = {claim_path(p): ids for p, ids in source.source_files.items()}

    def error(path, key, code, detail, fix):
        errors.setdefault(path, {}).setdefault(str(key), []).append({"code": code, "detail": detail, "fix": fix})

    for path in dict.fromkeys(paths):
        try:
            value, invalid = _load(context, path)
        except (ValueError, OSError, UnicodeError, TypeError) as exc:
            error(path, "_file", "CLAIM_FILE_INVALID", str(exc), "Write valid JSON at an absolute /work/claims/<document>/<article>.json path")
            continue
        for issue in invalid:
            parts = list(issue.absolute_path)
            key = value.get("claims", [])[parts[1]].get("key", parts[1]) if len(parts) > 1 and parts[0] == "claims" and isinstance(value["claims"][parts[1]], dict) else "_file"
            error(path, key, "CLAIM_SCHEMA_INVALID", f"{'.'.join(map(str, parts))}: {issue.message[:600]}", "Correct this field to claim-file.schema.json; remove undeclared fields")
        if invalid:
            continue
        files[path] = value
        ids = file_nodes.get(path)
        if ids is None:
            error(path, "_file", "ARTICLE_PATH_UNKNOWN", path, "Mirror a pinned source file path under /work/claims and change .md to .json")
            continue
        source_path = source.node_files[ids[0]]
        if value["article"] != source.file_articles[source_path]:
            error(path, "_file", "ARTICLE_MISMATCH", value["article"], "Use article: " + source.file_articles[source_path])
        document = source.nodes[ids[0]]["documentId"]
        covered, seen = set(), set()
        for claim in value["claims"]:
            key = claim["key"]
            normalized = identity_key(global_key(path, key))
            if normalized in seen:
                error(path, key, "CLAIM_KEY_DUPLICATE", key, "Choose a distinct stable key (case and whitespace are normalized)")
            seen.add(normalized)
            if len(normalized) > 128:
                error(path, key, "CLAIM_KEY_TOO_LONG", normalized, "Shorten the key so file#key is at most 128 characters")
            if not claim["statement"].strip():
                error(path, key, "CLAIM_SCHEMA_INVALID", "Empty statement after normalization", "State the source-supported assertion")
            if claim["type"] in NORMATIVE and (not (claim["actor"] or "").strip() or not (claim["action"] or "").strip()):
                error(path, key, "OPERATIVE_PROPOSITION_REQUIRED", claim["type"], "Provide the source's actual actor and action")
            if claim["type"] not in NORMATIVE and (claim["actor"] is not None or claim["action"] is not None):
                error(path, key, "OPERATIVE_PROPOSITION_INVALID", claim["type"], "Use null actor and action for non-operative claim types")
            if claim["relevant"] == bool(claim["nonOperativeReason"]):
                error(path, key, "NON_OPERATIVE_REASON_INVALID", key, "Use null reason for a relevant claim, otherwise give a truthful exclusion reason")
            spans = []
            for support in claim["support"]:
                try:
                    _, span, locator = resolve_support(source, document, ids, support)
                except SupportError as exc:
                    error(path, key, exc.code, exc.detail, exc.fix)
                    continue
                covered.add(locator)
                spans.append(span)
            nodes = sorted({s["nodeId"] for s in spans})
            if len({(s["nodeId"], s["startOffset"], s["endOffset"]) for s in spans}) != len(spans):
                error(path, key, "SOURCE_SUPPORT_DUPLICATE", key, "Remove the duplicate support span")
            cid = claim_id(context.run_id, context.inventory.revision if context.inventory else 1, nodes, global_key(path, key))
            candidate = {"claimId": cid, "legalSourceVersionId": source.version, "sourceNodeIds": nodes,
                "sourceSupport": sorted(spans, key=lambda s: (s["nodeId"], s["startOffset"], s["endOffset"])),
                "claimType": claim["type"], "semanticAuthority": claim["authority"], "assessability": claim["assessability"],
                "semanticFrame": {**{k: claim["frame"].get(k) for k in FRAME_FIELDS}, **({"legalEffect": claim["frame"]["legalEffect"]} if "legalEffect" in claim["frame"] else {})}}
            from rule_set_preparation.legal_effect import effect_integrity_error
            effect_error = effect_integrity_error(candidate, source)
            if effect_error:
                error(path, key, "LEGAL_EFFECT_INVALID", effect_error, "Use pinned targets and supported valid dates; retain unknown targets explicitly")
            candidates[(path, key)] = candidate
        expected = {source.locators[nid] for nid in ids}
        # Unclaimed headings get a structural disposition; a cited Article title owns its claim like any other source unit.
        required = {source.locators[nid] for nid in ids if nid in review_units and not is_pure_heading(source, nid)}
        declined = set(value["noClaims"])
        for locator, reason in value["noClaims"].items():
            if locator not in expected:
                error(path, "_file", "LOCATOR_UNKNOWN", locator, "Use a printed locator from this Article")
            if locator in covered:
                error(path, "_file", "LOCATOR_ACCOUNTING_CONFLICT", locator, "Remove noClaims for a locator supported by a claim")
        for locator in sorted(required - covered - declined):
            error(path, "_file", "LOCATOR_UNACCOUNTED", locator, "Add a claim whose support quotes this locator, or a factual noClaims reason for it")
        expected_refs = {rid for rid, owner in reference_owners.items() if owner in ids}
        for rid in expected_refs:
            if _reference_only_target(source, rid):
                decision = value["references"].get(rid)
                if decision and decision["material"] is True:
                    error(path, "_file", "REFERENCE_ONLY_TARGET", rid, "Remove the material binding; omit this decision or use material: false with reason REFERENCE_ONLY_TARGET. Record repeals/amendments as legalEffect targets")
                else:
                    value["references"][rid] = {"material": False, "reason": "REFERENCE_ONLY_TARGET"}
        for rid in expected_refs:
            decision = value["references"].get(rid)
            if decision and decision["material"] == "UNRESOLVED" and source.references.get(rid, {}).get("resolutionState") != "RESOLVED":
                # The pinned source has no single target node: no claim will ever exist to bind or wait for, so waiting would
                # never end. Account the dependency as unresolved-target (reason kept) and let the unit complete.
                value["references"][rid] = {"material": False, "reason": "UNRESOLVED_TARGET: " + decision["reason"]}
        for rid in sorted(expected_refs - value["references"].keys()):
            error(path, "_file", "REFERENCE_UNACCOUNTED", rid, "Account as bound with binding, non-material with reason, or material: UNRESOLVED with reason")
        for rid in value["references"].keys() - expected_refs:
            error(path, "_file", "REFERENCE_UNKNOWN", rid, "Use only referenceIds annotated in this source file")

    def candidate_at(path, key):
        if (path, key) in candidates:
            return candidates[path, key]
        try:
            target, invalid = _load(context, path)
            if invalid:
                return None
            row = next(c for c in target["claims"] if c["key"] == key)
            ids = file_nodes[path]
            doc = source.nodes[ids[0]]["documentId"]
            nodes = sorted({resolve_support(source, doc, ids, s)[0] for s in row["support"]})
            return {"claimId": claim_id(context.run_id, context.inventory.revision if context.inventory else 1, nodes, global_key(path, key)), "legalSourceVersionId": source.version, "sourceNodeIds": nodes, "claimType": row["type"], "semanticAuthority": row["authority"]}
        except (ValueError, OSError, UnicodeError, KeyError, StopIteration):
            return None

    for path, value in files.items():
        for claim in value["claims"]:
            key = claim["key"]
            origin = candidates.get((path, key))
            if not origin:
                continue
            # Target Articles may not exist yet; the existing inventory closure gate requires links before freezing.
            for relation in claim["relations"]:
                target_path, target = target_key(path, relation["to"])
                endpoint = candidate_at(target_path, target)
                if endpoint is None:
                    error(path, key, "RELATION_TARGET_MISSING", relation["to"], "Write the target file/key first; cross-file targets use <document>/<article>.json#<key>")
                    continue
                if endpoint["claimId"] == origin["claimId"]:
                    error(path, key, "RELATION_SELF_LINK", key, "A claim cannot relate to itself: if this one claim already covers both the referencing and the referenced text, delete the relation and record that reference as non-material (reason: covered by the same claim)")
                kind = relation["kind"]
                if kind in modifier_types and claim["type"] not in modifier_types[kind]:
                    error(path, key, "RELATION_DIRECTION_INVALID", kind, f"{kind} is written on the {'/'.join(sorted(modifier_types[kind]))} claim with `to` = the affected claim; "
                          f"'{key}' is a {claim['type']}: delete this relation here and add it to the modifier claim")
                elif kind in {"QUALIFIES", "EXCEPTION_TO", "TEMPORALLY_APPLIES_TO"} and not (endpoint["claimType"] in NORMATIVE and endpoint["semanticAuthority"] == "LEGAL_NORMATIVE"):
                    error(path, key, "RELATION_TARGET_NOT_OPERATIVE", kind, f"{kind} must point to the duty, prohibition or permission it modifies; '{relation['to']}' is a {endpoint['claimType']}")
                elif kind == "DEFINED_BY" and endpoint["claimType"] != "DEFINITION":
                    error(path, key, "RELATION_DIRECTION_INVALID", kind, "DEFINED_BY points `to` a DEFINITION claim")
                rid = relation.get("referenceId")
                if rid:
                    row = {"kind": kind, "referenceId": rid, "fromClaimId": origin["claimId"], "toClaimId": endpoint["claimId"]}
                    if not valid_binding(source, {origin["claimId"]: origin, endpoint["claimId"]: endpoint}, row):
                        reference = source.references.get(rid, {})
                        where = lambda node: source.locators.get(node, "?")
                        error(path, key, "REFERENCE_DIRECTION_INVALID", rid, f"FROM must be a claim supported at/under {where(reference.get('fromNodeId'))}; TO a claim supported at/under {where(reference.get('toNodeId'))}. "
                              "If no such pair of claims exists, record the reference as non-material with the actual reason")
                    decision = value["references"].get(rid)
                    binding = {"from": key, "to": relation["to"], "kind": kind}
                    if not decision or decision.get("material") is not True or decision.get("binding") != binding:
                        error(path, key, "REFERENCE_BINDING_MISMATCH", rid, "Set references[referenceId] to material: true and the identical {from, to, kind} binding")
        for rid, decision in value["references"].items():
            if decision["material"] is True:
                binding = decision["binding"]
                if not any(c["key"] == binding["from"] for c in value["claims"]):
                    error(path, "_file", "REFERENCE_BINDING_MISSING", rid, "binding.from must be the key of a claim in this file")
    return {"outcome": "FAILED" if errors else "PASSED", "errors": errors}, files, candidates


def _operations(context):
    operations = {}
    build_claim_tools(context, operations=operations)
    return operations


def commit_claims(context, paths):
    with context.mutation_lock:
        checked, files, candidates = check_claims(context, paths)
        if checked["outcome"] != "PASSED":
            _events(paths, [], checked["errors"])
            return checked
        ledger, source = context.inventory, context.source_graph
        if not ledger.discovery_allowed():
            return {"outcome": "FAILED", "errors": {"_phase": "Discovery is frozen; reopen the inventory before editing files"}}
        frontier = ledger.frontier
        if frontier is None:
            return {"outcome": "FAILED", "errors": {"_frontier": "File discovery requires a persisted frontier"}}
        refused = frontier.restore(force=True)
        if refused:
            return frontier.failure(refused)
        all_ids = [nid for p, ids in source.source_files.items() if claim_path(p) in files for nid in ids]
        refused = frontier.adopt(all_ids)
        if refused:
            return frontier.failure(refused)
        if not frontier.active_batch and not candidates:
            return {"outcome": "PASSED", "committedNodes": []}
        operations = _operations(context)
        units = {u["sourceNodeId"]: u for u in frontier.active_batch}
        node_file = {nid: claim_path(source.node_files[nid]) for nid in units}
        identifiers = {pair: c["claimId"] for pair, c in candidates.items()}
        previous = deepcopy(context.draft)
        for (path, key), candidate in candidates.items():
            claim = next(c for c in files[path]["claims"] if c["key"] == key)
            owners = [s["nodeId"] for s in candidate["sourceSupport"] if s["nodeId"] in units]
            if not owners:
                return {"outcome": "FAILED", "errors": {path: {key: [{"code": "CLAIM_SOURCE_BINDING_INVALID", "fix": "Support the claim with a source-bearing review unit"}]}}}
            frontier.active = units[owners[0]]
            kwargs = dict(claim_type=claim["type"], statement=claim["statement"], actor=claim["actor"], action=claim["action"], relevant=claim["relevant"], non_operative_reason=claim["nonOperativeReason"], source_support=candidate["sourceSupport"], semantic_authority=claim["authority"], semantic_frame=claim["frame"], assessability=claim["assessability"])
            if candidate["claimId"] in ledger.identities:
                result = operations["update"](claim_id=candidate["claimId"], **kwargs)
            else:
                result = operations["register"](identity_key=global_key(path, key), source_node_ids=candidate["sourceNodeIds"], **kwargs)
            if result["outcome"] != "PASSED":
                return result
        keep = set(identifiers.values())
        for cid in list(ledger.identities):
            if frontier.claim_owners.get(cid) in units and cid not in keep:
                frontier.active = units[frontier.claim_owners[cid]]
                operations["remove"](cid, "Claim file explicitly removed this assertion")
        # Rebuild only these files' outgoing relations through the existing link/bind code paths.
        for rid in list(frontier.relation_owners):
            if frontier.relation_owners[rid] in units:
                frontier.active = units[frontier.relation_owners[rid]]
                operations["unlink"](rid, "Claim file replaces this unit's outgoing relations")
        waiting = {}
        for path, value in files.items():
            for claim in value["claims"]:
                if (path, claim["key"]) not in identifiers:
                    continue
                cid = identifiers[path, claim["key"]]
                frontier.active = units[frontier.claim_owners[cid]]
                for relation in claim["relations"]:
                    target_path, target = target_key(path, relation["to"])
                    endpoint = identifiers.get((target_path, target))
                    if endpoint is None:
                        endpoint = next((i for i, identity in ledger.identities.items() if identity == identity_key(global_key(target_path, target))), None)
                    if endpoint is None:
                        waiting.setdefault(frontier.active["sourceNodeId"], []).append(relation.get("referenceId"))
                        continue
                    if relation.get("referenceId"):
                        frontier.active = units[source.reference_owners()[relation["referenceId"]]]
                    result = operations["link"](cid, endpoint, relation["kind"], relation.get("referenceId"))
                    if result["outcome"] != "PASSED":
                        return result
            for rid, decision in value["references"].items():
                owner = source.reference_owners()[rid]
                if owner not in units:
                    return {"outcome": "FAILED", "errors": {path: {"_file": [{"code": "REFERENCE_OWNER_NOT_REVIEWABLE", "fix": "Reference belongs to a structural context node; reconcile frontier scope"}]}}}
                frontier.active = units[owner]
                if decision["material"] is False:
                    result = operations["non_material"](rid, decision["reason"])
                    if result["outcome"] != "PASSED":
                        return result
                elif decision["material"] == "UNRESOLVED":
                    waiting.setdefault(owner, []).append(rid)
        completions = []
        for nid in units:
            path = node_file[nid]
            cids = sorted(cid for cid, c in context.draft["semanticClaims"].items() if nid in c["sourceNodeIds"])
            reason = files[path]["noClaims"].get(source.locators[nid]) or (HEADING_REASON if not cids and is_pure_heading(source, nid) else None)
            row = {"source_node_id": nid, "claim_ids": cids, "disposition": "CLAIMS_AUTHORED" if cids else "NO_RELEVANT_SEMANTIC_CLAIMS", **({"reason": reason} if reason else {})}
            if nid in waiting:
                refs = sorted(set(filter(None, waiting[nid])))
                reason = "; ".join(dict.fromkeys(files[path]["references"][rid]["reason"] for rid in refs if rid in files[path]["references"]))
                # This is a bounded wait diagnostic; the reference IDs and source claims remain complete.
                if not reason or len(reason.encode("utf-16-le")) // 2 > 2000:
                    reason = "Target claims have not been committed; inspect referenceIds, commit both files together or publish targets first"
                row.update(disposition="REQUIRES_REFERENCE_RESOLUTION", reference_ids=refs, reason=reason)
            completions.append(row)
        # Reopen changed durable units only. Identical files keep their existing completion fingerprint.
        for row in completions:
            nid = row["source_node_id"]
            owned = {cid for cid, owner in frontier.claim_owners.items() if owner == nid}
            relation_ids = {rid for rid, owner in frontier.relation_owners.items() if owner == nid}
            changed = any(previous["semanticClaims"].get(cid) != context.draft["semanticClaims"].get(cid) for cid in owned | {cid for cid, c in previous["semanticClaims"].items() if nid in c["sourceNodeIds"]}) or any(previous["claimRelations"].get(rid) != context.draft["claimRelations"].get(rid) for rid in relation_ids | {rid for rid, r in previous["claimRelations"].items() if r["fromClaimId"] in owned}) or previous["sourceAccounting"].get(nid) != {"sourceNodeId": nid, "claimIds": row["claim_ids"], "nonSemanticReason": None if row["claim_ids"] else row.get("reason")}
            changed = changed or any(previous["referenceAccounting"].get(rid) != context.draft["referenceAccounting"].get(rid) for rid in units[nid]["referenceIds"])
            if changed and frontier.states.get(nid) in {"REVIEWED_WITH_CLAIMS", "REVIEWED_NO_CLAIMS", "BLOCKED_REFERENCE"}:
                result = frontier.reopen(nid, "Claim file corrected committed semantic material")
                if result["outcome"] != "PASSED":
                    return result
        result = frontier.complete_batch(completions)
        committed = result.get("completedSourceNodeIds", [])
        rejected = {}
        for failure in result.get("failures", []):
            path = node_file.get(failure.get("sourceNodeId"), "_batch")
            rejected.setdefault(path, {}).setdefault("_api", []).append(failure)
        _events(paths, committed, rejected, node_file)
        return {**result, "rejected": rejected, "committedNodes": committed,
            "waitingReferences": [{"file": node_file[nid], "locator": source.locators[nid], "referenceIds": sorted(set(filter(None, refs))), "disposition": "REQUIRES_REFERENCE_RESOLUTION"} for nid, refs in waiting.items()]}


def _events(paths, committed, rejected, node_files=None):
    for path in dict.fromkeys(paths):
        publish_agent_stream_event("CUSTOM_PROGRESS", status="RUNNING", data={"activity_kind": "CLAIM_FILE_COMMITTED", "file": path,
            "committedNodes": [nid for nid in committed if (node_files or {}).get(nid) == path],
            "rejected": rejected.get(path, {})})


HEADING_CONTAINERS = {"ARTICLE", "CHAPTER", "SECTION", "PART", "TITLE", "SUBSECTION"}
HEADING_REASON = "Structural heading only: the node's text is its own label and title"


def is_pure_heading(source, nid):
    """A container node whose whole text is its own label and title: a few short lines, none a sentence.

    This permits a structural disposition when the author leaves the heading unclaimed; a cited Article title remains
    reviewable source support. A container with sentence-final punctuation or more than three lines is left to the author.
    """
    node = source.nodes[nid]
    lines = [line.strip() for line in node["content"].strip().splitlines() if line.strip()]
    return (node["nodeType"] in HEADING_CONTAINERS and bool(source.children.get(nid)) and 0 < len(lines) <= 3
            and sum(map(len, lines)) <= 200 and not any(line.endswith((".", ";", ":", "?", "!")) for line in lines))


def _account_heading_files(context):
    """Commit the claim files of heading-only containers (no claims, factual reason) through the normal commit path."""
    source, frontier, ledger = context.source_graph, context.inventory.frontier, context.inventory
    if frontier is None or not ledger.discovery_allowed():
        return None
    owners = source.reference_owners()
    required = source.review_node_ids()
    paths = []
    for path, ids in source.source_files.items():
        pending = [nid for nid in ids if nid in required and nid not in context.draft["sourceAccounting"]]
        if not pending or len(pending) != len([nid for nid in ids if nid in required]) or any(owner in ids for owner in owners.values()) or not all(is_pure_heading(source, nid) for nid in pending):
            continue
        value = {"article": source.file_articles[path], "claims": [], "references": {},
                 "noClaims": {source.locators[nid]: HEADING_REASON for nid in pending}}
        target = disk_path(context, claim_path(path))
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
        paths.append(claim_path(path))
    if not paths:
        return None
    result = commit_claims(context, paths)
    return {"files": len(paths), "outcome": result.get("outcome"), "committedNodes": len(result.get("committedNodes", []))}


# Only claims that restrict nothing may be released: a forgotten exception, scope or condition would silently widen a duty.
RELEASABLE_TYPES = {"DEFINITION", "CONTEXT"}
RELEASE_REASON = "No duty, prohibition or permission of this law relies on it, so it informs nothing"


def release_unconnected(context, failures):
    """Finalize refuses relevant definitions/context that no operative claim reaches.

    Declaring such a claim non-operative is the disposition the gate itself offers and changes no closure, so it is done here
    instead of sending an author to search the corpus for a use that does not exist. Returns the identities it released
    (empty when nothing changed or the re-commit failed); the finalize reply lists them.
    """
    released = {}
    for failure in failures:
        detail = failure.get("detail") or ""
        claim_id = failure.get("ref", "").removeprefix("claim:") if detail.startswith("UNREACHABLE_RELEVANT_CLAIM") else None
        claim = context.draft["semanticClaims"].get(claim_id or "")
        if claim and claim["claimType"] in RELEASABLE_TYPES and claim_id in context.inventory.identities:
            released[context.inventory.identities[claim_id]] = claim_id
    paths = {}
    for identity in released:
        paths.setdefault("/work/claims/" + identity.partition("#")[0], set()).add(identity)
    for path, wanted in paths.items():
        file = disk_path(context, path)
        value = json.loads(file.read_text(encoding="utf-8"))
        for claim in value["claims"]:
            if identity_key(global_key(path, claim["key"])) in wanted:
                claim.update(relevant=False, nonOperativeReason=RELEASE_REASON, relations=[])
        file.write_text(json.dumps(value, ensure_ascii=False, indent=1), encoding="utf-8")
    return sorted(released) if paths and commit_claims(context, sorted(paths))["outcome"] == "PASSED" else []


def discovery_status(context):
    """Durable progress plus ready-to-delegate assignments: one whole Article per author.

    A claim-author's context grows with every file it holds and each turn re-reads it, so the assignment size is the
    cost lever (measured: one author for 44 articles averaged 61k input tokens per call).
    Heading-only containers (chapter titles) are accounted here without an author.
    """
    headings = _account_heading_files(context)
    with context.mutation_lock:
        result = context.inventory.frontier.progress()
        if result.get("outcome") != "PASSED":
            return result
        source = context.source_graph
        required = source.review_node_ids()
        accounted = context.draft["sourceAccounting"]
        assignments = [{"sourceFiles": [path], "claimFiles": [claim_path(path)],
            "remainingLocators": sum(nid in required and nid not in accounted for nid in ids)}
            for path, ids in source.source_files.items() if any(nid in required and nid not in accounted for nid in ids)]
        if headings:
            result["headingFiles"] = headings
        result["pendingAssignments"] = len(assignments)
        result["assignments"] = assignments
        result["requiredAction"] = "finalize_semantic_claim_inventory" if result["progress"]["discoveryCompleteEligible"] else "task(claim-author) for each assignment, in one turn, then discovery_status"
        return result


def rebuild_claim_files(context):
    """Recover committed file projections from LOAD payloads, never from lost conversations."""
    frontier, source = context.inventory.frontier, context.source_graph
    refused = frontier.restore()
    if refused:
        raise ValueError("Could not restore committed claim files: " + str(refused))
    names = {cid: frontier.inventory.identities[cid] for cid in frontier.inventory.identities}
    for path, ids in source.source_files.items():
        virtual = claim_path(path)
        claims = [c for cid, c in context.draft["semanticClaims"].items() if frontier.claim_owners.get(cid) in ids]
        reviews = {nid: context.draft["sourceAccounting"][nid] for nid in ids if nid in context.draft["sourceAccounting"]}
        if not claims and not reviews:
            continue
        def local_name(cid):
            identity = names[cid]
            return identity.rsplit("#", 1)[-1] if identity.startswith(identity_key(virtual.removeprefix(CLAIMS_ROOT + "/") + "#")) else identity
        rows = []
        for claim in claims:
            cid, operative = claim["claimId"], claim["operative"]
            def destination(target):
                owner_path = claim_path(source.node_files[frontier.claim_owners[target]])
                target_name = names[target].rsplit("#", 1)[-1]
                return target_name if owner_path == virtual else owner_path.removeprefix(CLAIMS_ROOT + "/") + "#" + target_name
            relations = [{"kind": r["kind"], "to": destination(r["toClaimId"]), **({"referenceId": r["referenceId"]} if r.get("referenceId") else {})} for r in context.draft["claimRelations"].values() if r["fromClaimId"] == cid]
            rows.append({"key": local_name(cid), "type": claim["claimType"], "statement": claim["statement"], "actor": operative["actor"] if operative else None, "action": operative["action"] if operative else None,
                "authority": claim["semanticAuthority"], "assessability": claim["assessability"], "frame": claim["semanticFrame"], "relevant": claim["state"] == "RELEVANT", "nonOperativeReason": claim["nonOperativeReason"],
                "support": [{"locator": source.locators[s["nodeId"]], "quote": utf16_slice(source.nodes[s["nodeId"]]["content"], s["startOffset"], s["endOffset"])} for s in claim["sourceSupport"]], "relations": relations})
        covered = {s["locator"] for c in rows for s in c["support"]}
        references = {}
        for rid, owner in source.reference_owners().items():
            if owner in ids:
                account = context.draft["referenceAccounting"].get(rid)
                bound = next(((c, r) for c in rows for r in c["relations"] if r.get("referenceId") == rid), None)
                if bound:
                    c, r = bound
                    references[rid] = {"material": True, "binding": {"from": c["key"], "to": r["to"], "kind": r["kind"]}}
                elif account and not account["material"]:
                    references[rid] = {"material": False, "reason": account["nonMaterialReason"]}
                else:
                    references[rid] = {"material": "UNRESOLVED", "reason": "Persisted review awaits reference resolution"}
        value = {"article": source.file_articles[path], "claims": rows, "noClaims": {source.locators[nid]: reviews[nid]["nonSemanticReason"] if nid in reviews and reviews[nid]["nonSemanticReason"] else "Structural context; persisted source review carries no independent claim" for nid in ids if source.locators[nid] not in covered and (nid in reviews or nid not in source.review_node_ids())}, "references": references}
        target = disk_path(context, virtual)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def build_claim_file_tools(context):
    if context.inventory is None:
        context.inventory = ClaimInventory(context)
    @tool
    def commit_claims_tool(paths: list[str]) -> str:
        """Check files deterministically, then persist one COMPLETE batch. Include both files for circular references."""
        return json.dumps(commit_claims(context, paths), ensure_ascii=False)
    @tool
    def discovery_status_tool() -> str:
        """Read durable frontier progress grouped by claim file, remaining locators and waiting references."""
        return json.dumps(discovery_status(context), ensure_ascii=False)
    result = [commit_claims_tool, discovery_status_tool]
    for item in result:
        item.name = item.name.removesuffix("_tool")
    return result
