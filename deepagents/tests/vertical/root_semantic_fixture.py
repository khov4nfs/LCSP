"""Reviewed synthetic obligations and source facts for Root semantic evaluation."""
import json
import sys
from vertical.scripted_preparation import build_packet, DOC


def fixture(mode):
    locators = ["art-1", "art-1::cl-1", "art-2", "art-2::cl-1", "art-3", "art-3::cl-1", "art-4", "art-4::cl-1", "art-4::cl-1::pt-a", "art-5", "art-5::cl-1", "art-5::cl-1::pt-a", "art-5::cl-1::pt-b", "art-6", "art-6::cl-1"]
    import hashlib
    text = "Synthetic evaluation instrument: notice services retain records at most seven days; notify recipients at deletion; payment services encrypt payment records. Operations must designate a notification owner."
    hashes = {l: "sha256:"+hashlib.sha256(text.encode()).hexdigest() for l in locators}
    packet = build_packet(hashes)
    packet["contextRelations"] = []
    legal = {r["legalRuleId"]: r for r in packet["legalRules"]}
    rules = {r["engineeringRuleId"]: r for r in packet["engineeringRules"]}
    for name in ("LR-EXC", "LR-PERSON"):
        legal[name]["coverage"] = {"state": "NON_ASSESSABLE", "nonAssessableReason": "Context only; not an independent duty in this synthetic fixture."}
    rules["ER-RET"]["legalRuleIds"] = ["LR-RET"]
    definitions = {
        "ER-RET": ("LR-RET", "Notice record retention", "Notice services must delete notice records no later than seven days after receipt.", "Applies to a system that stores notice records.", "Notice records are deleted after at most seven days."),
        "ER-XREF": ("LR-XREF", "Deletion notification", "Notice services must notify the recipient when their notice record is deleted.", "Applies to a system that stores and deletes notice records.", "The deletion path sends a notification to the notice recipient."),
        "ER-DEF": ("LR-DEF", "Payment record encryption", "Payment processing services must encrypt payment records at rest.", "Applies only to systems that process or store payment records. A notice-only service is outside this duty.", "Payment records are encrypted at rest."),
    }
    for name,(lr,concept,intent,guidance,criterion) in definitions.items():
        legal[lr]["title"] = concept
        legal[lr]["proposition"] = intent
        rules[name].update(concept=concept, legalIntent=intent, applicabilityGuidance=guidance,
            criteria=[{"criterionId":"C-1","statement":criterion}], investigationGoals=[criterion], requiredEvidence=["Accepted repository source or authenticated bounded search coverage"], keywords=[])
    files = {
        "README.md": "This is a notice-only service. It stores notice records and deletes expired notices. It never processes or stores payments. All application logic is in src/notices.py; there are no external notification hooks or services.\n",
        "src/notices.py": "RETENTION_DAYS = 7\n\ndef delete_expired_notices(records, now):\n    return [r for r in records if (now - r['received_at']).days < RETENTION_DAYS]\n",
    }
    if mode == "single":
        for name in ("LR-DEF", "LR-XREF"):
            legal[name]["coverage"] = {"state": "NON_ASSESSABLE", "nonAssessableReason": "Outside the one-duty semantic fixture."}
        packet["legalRules"] = list(legal.values())
        packet["engineeringRules"] = [rules["ER-RET"]]
        files["README.md"] = "This is a notice-only service that stores notice records.\n"
        files["src/notices.py"] = "RETENTION_DAYS = 7\n\ndef delete_expired_notices(records, now):\n    return [r for r in records if (now - r['received_at']).days < RETENTION_DAYS]\n"
    if mode in {"source-answerable", "human"}:
        for name in ("LR-DEF", "LR-RET", "LR-XREF"):
            legal[name]["coverage"] = {"state": "NON_ASSESSABLE", "nonAssessableReason": "Outside the human-fact semantic fixture."}
        packet["legalRules"] = list(legal.values())
        packet["engineeringRules"] = [rules["ER-RET"]]
        rules["ER-RET"]["legalRuleIds"] = ["LR-PERSON"]
        intent = "Organizations operating a notice service must designate a responsible notification owner."
        legal["LR-PERSON"].update(
            title="Notification ownership",
            proposition=intent,
            nonRepositoryDuty=True,
        )
        packet["engineeringRules"][0].update(concept="Notification ownership",legalIntent=intent,
            applicabilityGuidance="Applies to the organization operating this notice service.",
            criteria=[{"criterionId":"C-1","statement":"The organization has designated a responsible notification owner."}],
            investigationGoals=["Find an authoritative operations register or ask the customer who is designated."],
            requiredEvidence=["Operations register or confirmed human fact"], unresolvedConditions=["Designation is an organizational fact; source code alone cannot establish it."])
        files["README.md"] = "The organization operates a notice service. Application code is in src/notices.py.\n"
        if mode == "source-answerable":
            files["docs/operations-register.md"] = "Approved operations register, confirmed by the operations director: The Customer Operations team is the designated responsible owner for the notice notification process.\n"
        else:
            files["docs/operations-register.md"] = "This repository does not contain the organization's designation register. Notification ownership is recorded only in the customer's operations office.\n"
    if mode == "not-applicable":
        for name in ("LR-RET", "LR-XREF"):
            legal[name]["coverage"] = {"state": "NON_ASSESSABLE", "nonAssessableReason": "Outside the applicability semantic fixture."}
        packet["legalRules"] = list(legal.values())
        packet["engineeringRules"] = [rules["ER-DEF"]]
        files["README.md"] = "This repository contains a notice-only service. It does not process or store payment records.\n"
    if mode in {"bounded-absence", "bounded-absence-gapped"}:
        for name in ("LR-DEF", "LR-RET"):
            legal[name]["coverage"] = {"state": "NON_ASSESSABLE", "nonAssessableReason": "Outside the bounded-absence semantic fixture."}
        packet["legalRules"] = list(legal.values())
        packet["engineeringRules"] = [rules["ER-XREF"]]
        files["README.md"] = (
            "The notice service deletes notice records. All application logic is in "
            "src/notices.py; there are no external notification hooks or services.\n"
            if mode == "bounded-absence"
            else "The notice service deletes notice records. The repository does not "
            "contain deployment configuration; outbound notification integrations "
            "may be configured outside this snapshot.\n"
        )
        files["src/notices.py"] = "def delete_notice(record, store):\n    store.delete(record['id'])\n"
    if mode == "fallback-found":
        for name in ("LR-DEF", "LR-RET"):
            legal[name]["coverage"] = {"state": "NON_ASSESSABLE", "nonAssessableReason": "Outside the direct-source fallback semantic fixture."}
        packet["legalRules"] = list(legal.values())
        packet["engineeringRules"] = [rules["ER-XREF"]]
        files["README.md"] = "This notice service stores and deletes notice records. All application logic is in src/notices.py. Search indexes may lag; inspect direct source before concluding absence.\n"
        files["src/notices.py"] = "def delete_notice(record, store, notifier):\n    store.delete(record['id'])\n    notifier.send(record['recipient'], 'Your notice record was deleted')\n"
    used_legal_ids = {
        legal_id
        for engineering_rule in packet["engineeringRules"]
        for legal_id in engineering_rule["legalRuleIds"]
    }
    packet["legalRules"] = [
        item for item in packet["legalRules"] if item["legalRuleId"] in used_legal_ids
    ]
    referenced_locators = {
        source_ref["locator"]
        for rule in [*packet["legalRules"], *packet["engineeringRules"]]
        for source_ref in rule["sourceRefs"]
    }
    referenced_locators.update(
        relation["toSourceRef"]["locator"]
        for relation in packet["contextRelations"]
        if relation.get("toSourceRef")
    )
    # The integrity validator requires every leaf in the seeded corpus to be covered.
    # Keep only chunks this focused one-rule packet actually cites.
    locators = [locator for locator in locators if locator in referenced_locators]
    return {"documentId":DOC,"hashes":hashes,"chunks":[{"locator":l,"content":text,"contentSha256":hashes[l]} for l in locators],"packet":packet,"files":files,"fixture":mode}


if __name__ == "__main__":
    print(json.dumps(fixture(sys.argv[1])))
