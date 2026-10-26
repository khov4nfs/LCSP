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
    """Business purpose: Map one pinned legal-source article path to its corresponding work-area claim JSON path.

    Business rules:
    - The source-relative directory and article name stay aligned while only the `/legal-source/` root and `.md` extension change.

    Execution flow:
    1. Replace the source root with `/work/claims/`.
    2. Replace the Markdown suffix with `.json` and return the virtual path.

    Failure cases:
    - Paths without the expected source root are returned unchanged apart from suffix handling, so callers must validate source membership separately.

    Side effects:
    - None: performs path projection only.
    """
    return source_path.replace("/legal-source/", CLAIMS_ROOT + "/", 1).removesuffix(".md") + ".json"


def disk_path(context, virtual):
    """Business purpose: Resolve an agent-supplied claim-file path to a local file beneath the run's claims directory.

    Business rules:
    - Paths must be absolute `.json` paths under `/work/claims`; parent traversal and symlink escapes are forbidden.

    Execution flow:
    1. Parse and validate the virtual path and suffix.
    2. Resolve it against the run source root.
    3. Confirm the real path stays within `work/claims` and return it.

    Failure cases:
    - Invalid roots, traversal, wrong suffix or symlink escape raise ValueError before file access.

    Side effects:
    - None: resolves a path without reading or writing the file.
    """
    path = PurePosixPath(virtual)
    if not path.is_absolute() or ".." in path.parts or not path.is_relative_to(CLAIMS_ROOT) or path.suffix != ".json":
        raise ValueError("Use an absolute .json path under /work/claims; traversal is forbidden")
    root = context.source_root.resolve()
    local = root / str(path).lstrip("/")
    if not local.resolve().is_relative_to(root / "work/claims"):
        raise ValueError("Claim path escapes /work/claims through a symlink")
    return local


def global_key(path, key):
    """Business purpose: Produce a claim identity key that is unique across claim files.

    Business rules:
    - The file-relative path and claim key are joined with `#` so identical local keys in different articles remain distinct.

    Execution flow:
    1. Remove the `/work/claims/` prefix.
    2. Append the claim key after the separator and return the identity.

    Failure cases:
    - Non-string path/key values violate the caller contract and are not normalized into an identity.

    Side effects:
    - None: pure identity formatting.
    """
    return path.removeprefix(CLAIMS_ROOT + "/") + "#" + key


def target_key(path, target):
    """Business purpose: Resolve a relation target into its claim-file path and local claim key.

    Business rules:
    - A target without `#` belongs to the current file; a cross-file target uses its explicit path, adding `/work/claims/` when needed.

    Execution flow:
    1. Return the current file and full target when no separator exists.
    2. Otherwise split at the final `#`, normalize the target file root and return file/key.

    Failure cases:
    - Empty or malformed components are returned for the later path/identity validator to reject.

    Side effects:
    - None: parses relation address text.
    """
    if "#" not in target:
        return path, target
    file, key = target.rsplit("#", 1)
    return (file if file.startswith("/") else CLAIMS_ROOT + "/" + file), key


# relation kind -> the claim types that may be its FROM (the modifier); the relation points TO the claim it modifies
modifier_types = {"CONDITION_OF": {"SCOPE", "CONDITION"}, "QUALIFIES": {"QUALIFIER"}, "EXCEPTION_TO": {"EXCEPTION"}, "TEMPORALLY_APPLIES_TO": {"TEMPORAL_RULE", "TRANSITION_RULE"}}


def _normalize(value):
    """Mechanical defaults for omitted fields, applied after schema validation: the rest of the pipeline sees the full shape.

    Business purpose: Expand schema-valid claim-file JSON into the complete internal shape used by deterministic claim checks.

    Business rules:
    - Omitted optional fields receive established defaults; modifier relations may be reversed to the modifier claim, and a material reference binding implies its corresponding outgoing relation.

    Execution flow:
    1. Add default no-claims, references, claim fields and relation lists.
    2. Reorient modifier relations that were written from the affected claim.
    3. Add missing relations implied by material reference bindings.

    Failure cases:
    - Invalid nested shapes raise during normalization; the caller runs it only after schema validation passes.

    Side effects:
    - Mutates the in-memory loaded claim-file value; it does not write the file or commit claims.
    """
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
    """A legalEffect target is cited as printed under /legal-source (<document>#<locator>); its node id is looked up here.

    Business purpose: Resolve printed legal-effect target locators to node IDs in the pinned source graph.

    Business rules:
    - Only targets that resolve from their document/locator are rewritten; unresolved printed addresses remain as supplied for validation.

    Execution flow:
    1. Inspect each claim's legal-effect frame and its targets.
    2. Split each printed `document#locator` address and resolve it through the source graph.
    3. Replace the address with the node ID when a node is found.

    Failure cases:
    - Missing or malformed frame data is skipped where the shape is unsupported; unresolved locators are left for the integrity gate.

    Side effects:
    - Mutates the loaded value's target identifiers in memory; no durable source or claim state changes.
    """
    for claim in value.get("claims", []) if isinstance(value, dict) else []:
        effect = (claim.get("frame") or {}).get("legalEffect") if isinstance(claim, dict) and isinstance(claim.get("frame"), dict) else None
        for target in (effect or {}).get("targets", []):
            document, _, locator = str(target.get("nodeId", "")).partition("#")
            node = source.resolve_locator(document, locator) if locator else None
            if node:
                target["nodeId"] = node


def _schema_issues(issue):
    """Business purpose: Flatten nested JSON Schema anyOf failures into the actionable leaf issues shown for a claim file.

    Business rules:
    - Generic type alternatives at the same path are suppressed when a more specific nested validator failure exists.

    Execution flow:
    1. Inspect whether the issue is an anyOf failure.
    2. Recurse into useful nested contexts when present.
    3. Otherwise return the issue itself as a one-item list.

    Failure cases:
    - An anyOf with no informative children remains a direct validation failure.

    Side effects:
    - None: projects schema errors without changing the input.
    """
    if issue.validator == "anyOf":
        nested = [child for child in issue.context if child.validator != "type" or child.absolute_path != issue.absolute_path]
        if nested:
            return [leaf for child in nested for leaf in _schema_issues(child)]
    return [issue]


def _load(context, path):
    """Business purpose: Load and deterministically validate one claim JSON file against its pinned article and claim-file schema.

    Business rules:
    - Only safe `/work/claims` paths are read; legal-effect locators are resolved against the pinned source, and defaults are applied only after schema validation succeeds.

    Execution flow:
    1. Resolve and read UTF-8 JSON from the run work area.
    2. Parse and resolve printed effect targets, attaching location-specific parse errors when JSON is malformed.
    3. Collect sorted leaf schema issues and normalize the value only when valid.
    4. Return the normalized value and validation issues.

    Failure cases:
    - Path, decoding and JSON errors propagate to the deterministic caller; schema failures are returned without normalization.

    Side effects:
    - Reads one local claim file and changes only the loaded in-memory value.
    """
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

    Business purpose: Convert a claim-file support quote and printed locator into an exact span in pinned legal text.

    Business rules:
    - A quote must match source text verbatim; a wrong locator can be repaired only when the quote occurs in exactly one node of the same article.

    Execution flow:
    1. Resolve the printed locator and validate the quote against that node.
    2. If it does not fit, search the article for a unique exact quote and return its actual node and locator.
    3. Otherwise raise a typed support error with the allowed repair guidance.

    Failure cases:
    - Invalid quotes raise SOURCE_SUPPORT_INVALID; unknown locators raise LOCATOR_UNKNOWN rather than accepting unverified support.

    Side effects:
    - None: reads pinned source and returns its exact support span.
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
    """Business purpose: Identify references whose resolved target is a source document reserved for reference-only use.

    Business rules:
    - A target is reference-only only when the reference is RESOLVED and the pinned graph confirms the target node's role.

    Execution flow:
    1. Read the reference record, defaulting missing identities to an empty record.
    2. Check resolution state and target role.
    3. Return the boolean result.

    Failure cases:
    - Missing or unresolved references return false; they are not assumed to be reference-only.

    Side effects:
    - None: reads pinned reference metadata.
    """
    reference = source.references.get(reference_id, {})
    return reference.get("resolutionState") == "RESOLVED" and source.is_reference_only(reference.get("toNodeId"))


def check_claims(context, paths):
    """Collect every deterministic error. No draft mutation, API call or model invocation.

    Business purpose: Validate a set of article claim files and produce claim candidates without mutating the inventory or calling the API.

    Business rules:
    - Every reviewable source locator and explicit reference must be accounted for; claim identity, source version, actor/action roles, quotes, typed relations and legal-effect data must match pinned evidence.
    - The function reports deterministic schema/provenance errors only; it does not interpret substantive law.

    Execution flow:
    1. Load each unique safe path and collect JSON/schema/article identity failures.
    2. Validate claim keys, operative fields, exact source support, structural coverage and reference dispositions.
    3. Resolve relation endpoints and check relation direction, operative targets and exact reference binding.
    4. Return grouped errors together with valid loaded files and candidate claims.

    Failure cases:
    - Empty path lists, unreadable or invalid files, uncovered locators, unknown references and unsupported links return explicit failures; no candidate is accepted through an invalid file.

    Side effects:
    - Reads claim files and builds in-memory validation results/candidates only; no draft, API or model state is changed.
    """
    if not paths:
        return {"outcome": "FAILED", "errors": {"_request": {"_file": [{"code": "CLAIM_PATHS_EMPTY", "fix": "Supply at least one /work/claims .json path"}]}}}, {}, {}
    source, errors, files, candidates = context.source_graph, {}, {}, {}
    reference_owners = source.reference_owners()
    review_units = source.review_node_ids()
    file_nodes = {claim_path(p): ids for p, ids in source.source_files.items()}

    def error(path, key, code, detail, fix):
        """Business purpose: Group one claim-file validation issue under its file and claim key.

        Business rules:
        - Each error retains a stable code, detail and repair instruction and is appended without replacing earlier errors.

        Execution flow:
        1. Create the file and claim buckets when absent.
        2. Append the structured issue to the selected claim's error list.

        Failure cases:
        - Malformed error data propagates as caller misuse rather than erasing prior issues.

        Side effects:
        - Mutates only the local grouped error accumulator.
        """
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
        """Business purpose: Resolve a relation endpoint to the deterministic candidate identity supported by a claim file.

        Business rules:
        - Prefer the already validated candidate in the current batch; otherwise load the target file and derive its identity from pinned source support.

        Execution flow:
        1. Return the current-batch candidate when present.
        2. Load and validate the target file, find the requested claim key and resolve its support nodes.
        3. Return endpoint identity/provenance or `None` when it cannot be verified.

        Failure cases:
        - Invalid files, missing keys, unresolvable support and file/path errors return `None` so the caller reports a missing target.

        Side effects:
        - Reads files and builds a transient endpoint projection; it does not commit the target claim.
        """
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
    """Business purpose: Build the existing governed claim-operation callbacks used by claim-file commits.

    Business rules:
    - Claim-file persistence reuses the same register/update/link/remove/reference operations as interactive discovery.

    Execution flow:
    1. Create an operation mapping.
    2. Bind the existing claim tools to the run context and mapping.
    3. Return the populated operations.

    Failure cases:
    - Tool construction errors propagate; no fallback mutation path is created.

    Side effects:
    - Constructs callbacks in memory; operation effects occur only when callers invoke them.
    """
    operations = {}
    build_claim_tools(context, operations=operations)
    return operations


def commit_claims(context, paths):
    """Business purpose: Validate claim files and submit their reviewed source units to the durable source-review frontier.

    Business rules:
    - Discovery must remain open and use the persisted frontier; commits adopt INIT-authorized review units rather than acquiring NEXT leases.
    - Claims, outgoing relations, reference decisions and each unit's disposition must be source-backed and complete before the API marks units reviewed; local draft operations stage before the COMPLETE request.

    Execution flow:
    1. Under the run mutation lock, validate all files and reject the batch with per-file progress events if any deterministic issue exists.
    2. Restore the frontier, verify discovery eligibility and adopt only the pinned review units represented by the files.
    3. Register/update claims, remove omitted owned claims, replace outgoing relations and apply material/non-material reference accounting.
    4. Build unit completion dispositions, reopen changed reviewed units, then persist one COMPLETE batch.
    5. Reload durable authority, project API failures into file feedback and publish commit events.

    Failure cases:
    - Frozen discovery, missing frontier, stale/refused restore, unsupported source ownership, detached references or API validation failures stop or reject the batch; failures before COMPLETE may leave local staged draft changes, while durable review completion remains API-owned.

    Side effects:
    - Mutates run-local draft/frontier projections, invokes governed inventory/source-review operations, writes claim-file review results and publishes per-file progress events.
    """
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
    """Business purpose: Publish one progress event per submitted claim file with its committed units and rejection details.

    Business rules:
    - Duplicate input paths emit once; committed nodes are associated only through the supplied node-to-file mapping.

    Execution flow:
    1. Iterate unique requested file paths.
    2. Select that file's committed nodes and rejection projection.
    3. Publish a RUNNING CLAIM_FILE_COMMITTED event.

    Failure cases:
    - Stream publication errors propagate; the event is observational and does not reverse the commit.

    Side effects:
    - Emits agent progress events only.
    """
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

    Business purpose: Decide whether a structural source node may receive the standard no-claim disposition without semantic review.

    Business rules:
    - Only a nonempty container with children, at most three short lines and no sentence-final punctuation qualifies; a cited article title is still reviewable support.

    Execution flow:
    1. Normalize nonempty source lines.
    2. Check the node's container type, child presence, line/count bounds and punctuation.
    3. Return whether the node is only a heading.

    Failure cases:
    - Missing node/source data propagates; non-qualifying content remains for an author rather than being released.

    Side effects:
    - None: classifies source structure without writing a disposition.
    """
    node = source.nodes[nid]
    lines = [line.strip() for line in node["content"].strip().splitlines() if line.strip()]
    return (node["nodeType"] in HEADING_CONTAINERS and bool(source.children.get(nid)) and 0 < len(lines) <= 3
            and sum(map(len, lines)) <= 200 and not any(line.endswith((".", ";", ":", "?", "!")) for line in lines))


def _account_heading_files(context):
    """Commit the claim files of heading-only containers (no claims, factual reason) through the normal commit path.

    Business purpose: Account for claim files containing only eligible structural headings through the normal source-review commit path.

    Business rules:
    - Discovery must be open and a frontier must exist; every required node in a file must be pending and a pure heading, with no owned references.

    Execution flow:
    1. Identify complete pending heading-only files.
    2. Write a claim file with no semantic claims and the fixed structural reason for each locator.
    3. Commit those files with the standard claim-file operation and return its bounded summary.

    Failure cases:
    - Ineligible phase/frontier or no eligible files returns `None`; commit failures are reported in the summary and do not mark units complete independently.

    Side effects:
    - Writes generated claim JSON files and invokes the durable commit path for qualifying headings.
    """
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

    Business purpose: Close only unreachable definition/context claims that the inventory gate identifies as non-operative.

    Business rules:
    - A claim is releasable only when the failure detail starts with UNREACHABLE_RELEVANT_CLAIM, its type is DEFINITION or CONTEXT, and its identity is present in the inventory; operative claims and restrictions are never released.

    Execution flow:
    1. Match gate failures to eligible persisted claim identities.
    2. Rewrite only those claims as irrelevant with the fixed source-faithful reason and remove their outgoing relations.
    3. Recommit the affected claim files and return identities only after a successful commit.

    Failure cases:
    - No eligible claims or a rejected recommit returns an empty list; file/JSON errors propagate for recovery.

    Side effects:
    - Rewrites local claim files and may persist the narrowed claim inventory through `commit_claims`.
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

    Business purpose: Show durable source-review progress and delegate each remaining whole Article as a claim-file assignment.

    Business rules:
    - Progress and assignments derive from the pinned source review units and persisted accounting; heading-only files may be handled automatically.
    - Finalization is offered only when the frontier says discovery is complete.

    Execution flow:
    1. Account eligible heading-only files.
    2. Under the mutation lock, query durable frontier progress.
    3. Group remaining review locators by source file and return the required discovery or finalization action.

    Failure cases:
    - Frontier refusals are returned unchanged; an incomplete or failed progress query is not presented as complete.

    Side effects:
    - May generate/commit heading-only claim files and reads persisted source-review progress.
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
    """Recover committed file projections from LOAD payloads, never from lost conversations.

    Business purpose: Reconstruct local claim-file projections from durable source-review LOAD payloads after a worker resumes.

    Business rules:
    - Persisted claims, identities, relations, reference accounting and source dispositions are authoritative; lost agent conversation is never used to recreate evidence.

    Execution flow:
    1. Restore the frontier and fail if durable state cannot be loaded.
    2. Group committed claims and reviews by pinned source file, rebuilding local and cross-file relation addresses.
    3. Reconstruct exact source quotes, no-claim reasons and reference decisions from persisted evidence.
    4. Write each nonempty reconstructed claim JSON file beneath the work area.

    Failure cases:
    - Restore, identity, source-locator or file-write failures propagate; no conversation-derived claim is substituted.

    Side effects:
    - Reads durable frontier state and writes reconstructed local claim files.
    """
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
            """Business purpose: Convert a persisted global claim identity back to its claim-file-local key when it belongs to the current file.

            Business rules:
            - Strip the current file identity prefix only for an exact normalized prefix match; preserve cross-file identities intact.

            Execution flow:
            1. Read the persisted global identity for the claim.
            2. Compare it with the current virtual claim-file prefix.
            3. Return the local key on match, otherwise the full identity.

            Failure cases:
            - Missing persisted identity fails visibly rather than creating a new local key.

            Side effects:
            - None: formats a reconstructed key.
            """
            identity = names[cid]
            return identity.rsplit("#", 1)[-1] if identity.startswith(identity_key(virtual.removeprefix(CLAIMS_ROOT + "/") + "#")) else identity
        rows = []
        for claim in claims:
            cid, operative = claim["claimId"], claim["operative"]
            def destination(target):
                """Business purpose: Render one persisted relation target as a local or cross-file claim-file address.

                Business rules:
                - Same-file relations use only the target key; cross-file relations include the target file beneath `/work/claims`.

                Execution flow:
                1. Resolve the target claim's persisted owner node and source file.
                2. Read its stable local key.
                3. Return the correctly scoped relation address.

                Failure cases:
                - Missing owner, source file or persisted identity propagates instead of emitting a guessed target.

                Side effects:
                - None: builds a relation address for reconstruction.
                """
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
    """Business purpose: Expose governed claim-file commit and durable discovery-status tools for one preparation run.

    Business rules:
    - A ClaimInventory is initialized only when absent; tool calls are bound to the supplied run context and preserve server-controlled API operations.

    Execution flow:
    1. Ensure the run has its claim inventory.
    2. Create the commit and status tool wrappers.
    3. Remove the implementation-only `_tool` suffix from their public names and return them.

    Failure cases:
    - Tool/schema construction errors propagate; no ungoverned file mutation tool is substituted.

    Side effects:
    - May initialize run-local ClaimInventory and returns model-facing tool objects; tool effects occur on invocation.
    """
    if context.inventory is None:
        context.inventory = ClaimInventory(context)
    @tool
    def commit_claims_tool(paths: list[str]) -> str:
        """Check files deterministically, then persist one COMPLETE batch. Include both files for circular references.

        Business purpose: Let the agent submit one or more claim files to deterministic validation and durable source review.

        Business rules:
        - Claim contents are checked against pinned source and frontier rules; cross-reference cycles require both source files in the same batch.

        Execution flow:
        1. Pass the supplied virtual paths to `commit_claims`.
        2. Serialize its grouped validation or commit result for the agent.

        Failure cases:
        - Invalid paths, evidence, references, phase or frontier state return the governed failure result; they are not represented as committed.

        Side effects:
        - Invocation may read/write claim files, mutate the run draft and persist source-review state through the existing API.
        """
        return json.dumps(commit_claims(context, paths), ensure_ascii=False)
    @tool
    def discovery_status_tool() -> str:
        """Read durable frontier progress grouped by claim file, remaining locators and waiting references.

        Business purpose: Let the agent inspect durable discovery progress and the remaining whole-Article claim assignments.

        Business rules:
        - Status derives from the pinned review frontier and durable source accounting; it does not infer completion from conversation history.

        Execution flow:
        1. Query `discovery_status` for the current run.
        2. Serialize frontier progress, assignments and the required next action.

        Failure cases:
        - Restore or progress failures remain visible in the returned result.

        Side effects:
        - Invocation may automatically account and commit eligible heading-only files; otherwise it reads durable status.
        """
        return json.dumps(discovery_status(context), ensure_ascii=False)
    result = [commit_claims_tool, discovery_status_tool]
    for item in result:
        item.name = item.name.removesuffix("_tool")
    return result
