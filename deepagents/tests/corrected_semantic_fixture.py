"""Human-reviewed assertion graph over the EXACT retained source, never a golden Rule Set.

This is test data: legal interpretation lives here and in the two model roles, not in production parsers.
Requirements/AssessmentRules are generated through the real authoring tools from verified closures.
"""
from copy import deepcopy

from rule_set_preparation.claim_inventory import claim_id, fingerprint, normalized_graph
from rule_set_preparation.semantic_audit import FRAME_FIELDS, canonical_support
from semantic_fidelity_harness import retained


def corrected_graph():
    fixture, source, meta = retained()
    run_id = fixture["identity"]["preparationRunId"]
    claims, keys, identities, relations = [], {}, {}, []

    def node(path):
        return next(n for n in source.nodes.values() if n["structuralPath"].endswith("/" + path))

    def add(key, path, kind, start, end, *, actor=None, action=None, statement=None, authority=None, assessability="NON_ASSESSABLE", **frame):
        n = node(path)
        begin = n["content"].index(start)
        finish = n["content"].index(end, begin) + len(end)
        passage = n["content"][begin:finish]
        support = canonical_support(source, [n["nodeId"]], [{"nodeId": n["nodeId"], "startOffset": len(n["content"][:begin].encode("utf-16-le")) // 2, "endOffset": len(n["content"][:finish].encode("utf-16-le")) // 2}])
        cid = claim_id(run_id, 1, [n["nodeId"]], key)
        c = {"claimId": cid, "legalSourceVersionId": source.version, "sourceNodeIds": [n["nodeId"]], "sourceSupport": support, "claimType": kind,
             "statement": statement or " ".join(passage.split()), "operative": {"actor": actor, "modality": kind, "action": action} if kind in {"DUTY", "PROHIBITION", "PERMISSION"} else None,
             "semanticAuthority": authority or ("DEFINITION" if kind == "DEFINITION" else "CONTEXT" if kind == "CONTEXT" else "LEGAL_NORMATIVE"), "assessability": assessability,
             "semanticFrame": {k: frame.get(k) for k in FRAME_FIELDS}, "state": "RELEVANT", "nonOperativeReason": None}
        claims.append(c); keys[key] = c; identities[cid] = key

    def support(key, quote):
        c = keys[key]
        n = source.nodes[c["sourceNodeIds"][0]]
        start = n["content"].index(quote)
        span = {"nodeId": n["nodeId"], "startOffset": len(n["content"][:start].encode("utf-16-le")) // 2, "endOffset": len(n["content"][:start + len(quote)].encode("utf-16-le")) // 2}
        c["sourceSupport"] = canonical_support(source, c["sourceNodeIds"], [*c["sourceSupport"], span])

    def edge(origin, target, kind, reference_id=None):
        row = {"fromClaimId": keys[origin]["claimId"], "toClaimId": keys[target]["claimId"], "kind": kind, "referenceId": reference_id}
        row["relationId"] = fingerprint(row)
        if row not in relations:
            relations.append(row)

    a1, a21, a22, a31, a32 = "article/1", "article/2/paragraph/1", "article/2/paragraph/2", "article/3/paragraph/1", "article/3/paragraph/2"
    a4, a5, a61, a62, a7, a8 = "article/4", "article/5", "article/6/paragraph/1", "article/6/paragraph/2", "article/7", "article/8"
    add("def.service", a1, "DEFINITION", "A covered service", "digital interface.", object="covered service", scope="Stores customer-created records and offers them through a digital interface")
    add("def.operator", a1, "DEFINITION", "The\noperator", "that service.", object="operator", scope="Controls the covered service")
    add("def.copy", a1, "DEFINITION", "A portable copy", "machine-readable format.", object="portable copy", scope="All customer-created records; interoperable machine-readable format")
    add("def.provider", a1, "DEFINITION", "A fulfillment provider", "export software.", object="fulfillment provider", scope="Separate entity selected by the operator to run its export software")
    add("context.definitions", a1, "CONTEXT", "These definitions", "this instrument.")
    add("def.repository", a61, "DEFINITION", "Repository storage means", "customer-created records.", object="repository storage")
    add("def.audit", a61, "DEFINITION", "An audit entry means", "export request.", object="audit entry")
    add("context.definitions-only", a61, "CONTEXT", "This paragraph supplies", "permission.")

    add("export.software", a21, "DUTY", "The operator", "requesting customer.", actor="operator of a covered service", action="implement a software export function that produces a portable copy for a requesting customer", assessability="REPOSITORY_VERIFIABLE", object="portable copy", beneficiary="requesting customer", scope="covered service")
    add("export.delivery", a21, "DUTY", "The operator must deliver", "receiving the request.", actor="operator of a covered service", action="deliver the portable copy within seven calendar days after receiving the request", assessability="EXTERNAL_FULFILLMENT", object="portable copy", beneficiary="requesting customer", trigger="receiving the customer's request", temporalApplicability="within seven calendar days", externalFulfillmentAspect="Actual timely fulfillment of an individual request")
    add("scope.export", a21, "SCOPE", "The operator of a covered service", "covered service", statement="The export duties address the operator of a covered service, with the defined covered-service and operator criteria.", scope="operator of a covered service")
    add("condition.request", a21, "CONDITION", "The operator must deliver", "receiving the request.", statement="The operator has received a customer's portable-copy request.", trigger="receiving the request")
    add("context.delivery-distinct", a21, "CONTEXT", "The implemented export function", "individual request.")
    add("portability.prohibition", a22, "PROHIBITION", "The operator must not", "another service.", actor="operator", action="impose commercial charges or technical obstacles intended to prevent a customer moving their customer-created records to another service", assessability="MIXED", object="commercial charges and technical obstacles", beneficiary="customer moving records", qualifier="For both charges and obstacles: intended to prevent portability", repositoryObservableAspect="Repository-visible charging logic and technical controls governing portability", externalFulfillmentAspect="Actual charges, obstacles, purpose and customer circumstances require fulfillment evidence")
    add("scope.portability", a22, "SCOPE", "The operator", "The operator", statement="The portability prohibition addresses the operator of the defined covered service.", scope="operator of a covered service")
    add("qualifier.purpose", a22, "QUALIFIER", "For both charges", "generally.", qualifier="Purpose limitation covers both charges and obstacles, not charges generally")

    add("compensation.payment", a31, "DUTY", "If failure", "the loss.", actor="operator", action="compensate the customer for documented loss within thirty calendar days after receiving notice of the loss", assessability="EXTERNAL_FULFILLMENT", beneficiary="customer with documented financial loss", trigger="Failure to perform Article 2(1) causes documented financial loss", temporalApplicability="Thirty calendar days after notice", externalFulfillmentAspect="Actual compensation payment")
    add("condition.loss", a31, "CONDITION", "If failure", "documented financial loss", trigger="Failure to perform Article 2(1) causes a customer documented financial loss")
    add("context.policy-not-payment", a31, "CONTEXT", "A compensation policy", "payment duty.")

    add("exception.transfer", a32, "EXCEPTION", "As an exception", "transfer unsafe.", exception="Temporary proportionate block only while a documented specific security threat makes the transfer unsafe", temporalApplicability="Ends when the threat ends")
    add("transfer.permission", a32, "PERMISSION", "As an exception", "transfer unsafe.", actor="operator", action="temporarily block a transfer only while a documented specific security threat makes that transfer unsafe", assessability="MIXED", trigger="documented specific security threat makes transfer unsafe", repositoryObservableAspect="Repository-visible conditional transfer restriction controls", externalFulfillmentAspect="Actual security threat and exercise of a transfer block")
    add("transfer.proportionate", a32, "DUTY", "The block must", "threat ends.", actor="operator", action="keep any temporary transfer block proportionate to the documented specific security threat", assessability="MIXED", repositoryObservableAspect="Repository-visible limits on transfer-block scope", externalFulfillmentAspect="Actual threat and proportionality of an exercised block")
    add("transfer.end", a32, "DUTY", "The block must", "threat ends.", actor="operator", action="end the temporary transfer block when the security threat ends", assessability="MIXED", trigger="the threat ends", repositoryObservableAspect="Repository-visible termination of the transfer-block state", externalFulfillmentAspect="Whether the threat actually ended and the exercised block ceased")
    add("condition.threat", a32, "CONDITION", "only while a", "transfer unsafe.", trigger="Documented specific security threat makes the transfer unsafe")
    add("condition.block-used", a32, "CONDITION", "The block must", "threat ends.", statement="If a temporary transfer block is exercised, its proportionality and cessation duties apply.", trigger="The operator exercises the temporary transfer-block permission")
    add("condition.threat-ended", a32, "CONDITION", "end when", "threat ends.", trigger="The security threat ends")
    add("preserves.no-delay", a32, "CONTEXT", "This exception", "Article 2(1).", authority="LEGAL_NORMATIVE", qualifier="Does not remove or delay either Article 2(1) portable-copy aspect")
    support("exception.transfer", "This exception does not remove or delay the portable-copy duty in\nArticle 2(1).")
    keys["exception.transfer"]["semanticFrame"]["qualifier"] = "Does not remove or delay the positive Article 2(1) export duty"

    add("temporal.effective", a4, "CONTEXT", "This instrument takes effect", "1 January 2026.", authority="LEGAL_NORMATIVE", scope="entire instrument", temporalApplicability="Instrument effective 1 January 2026; distinct from cohort-specific commencement of particular duties")
    add("temporal.existing", a4, "TEMPORAL_RULE", "For covered services already", "transition.", scope="Covered services operating before 1 January 2026", temporalApplicability="Article 2(1) and Article 2(2) duties become applicable on 1 July 2026 after six months")
    add("temporal.new", a4, "TEMPORAL_RULE", "For covered services first", "operation.", scope="Covered services first operating on or after 1 January 2026", temporalApplicability="Article 2 duties apply immediately on first operation")
    add("cohort.existing", a4, "SCOPE", "covered services already operating", "that date", scope="operating before 1 January 2026")
    add("cohort.new", a4, "SCOPE", "covered services first operating", "1 January 2026", scope="first operating on or after 1 January 2026")

    add("provider.software", a5, "DUTY", "When an operator delegates", "Article\n2(1)", statement="When the operator delegates export fulfillment, the external fulfillment provider must implement the portable-copy software function required by Article 2(1), with the definitions in Article 1.", actor="external fulfillment provider", action="implement the portable-copy software function required by Article 2(1) on delegation", object="software function producing a portable copy", assessability="REPOSITORY_VERIFIABLE", trigger="operator delegates export fulfillment")
    add("provider.delivery", a5, "DUTY", "When an operator delegates", "Article 1.", statement="On delegation the external fulfillment provider must perform the same actual delivery duty as Article 2(1), within the same seven-day period.", actor="external fulfillment provider", action="perform the delegated portable-copy delivery duty within the same seven-day period", object="portable copy", assessability="EXTERNAL_FULFILLMENT", trigger="operator delegates export fulfillment", temporalApplicability="Same seven-day period as Article 2(1)", externalFulfillmentAspect="Actual delegated delivery")
    add("condition.delegation", a5, "CONDITION", "When an operator delegates", "fulfillment provider", trigger="operator delegates export fulfillment to an external fulfillment provider")
    add("preserves.operator", a5, "CONTEXT", "Delegation does not remove", "own duty.", authority="LEGAL_NORMATIVE")

    add("configuration.service", a62, "DUTY", "The operator must maintain", "covered service.", actor="operator", action="maintain a software configuration identifying the relevant covered service", assessability="REPOSITORY_VERIFIABLE", object="software configuration identifying the relevant covered service")
    add("audit.authorization", a62, "DUTY", "For its\nexport function", "audit entry", actor="operator", action="record the export authorization decision in an audit entry", assessability="REPOSITORY_VERIFIABLE", object="export authorization decision")
    add("audit.outcome", a62, "DUTY", "must record\ncompletion", "audit entry.", actor="operator", action="record export completion or failure with its timestamp in the audit entry", assessability="REPOSITORY_VERIFIABLE", object="completion or failure and timestamp")
    support("audit.outcome", "For its\nexport function, the operator")
    add("safeguards", a62, "DUTY", "The operator must implement", "processing and export.", actor="operator", action="implement appropriate software safeguards protecting customer-created records during processing and export", assessability="REPOSITORY_VERIFIABLE", object="customer-created records during processing and export")
    add("scope.configuration", a62, "SCOPE", "The operator must maintain", "covered service.", statement="The applicable addressee is the operator of the defined covered service.", scope="operator of a covered service")
    support("scope.configuration", "For its\nexport function, the operator")
    support("scope.configuration", "The operator must implement appropriate software safeguards")
    add("guidance.encryption", a62, "PERMISSION", "A repository assessment may inspect", "particular cipher.", actor="repository assessment", action="inspect storage encryption as one narrower evidence slice without replacing the safeguards duty or requiring a particular cipher", authority="EVIDENCE_GUIDANCE", qualifier="Evidence slice only; no replacement duty or mandatory cipher")
    add("context.audit-aggregation", a62, "CONTEXT", "These two audit duties", "combined representation.")

    add("def.actor-a", a7, "DEFINITION", "Actor A is", "Article 2(1).", object="Actor A", scope="covered-service operator and holder of Article 2(1)")
    add("def.actor-b", a7, "DEFINITION", "Actor B is", "fulfillment provider.", object="Actor B", scope="fulfillment provider")
    add("delegation.configuration", a7, "DUTY", "If A delegates", "that service", actor="Actor A", action="maintain a software configuration identifying B as its delegate for that service", assessability="REPOSITORY_VERIFIABLE", beneficiary="requesting record owner", trigger="A delegates export fulfillment to B")
    add("delegation.path", a7, "DUTY", "B must implement", "behalf of A.", actor="Actor B", action="implement the delegated portable-copy software path on behalf of A", assessability="REPOSITORY_VERIFIABLE", beneficiary="requesting record owner", trigger="A delegates export fulfillment to B")
    add("condition.direction", a7, "CONDITION", "If A delegates", "fulfillment to B", statement="Actor A delegates export fulfillment to Actor B; B delegating to A is not this condition.", trigger="A delegates to B, not B to A")
    support("condition.direction", "B delegating to A is not this condition.")
    add("preserves.responsibility", a7, "CONTEXT", "B performs fulfillment", "A's duty.", authority="LEGAL_NORMATIVE")
    add("context.beneficiary", a7, "CONTEXT", "The customer is", "export-fulfillment duty.", beneficiary="requesting record owner", qualifier="An auditor owes no export-fulfillment duty")

    add("access.permission", a8, "PERMISSION", "The operator may restrict", "access unsafe.", actor="operator", action="restrict access to the export interface only while a documented specific security incident makes access unsafe", assessability="MIXED", trigger="Documented specific security incident makes access unsafe", repositoryObservableAspect="Repository-visible conditional access restriction controls", externalFulfillmentAspect="Actual incident, unsafe access and exercise of a restriction")
    add("access.end", a8, "DUTY", "The restriction must end", "condition ceases.", actor="operator", action="end the export-interface access restriction when the unsafe-access condition ceases", assessability="MIXED", trigger="unsafe-access condition ceases", repositoryObservableAspect="Repository-visible termination of an access restriction", externalFulfillmentAspect="Actual cessation of the incident/unsafe condition and exercised restriction")
    add("condition.incident", a8, "CONDITION", "only while a", "access unsafe.", trigger="Documented specific security incident makes export-interface access unsafe")
    add("condition.incident-ended", a8, "CONDITION", "when that condition", "condition ceases.", trigger="The documented unsafe-access condition ceases")
    add("guidance.condition-evidence", a8, "CONTEXT", "Evidence must", "respects it.", authority="ASSESSMENT_GUIDANCE")
    add("context.no-automatic-control", a8, "CONTEXT", "This Article does not", "technical implementation.", qualifier="No automatic blocking, automatic unblocking or particular implementation is required")

    for target in ["export.software", "export.delivery"]:
        edge("scope.export", target, "CONDITION_OF")
        edge(target, "def.copy", "DEFINED_BY")
        edge(target, "def.service", "DEFINED_BY")
        edge(target, "def.operator", "DEFINED_BY")
        edge("context.delivery-distinct", target, "CONTEXT_FOR")
        for origin in ["exception.transfer", "preserves.no-delay", "preserves.operator", "preserves.responsibility"]:
            edge(origin, target, "PRESERVES")
    edge("condition.request", "export.delivery", "CONDITION_OF")
    edge("scope.portability", "portability.prohibition", "CONDITION_OF")
    for key in ["portability.prohibition", "scope.portability"]:
        for definition in ["def.operator", "def.service"]:
            edge(key, definition, "DEFINED_BY")
    edge("qualifier.purpose", "portability.prohibition", "QUALIFIES")
    edge("exception.transfer", "portability.prohibition", "EXCEPTION_TO")
    edge("portability.prohibition", "exception.transfer", "INCORPORATES")
    edge("preserves.no-delay", "exception.transfer", "CONTEXT_FOR")
    edge("condition.threat", "exception.transfer", "CONDITION_OF")
    edge("condition.threat", "transfer.permission", "CONDITION_OF")
    for target in ["transfer.proportionate", "transfer.end"]:
        edge("condition.block-used", target, "CONDITION_OF")
    edge("condition.threat-ended", "transfer.end", "CONDITION_OF")
    for target in ["transfer.permission", "transfer.proportionate", "transfer.end"]:
        edge("exception.transfer", target, "CONTEXT_FOR")
    edge("condition.loss", "compensation.payment", "CONDITION_OF")
    edge("context.policy-not-payment", "compensation.payment", "CONTEXT_FOR")
    edge("condition.loss", "export.delivery", "CROSS_REFERENCE")
    for target in ["export.software", "export.delivery", "portability.prohibition"]:
        for branch in ["temporal.existing", "temporal.new"]:
            edge(branch, target, "TEMPORALLY_APPLIES_TO")
    edge("cohort.existing", "temporal.existing", "CONDITION_OF")
    edge("cohort.new", "temporal.new", "CONDITION_OF")
    for target in ["provider.software", "provider.delivery"]:
        edge("condition.delegation", target, "CONDITION_OF")
        edge(target, "def.provider", "DEFINED_BY")
        edge(target, "def.copy", "DEFINED_BY")
    edge("provider.software", "export.software", "INCORPORATES")
    edge("provider.delivery", "export.delivery", "INCORPORATES")
    for target in ["configuration.service", "audit.authorization", "audit.outcome", "safeguards"]:
        edge("scope.configuration", target, "CONDITION_OF")
    edge("configuration.service", "def.service", "DEFINED_BY")
    edge("def.repository", "guidance.encryption", "CONTEXT_FOR")
    for target in ["audit.authorization", "audit.outcome"]:
        edge(target, "def.audit", "DEFINED_BY")
        edge("context.audit-aggregation", target, "CONTEXT_FOR")
    edge("guidance.encryption", "safeguards", "EVIDENCE_SLICE_OF")
    for target in ["delegation.configuration", "delegation.path"]:
        edge("condition.direction", target, "CONDITION_OF")
        for definition in ["def.actor-a", "def.actor-b"]:
            edge(target, definition, "DEFINED_BY")
        edge("context.beneficiary", target, "CONTEXT_FOR")
    edge("delegation.path", "provider.software", "CROSS_REFERENCE")
    edge("condition.incident", "access.permission", "CONDITION_OF")
    edge("condition.incident-ended", "access.end", "CONDITION_OF")
    for target in ["access.permission", "access.end"]:
        edge("guidance.condition-evidence", target, "EVIDENCE_SLICE_OF")
        edge("context.no-automatic-control", target, "CONTEXT_FOR")
    # Defined terms remain reachable through their actual semantic dependency chain.
    edge("def.operator", "def.service", "DEFINED_BY")
    edge("def.actor-a", "def.operator", "DEFINED_BY")
    edge("def.actor-b", "def.provider", "DEFINED_BY")
    for target in ["compensation.payment", "transfer.permission", "transfer.proportionate", "transfer.end",
                   "configuration.service", "audit.authorization", "audit.outcome", "safeguards",
                   "access.permission", "access.end"]:
        edge(target, "def.operator", "DEFINED_BY")
    for key, claim in keys.items():
        if claim["operative"] and claim["semanticAuthority"] == "LEGAL_NORMATIVE":
            edge("temporal.effective", key, "CONTEXT_FOR")
        if claim["claimType"] == "DEFINITION":
            if claim["sourceNodeIds"] == [node(a1)["nodeId"]]:
                edge("context.definitions", key, "CONTEXT_FOR")
            if claim["sourceNodeIds"] == [node(a61)["nodeId"]]:
                edge("context.definitions-only", key, "CONTEXT_FOR")
    # Preserve each exact directed structural reference, including the resolved cycle and repeated references.
    for ref in source.graph["references"]:
        def within(claim, root):
            return any(n == root or source.nodes[n]["structuralPath"].startswith(source.nodes[root]["structuralPath"] + "/") for n in claim["sourceNodeIds"])
        candidate = next((r for r in relations if within(next(c for c in claims if c["claimId"] == r["fromClaimId"]), ref["fromNodeId"]) and within(next(c for c in claims if c["claimId"] == r["toClaimId"]), ref["toNodeId"])), None)
        if candidate is None:
            raise AssertionError("Corrected semantic fixture must explicitly interpret every material reference: " + ref["text"])
        row = {**candidate, "referenceId": ref["referenceId"]}; row["relationId"] = fingerprint({k:v for k,v in row.items() if k != "relationId"}); relations.append(row)
    review_ids = {r["sourceNodeId"] for r in fixture["frozenInventory"]["graph"]["sourceAccounting"]}
    graph = {"contractVersion": "LEGAL_GRAPH_V3", "materializationId": source.graph["materializationId"], "legalSourceVersionId": source.version, "claims": claims, "relations": relations,
             "reviewFrontier": deepcopy(fixture["frozenInventory"]["graph"]["reviewFrontier"]), "semanticAudits": [],
             "sourceAccounting": [{"sourceNodeId": nid, "claimIds": sorted(c["claimId"] for c in claims if nid in c["sourceNodeIds"]), "nonSemanticReason": None} for nid in sorted(review_ids)],
             "referenceAccounting": [{"referenceId": r["referenceId"], "material": True, "relationIds": sorted(e["relationId"] for e in relations if e["referenceId"] == r["referenceId"]), "nonMaterialReason": None} for r in source.graph["references"]]}
    return fixture, source, normalized_graph(graph), identities, keys
