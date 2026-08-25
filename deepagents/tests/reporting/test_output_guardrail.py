from tools.common.capabilities.reporting.report.final_report.output_guardrail import OutputGuardrail


def test_guardrail_allows_canonical_engineering_statuses_and_summary_keys():
    content = (
        '{"summary":{"compliant":1,"non_compliant":1,"unknown":1},'
        '"evaluations":[{"status":"COMPLIANT"},{"status":"NON_COMPLIANT"},'
        '{"status":"UNKNOWN"}]}'
    )

    assert OutputGuardrail.check(content) is False


def test_guardrail_allows_governance_metadata_without_claiming_approval():
    content = (
        "Validated evidence references and approved corpus metadata are provenance, "
        "not a legal conclusion."
    )

    assert OutputGuardrail.check(content) is False


def test_guardrail_blocks_legal_certainty_overclaims():
    blocked = (
        "This system is certified.",
        "This system is legally compliant.",
        "This system is fully compliant.",
        "This system is compliant with the law.",
        "This system is approved by the regulator.",
        "This system was validated as legally compliant.",
        "This system is production ready.",
    )

    for content in blocked:
        assert OutputGuardrail.check(content) is True
