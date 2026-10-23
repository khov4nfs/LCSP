"""Paired regression tests for semantic verification exception handling (P0-A defect).

Specification:
- Independent reviewer source readings (modalOperator, operatorPolarity, semanticAuthority,
  assessability) are authoritative about the SOURCE.
- Producer claimType and statement prose keywords must NEVER override the reviewer's reading.
- Modality check:
  - NON_OPERATIVE reading or DUTY reading with DENIED polarity matches non-normative claim
    (claimType not DUTY/PERMISSION/PROHIBITION) with no operative block.
  - AFFIRMED DUTY/PROHIBITION/PERMISSION reading must be matched by a claim whose claimType
    and operative.modality equal it.
  - Otherwise rejected with WRONG_MODALITY.
- Semantic authority check:
  - Checked against reviewer reading (WRONG_SEMANTIC_AUTHORITY on mismatch), except for
    guidance authorities and denied-duty representations (DUTY + DENIED polarity).
"""
import pytest
from langchain_core.messages import AIMessage
from middleware import usage_metering
from test_rule_set_preparation_native_isolation_preparation import RuleSetPreparationScriptedModel
from semantic_verifier_fixture import model_response
from test_semantic_auditor import example
from rule_set_preparation.claim_inventory import NORMATIVE
from rule_set_preparation.semantic_audit import (
    SemanticAuditor,
    audit_input,
    receipt_passed,
    project_source_readings,
    reconcile_response,
    verdict_schema,
    ASSERTION_CHECKS,
    VERDICTS,
    AUTHORITIES,
    ASSESSABILITIES,
)

# Repository constants validation
assert "SUPPORTED" in VERDICTS
assert "WRONG_MODALITY" in VERDICTS
assert "WRONG_SEMANTIC_AUTHORITY" in VERDICTS
assert "LEGAL_NORMATIVE" in AUTHORITIES
assert "CONTEXT" in AUTHORITIES
assert "REPOSITORY_VERIFIABLE" in ASSESSABILITIES
assert "DUTY" in NORMATIVE
assert "PROHIBITION" in NORMATIVE
assert "PERMISSION" in NORMATIVE


def _make_unit_assertion(
    claim_id="claim-one",
    claim_type="EXCEPTION",
    statement="Sample statement",
    operative=None,
    semantic_authority="LEGAL_NORMATIVE",
    assessability="REPOSITORY_VERIFIABLE",
    modal_operator="NON_OPERATIVE",
    operator_polarity="AFFIRMED",
    reading_authority="LEGAL_NORMATIVE",
    reading_assessability="REPOSITORY_VERIFIABLE",
):
    """Minimal assertion input and single-pass wire response for direct projection testing."""
    claim = {
        "claimId": claim_id,
        "claimType": claim_type,
        "statement": statement,
        "operative": operative,
        "semanticAuthority": semantic_authority,
        "assessability": assessability,
    }
    value = {"claims": [claim], "relations": []}
    response = {
        "assertions": [
            {
                "id": claim_id,
                "sourceReading": {
                    "modalOperator": modal_operator,
                    "operatorPolarity": operator_polarity,
                    "semanticAuthority": reading_authority,
                    "assessability": reading_assessability,
                },
                "checks": {k: "SUPPORTED" for k in ASSERTION_CHECKS},
            }
        ],
        "relations": [],
    }
    project_source_readings(value, response)
    canonical = reconcile_response(response, verdict_schema(value))
    return value, response, canonical


# ==============================================================================
# Case 1: Genuine exclusion of an existing obligation
# ==============================================================================

def test_case1_genuine_exclusion_positive_non_operative_supported():
    """Positive: Genuine exclusion read as NON_OPERATIVE / AFFIRMED -> EXCEPTION claim is SUPPORTED."""
    _, response, canonical = _make_unit_assertion(
        claim_type="EXCEPTION",
        statement="The obligation does not apply to non-profit entities.",
        operative=None,
        semantic_authority="LEGAL_NORMATIVE",
        modal_operator="NON_OPERATIVE",
        operator_polarity="AFFIRMED",
        reading_authority="LEGAL_NORMATIVE",
    )
    assert response["assertions"][0]["checks"]["modality"] == "SUPPORTED"
    assert response["assertions"][0]["checks"]["semanticAuthority"] == "SUPPORTED"
    assert canonical["verdict"] == "SUPPORTED"
    assert not canonical["gaps"]


def test_case1_genuine_exclusion_positive_duty_denied_variant_supported():
    """Positive variant: Genuine exclusion read as DUTY / DENIED -> EXCEPTION claim is SUPPORTED."""
    _, response, canonical = _make_unit_assertion(
        claim_type="EXCEPTION",
        statement="Non-profit entities are not subject to the reporting duty.",
        operative=None,
        semantic_authority="LEGAL_NORMATIVE",
        modal_operator="DUTY",
        operator_polarity="DENIED",
        reading_authority="LEGAL_NORMATIVE",
    )
    assert response["assertions"][0]["checks"]["modality"] == "SUPPORTED"
    assert response["assertions"][0]["checks"]["semanticAuthority"] == "SUPPORTED"
    assert canonical["verdict"] == "SUPPORTED"
    assert not canonical["gaps"]


def test_case1_genuine_exclusion_negative_affirmed_duty_rejected():
    """Paired negative: Genuine exclusion source presented as an affirmed operative DUTY -> WRONG_MODALITY."""
    _, response, canonical = _make_unit_assertion(
        claim_type="DUTY",
        statement="Non-profit entities must submit annual reports.",
        operative={"actor": "non-profit entities", "modality": "DUTY", "action": "submit annual reports"},
        semantic_authority="LEGAL_NORMATIVE",
        modal_operator="NON_OPERATIVE",
        operator_polarity="AFFIRMED",
        reading_authority="LEGAL_NORMATIVE",
    )
    assert response["assertions"][0]["checks"]["modality"]["code"] == "WRONG_MODALITY"
    assert canonical["verdict"] == "WRONG_MODALITY"
    assert any(g["code"] == "WRONG_MODALITY" for g in canonical["gaps"])


# ==============================================================================
# Case 2: Explicitly negated duty
# ==============================================================================

def test_case2_negated_duty_positive_non_normative_supported():
    """Positive: Explicitly negated duty (DUTY / DENIED) matched by non-normative claim without operative -> SUPPORTED."""
    _, response, canonical = _make_unit_assertion(
        claim_type="EXCEPTION",
        statement="The operator is not required to maintain duplicate backups.",
        operative=None,
        semantic_authority="LEGAL_NORMATIVE",
        modal_operator="DUTY",
        operator_polarity="DENIED",
        reading_authority="LEGAL_NORMATIVE",
    )
    assert response["assertions"][0]["checks"]["modality"] == "SUPPORTED"
    assert response["assertions"][0]["checks"]["semanticAuthority"] == "SUPPORTED"
    assert canonical["verdict"] == "SUPPORTED"


def test_case2_negated_duty_negative_affirmed_duty_rejected():
    """Paired negative: Negated duty presented as affirmed DUTY claim with operative block -> WRONG_MODALITY."""
    _, response, canonical = _make_unit_assertion(
        claim_type="DUTY",
        statement="The operator must maintain duplicate backups.",
        operative={"actor": "operator", "modality": "DUTY", "action": "maintain duplicate backups"},
        semantic_authority="LEGAL_NORMATIVE",
        modal_operator="DUTY",
        operator_polarity="DENIED",
        reading_authority="LEGAL_NORMATIVE",
    )
    assert response["assertions"][0]["checks"]["modality"]["code"] == "WRONG_MODALITY"
    assert canonical["verdict"] == "WRONG_MODALITY"
    assert any(g["code"] == "WRONG_MODALITY" for g in canonical["gaps"])


# ==============================================================================
# Case 3: Affirmative duty containing the word "cease"
# ==============================================================================

def test_case3_affirmative_duty_with_cease_positive_faithful_duty_supported():
    """Positive: Faithful DUTY claim with operative block for affirmative duty with 'cease' -> SUPPORTED."""
    statement = "The operator shall cease processing personal data when consent is withdrawn."
    _, response, canonical = _make_unit_assertion(
        claim_type="DUTY",
        statement=statement,
        operative={"actor": "operator", "modality": "DUTY", "action": "cease processing personal data when consent is withdrawn"},
        semantic_authority="LEGAL_NORMATIVE",
        modal_operator="DUTY",
        operator_polarity="AFFIRMED",
        reading_authority="LEGAL_NORMATIVE",
    )
    assert response["assertions"][0]["checks"]["modality"] == "SUPPORTED"
    assert canonical["verdict"] == "SUPPORTED"


def test_case3_affirmative_duty_with_cease_negative_exception_rejected():
    """Paired negative: Affirmative duty containing 'cease' mislabelled as EXCEPTION -> REJECTED with WRONG_MODALITY.

    DEFECT: Today this test fails because denied_duty_in_exception overrides reviewer reading and returns SUPPORTED.
    """
    statement = "The operator shall cease processing personal data when consent is withdrawn."
    _, response, canonical = _make_unit_assertion(
        claim_type="EXCEPTION",
        statement=statement,
        operative=None,
        semantic_authority="LEGAL_NORMATIVE",
        modal_operator="DUTY",
        operator_polarity="AFFIRMED",
        reading_authority="LEGAL_NORMATIVE",
    )
    assert response["assertions"][0]["checks"]["modality"]["code"] == "WRONG_MODALITY"
    assert canonical["verdict"] == "WRONG_MODALITY"
    assert any(g["code"] == "WRONG_MODALITY" for g in canonical["gaps"])


# ==============================================================================
# Case 4: Incorrectly labelled EXCEPTION concealing a real obligation
# ==============================================================================

def test_case4_faithful_obligation_control_supported():
    """Positive control: Faithful normative claims matching reviewer readings -> SUPPORTED."""
    # DUTY control
    _, resp_duty, can_duty = _make_unit_assertion(
        claim_type="DUTY",
        statement="The operator must retain records.",
        operative={"actor": "operator", "modality": "DUTY", "action": "retain records"},
        semantic_authority="LEGAL_NORMATIVE",
        modal_operator="DUTY",
        operator_polarity="AFFIRMED",
        reading_authority="LEGAL_NORMATIVE",
    )
    assert resp_duty["assertions"][0]["checks"]["modality"] == "SUPPORTED"
    assert can_duty["verdict"] == "SUPPORTED"

    # PROHIBITION control
    _, resp_prohib, can_prohib = _make_unit_assertion(
        claim_type="PROHIBITION",
        statement="The operator must not disclose keys.",
        operative={"actor": "operator", "modality": "PROHIBITION", "action": "disclose keys"},
        semantic_authority="LEGAL_NORMATIVE",
        modal_operator="PROHIBITION",
        operator_polarity="AFFIRMED",
        reading_authority="LEGAL_NORMATIVE",
    )
    assert resp_prohib["assertions"][0]["checks"]["modality"] == "SUPPORTED"
    assert can_prohib["verdict"] == "SUPPORTED"


@pytest.mark.parametrize("keyword_statement", [
    "This exception requires the provider to notify affected users within 24 hours.",
    "The standard grace period does not apply to legacy databases, which must migrate immediately.",
    "Entities exempt from fees must nevertheless submit annual compliance audits.",
])
def test_case4_concealed_duty_with_keywords_rejected(keyword_statement):
    """Paired negative: Statement with keywords ('exception', 'does not apply', 'exempt') concealing DUTY -> REJECTED WRONG_MODALITY.

    DEFECT: Today these fail because denied_duty_in_exception overrides reviewer reading and returns SUPPORTED.
    """
    _, response, canonical = _make_unit_assertion(
        claim_type="EXCEPTION",
        statement=keyword_statement,
        operative=None,
        semantic_authority="LEGAL_NORMATIVE",
        modal_operator="DUTY",
        operator_polarity="AFFIRMED",
        reading_authority="LEGAL_NORMATIVE",
    )
    assert response["assertions"][0]["checks"]["modality"]["code"] == "WRONG_MODALITY"
    assert canonical["verdict"] == "WRONG_MODALITY"
    assert any(g["code"] == "WRONG_MODALITY" for g in canonical["gaps"])


def test_case4_concealed_prohibition_variant_rejected():
    """Paired negative variant: Statement concealing an affirmed PROHIBITION -> REJECTED WRONG_MODALITY."""
    _, response, canonical = _make_unit_assertion(
        claim_type="EXCEPTION",
        statement="This exception does not allow unauthorized disclosure under any circumstances.",
        operative=None,
        semantic_authority="LEGAL_NORMATIVE",
        modal_operator="PROHIBITION",
        operator_polarity="AFFIRMED",
        reading_authority="LEGAL_NORMATIVE",
    )
    assert response["assertions"][0]["checks"]["modality"]["code"] == "WRONG_MODALITY"
    assert canonical["verdict"] == "WRONG_MODALITY"
    assert any(g["code"] == "WRONG_MODALITY" for g in canonical["gaps"])


# ==============================================================================
# Case 5: Same meaning without current English keywords
# ==============================================================================

# Phrasings that do NOT contain "not apply", "does not apply", "exempt", "cease", "exception"
NON_KEYWORD_PHRASINGS = [
    "Small entities are excluded from the annual auditing requirement.",
    "Micro-enterprises are spared from mandatory reporting obligations.",
    "Filing obligations are waived for non-profit entities.",
    "Quy định này loại trừ các doanh nghiệp nhỏ khỏi nghĩa vụ kiểm toán.",
]

KEYWORD_PHRASINGS = [
    "The annual auditing requirement does not apply to small entities.",
    "Small entities are exempt from the annual auditing requirement.",
]


@pytest.mark.parametrize("statement", NON_KEYWORD_PHRASINGS + KEYWORD_PHRASINGS)
def test_case5_genuine_exclusion_wording_independence_supported(statement):
    """Positive: Genuine exclusion is SUPPORTED regardless of wording, depending ONLY on reviewer reading."""
    _, response, canonical = _make_unit_assertion(
        claim_type="EXCEPTION",
        statement=statement,
        operative=None,
        semantic_authority="LEGAL_NORMATIVE",
        modal_operator="NON_OPERATIVE",
        operator_polarity="AFFIRMED",
        reading_authority="LEGAL_NORMATIVE",
    )
    assert response["assertions"][0]["checks"]["modality"] == "SUPPORTED"
    assert canonical["verdict"] == "SUPPORTED"


@pytest.mark.parametrize("statement", KEYWORD_PHRASINGS + NON_KEYWORD_PHRASINGS)
def test_case5_concealed_duty_wording_independence_rejected(statement):
    """Paired negative: Concealed obligation must be REJECTED with WRONG_MODALITY regardless of wording.

    Reviewer reads AFFIRMED DUTY: outcome must depend ONLY on reviewer reading and never on statement words.
    DEFECT: Today, keyword phrasings yield SUPPORTED (failing this test), while non-keyword phrasings yield WRONG_MODALITY.
    """
    _, response, canonical = _make_unit_assertion(
        claim_type="EXCEPTION",
        statement=statement,
        operative=None,
        semantic_authority="LEGAL_NORMATIVE",
        modal_operator="DUTY",
        operator_polarity="AFFIRMED",
        reading_authority="LEGAL_NORMATIVE",
    )
    assert response["assertions"][0]["checks"]["modality"]["code"] == "WRONG_MODALITY"
    assert canonical["verdict"] == "WRONG_MODALITY"


def test_case5_outcome_parity_between_keyword_and_non_keyword_phrasings():
    """Assert keyword and non-keyword phrasings yield identical verification outcomes.

    DEFECT: Today this test fails because keyword phrasing produces SUPPORTED while non-keyword produces WRONG_MODALITY.
    """
    # Test concealed duty with non-keyword statement
    _, resp_non_kw, _ = _make_unit_assertion(
        claim_type="EXCEPTION",
        statement=NON_KEYWORD_PHRASINGS[0],
        operative=None,
        semantic_authority="LEGAL_NORMATIVE",
        modal_operator="DUTY",
        operator_polarity="AFFIRMED",
        reading_authority="LEGAL_NORMATIVE",
    )
    code_non_kw = resp_non_kw["assertions"][0]["checks"]["modality"]
    non_kw_verdict = code_non_kw if isinstance(code_non_kw, str) else code_non_kw["code"]

    # Test concealed duty with keyword statement
    _, resp_kw, _ = _make_unit_assertion(
        claim_type="EXCEPTION",
        statement=KEYWORD_PHRASINGS[0],
        operative=None,
        semantic_authority="LEGAL_NORMATIVE",
        modal_operator="DUTY",
        operator_polarity="AFFIRMED",
        reading_authority="LEGAL_NORMATIVE",
    )
    code_kw = resp_kw["assertions"][0]["checks"]["modality"]
    kw_verdict = code_kw if isinstance(code_kw, str) else code_kw["code"]

    # Desired specification: both must be identical (WRONG_MODALITY)
    assert non_kw_verdict == kw_verdict == "WRONG_MODALITY"


# ==============================================================================
# Case 6: Source-supported exception with preserved normative authority
# ==============================================================================

def test_case6_positive_source_supported_exception_normative_authority_supported():
    """Positive: Exception claim with LEGAL_NORMATIVE authority matching reviewer reading -> SUPPORTED."""
    _, response, canonical = _make_unit_assertion(
        claim_type="EXCEPTION",
        statement="The logging rule does not apply to non-production environments.",
        operative=None,
        semantic_authority="LEGAL_NORMATIVE",
        modal_operator="NON_OPERATIVE",
        operator_polarity="AFFIRMED",
        reading_authority="LEGAL_NORMATIVE",
    )
    assert response["assertions"][0]["checks"]["modality"] == "SUPPORTED"
    assert response["assertions"][0]["checks"]["semanticAuthority"] == "SUPPORTED"
    assert canonical["verdict"] == "SUPPORTED"


def test_case6_negative_exception_authority_downgraded_to_context_rejected():
    """Paired negative: Producer downgrades exception authority to CONTEXT -> WRONG_SEMANTIC_AUTHORITY."""
    _, response, canonical = _make_unit_assertion(
        claim_type="EXCEPTION",
        statement="The logging rule does not apply to non-production environments.",
        operative=None,
        semantic_authority="CONTEXT",
        modal_operator="NON_OPERATIVE",
        operator_polarity="AFFIRMED",
        reading_authority="LEGAL_NORMATIVE",
    )
    assert response["assertions"][0]["checks"]["modality"] == "SUPPORTED"
    assert response["assertions"][0]["checks"]["semanticAuthority"]["code"] == "WRONG_SEMANTIC_AUTHORITY"
    assert canonical["verdict"] == "WRONG_SEMANTIC_AUTHORITY"
    assert any(g["code"] == "WRONG_SEMANTIC_AUTHORITY" for g in canonical["gaps"])


def test_case6_negative_concealed_duty_authority_downgrade_rejected():
    """Paired negative variant: Concealed duty with authority downgraded to CONTEXT must be rejected.

    DEFECT: Today this test fails because denied_duty_in_exception enables denied_duty_representation,
    which treats actual CONTEXT as matching expected LEGAL_NORMATIVE.
    """
    _, response, canonical = _make_unit_assertion(
        claim_type="EXCEPTION",
        statement="Entities exempt from registration must maintain security logs.",
        operative=None,
        semantic_authority="CONTEXT",
        modal_operator="DUTY",
        operator_polarity="AFFIRMED",
        reading_authority="LEGAL_NORMATIVE",
    )
    assert response["assertions"][0]["checks"]["modality"]["code"] == "WRONG_MODALITY"
    assert response["assertions"][0]["checks"]["semanticAuthority"]["code"] == "WRONG_SEMANTIC_AUTHORITY"
    assert canonical["verdict"] in {"WRONG_MODALITY", "WRONG_SEMANTIC_AUTHORITY"}


# ==============================================================================
# Layer (b): End-to-End Single-Pass Audit Tests with Scripted Model
# ==============================================================================

def test_e2e_single_pass_genuine_exclusion_supported(monkeypatch):
    """End-to-end positive: Genuine exclusion evaluated via SemanticAuditor single-pass -> SUPPORTED."""
    source, graph, node_id = example()
    graph["claims"][0]["claimType"] = "EXCEPTION"
    graph["claims"][0]["operative"] = None
    graph["claims"][0]["statement"] = "Small entities are excluded from mandatory audit logging."
    graph["claims"][0]["semanticAuthority"] = "LEGAL_NORMATIVE"
    value = audit_input(source, graph, node_id, 1)

    result = {
        "verdict": "SUPPORTED",
        "gaps": [],
        "omissions": [],
        "assertions": [
            {
                "id": "claim-one",
                "checks": {k: "SUPPORTED" for k in ASSERTION_CHECKS},
                "verdict": "SUPPORTED",
                "gapCodes": [],
            }
        ],
        "relations": [],
    }
    source_reading = {
        "modalOperator": "NON_OPERATIVE",
        "operatorPolarity": "AFFIRMED",
        "semanticAuthority": "LEGAL_NORMATIVE",
        "assessability": "REPOSITORY_VERIFIABLE",
    }
    wire_args = model_response(result, source_reading=source_reading, value=value)
    model = RuleSetPreparationScriptedModel(
        responses=[
            AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "SourceSemanticAuditVerdict",
                        "args": wire_args,
                        "id": "audit-single-pass-case1-pos",
                    }
                ],
            )
        ]
    )

    original = usage_metering.assert_model_identity
    monkeypatch.setattr(
        usage_metering,
        "assert_model_identity",
        lambda m, response=None: None if isinstance(m, RuleSetPreparationScriptedModel) else original(m, response),
    )

    auditor = SemanticAuditor(model, single_pass=True)
    receipt = auditor.audit(value)

    assert receipt["verdict"] == "SUPPORTED"
    assert not receipt["gaps"]
    assert receipt["assertions"][0]["checks"]["modality"] == "SUPPORTED"
    assert receipt["assertions"][0]["checks"]["semanticAuthority"] == "SUPPORTED"
    assert receipt_passed(value, receipt)


def test_e2e_single_pass_faithful_duty_with_cease_supported(monkeypatch):
    """End-to-end positive control: Faithful DUTY with 'cease' evaluated via SemanticAuditor -> SUPPORTED."""
    source, graph, node_id = example()
    statement = "The operator shall cease processing personal data when consent is withdrawn."
    graph["claims"][0]["claimType"] = "DUTY"
    graph["claims"][0]["statement"] = statement
    graph["claims"][0]["operative"] = {
        "actor": "operator",
        "modality": "DUTY",
        "action": "cease processing personal data when consent is withdrawn",
    }
    graph["claims"][0]["semanticAuthority"] = "LEGAL_NORMATIVE"
    value = audit_input(source, graph, node_id, 1)

    result = {
        "verdict": "SUPPORTED",
        "gaps": [],
        "omissions": [],
        "assertions": [
            {
                "id": "claim-one",
                "checks": {k: "SUPPORTED" for k in ASSERTION_CHECKS},
                "verdict": "SUPPORTED",
                "gapCodes": [],
            }
        ],
        "relations": [],
    }
    source_reading = {
        "modalOperator": "DUTY",
        "operatorPolarity": "AFFIRMED",
        "semanticAuthority": "LEGAL_NORMATIVE",
        "assessability": "REPOSITORY_VERIFIABLE",
    }
    wire_args = model_response(result, source_reading=source_reading, value=value)
    model = RuleSetPreparationScriptedModel(
        responses=[
            AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "SourceSemanticAuditVerdict",
                        "args": wire_args,
                        "id": "audit-single-pass-case3-faithful",
                    }
                ],
            )
        ]
    )

    original = usage_metering.assert_model_identity
    monkeypatch.setattr(
        usage_metering,
        "assert_model_identity",
        lambda m, response=None: None if isinstance(m, RuleSetPreparationScriptedModel) else original(m, response),
    )

    auditor = SemanticAuditor(model, single_pass=True)
    receipt = auditor.audit(value)

    assert receipt["verdict"] == "SUPPORTED"
    assert not receipt["gaps"]
    assert receipt["assertions"][0]["checks"]["modality"] == "SUPPORTED"
    assert receipt_passed(value, receipt)


def test_e2e_single_pass_concealed_obligation_rejected_wrong_modality(monkeypatch):
    """End-to-end negative: Affirmative duty containing 'cease' mislabelled as EXCEPTION -> REJECTED with WRONG_MODALITY.

    DEFECT: Today this test fails because denied_duty_in_exception overrides reviewer reading and produces SUPPORTED receipt.
    """
    source, graph, node_id = example()
    statement = "The operator shall cease processing personal data when consent is withdrawn."
    graph["claims"][0]["claimType"] = "EXCEPTION"
    graph["claims"][0]["statement"] = statement
    graph["claims"][0]["operative"] = None
    graph["claims"][0]["semanticAuthority"] = "LEGAL_NORMATIVE"
    value = audit_input(source, graph, node_id, 1)

    result = {
        "verdict": "SUPPORTED",
        "gaps": [],
        "omissions": [],
        "assertions": [
            {
                "id": "claim-one",
                "checks": {k: "SUPPORTED" for k in ASSERTION_CHECKS},
                "verdict": "SUPPORTED",
                "gapCodes": [],
            }
        ],
        "relations": [],
    }
    source_reading = {
        "modalOperator": "DUTY",
        "operatorPolarity": "AFFIRMED",
        "semanticAuthority": "LEGAL_NORMATIVE",
        "assessability": "REPOSITORY_VERIFIABLE",
    }
    wire_args = model_response(result, source_reading=source_reading, value=value)
    model = RuleSetPreparationScriptedModel(
        responses=[
            AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "SourceSemanticAuditVerdict",
                        "args": wire_args,
                        "id": "audit-single-pass-case3-neg",
                    }
                ],
            )
        ]
    )

    original = usage_metering.assert_model_identity
    monkeypatch.setattr(
        usage_metering,
        "assert_model_identity",
        lambda m, response=None: None if isinstance(m, RuleSetPreparationScriptedModel) else original(m, response),
    )

    auditor = SemanticAuditor(model, single_pass=True)
    receipt = auditor.audit(value)

    assert receipt["verdict"] == "WRONG_MODALITY"
    assert any(g["code"] == "WRONG_MODALITY" for g in receipt["gaps"])
    assert receipt["assertions"][0]["checks"]["modality"] == "WRONG_MODALITY"
    assert not receipt_passed(value, receipt)
