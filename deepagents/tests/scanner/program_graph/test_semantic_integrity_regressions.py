from __future__ import annotations

from pathlib import Path

from tools.common.capabilities.evidence.graph.construction.assembly.assembler import ProgramGraphAssembler

# LCSP-220 P0 regressions: semantic trust must follow bounded structural evidence.


def _assemble(tmp_path: Path):
    return ProgramGraphAssembler().assemble(
        scan_job_id="semantic-integrity",
        snapshot_id="snapshot-semantic-integrity",
        commit_sha="abc123",
        workspace_path=tmp_path,
    )


def test_provider_named_redaction_call_is_not_ai_inference(tmp_path: Path) -> None:
    (tmp_path / "redaction.py").write_text(
        '''
import re
ANTHROPIC_KEY_PATTERN = re.compile(r"sk-ant-[A-Za-z0-9]+")

def redact(value):
    return ANTHROPIC_KEY_PATTERN.sub("[MASKED]", value)
''',
        encoding="utf-8",
    )

    graph = _assemble(tmp_path)

    call_nodes = [
        node
        for node in graph.nodes
        if node.get("node_type") == "CALL_SITE"
        and str(node.get("label") or "") == "ANTHROPIC_KEY_PATTERN.sub"
    ]
    assert call_nodes
    assert not any(
        node.get("node_type") in {"AI_MODEL_INVOCATION", "AI_INPUT", "AI_OUTPUT"}
        and "ANTHROPIC_KEY_PATTERN.sub" in str(node.get("label") or "")
        for node in graph.nodes
    )


def test_provider_constructor_is_not_ai_model_invocation(tmp_path: Path) -> None:
    (tmp_path / "client.py").write_text(
        '''
import openai

def build_client():
    return openai.OpenAI()
''',
        encoding="utf-8",
    )

    graph = _assemble(tmp_path)

    assert not any(
        node.get("node_type") == "AI_MODEL_INVOCATION"
        and "openai.openai" in str(node.get("label") or "").lower()
        for node in graph.nodes
    )


def test_real_model_execution_keeps_ai_input_output_lineage(tmp_path: Path) -> None:
    (tmp_path / "inference.py").write_text(
        '''
def run(client, payload):
    result = client.responses.create(input=payload)
    return result
''',
        encoding="utf-8",
    )

    graph = _assemble(tmp_path)

    invocation = next(
        node
        for node in graph.nodes
        if node.get("node_type") == "AI_MODEL_INVOCATION"
        and "responses.create" in str(node.get("label") or "")
    )
    assert (invocation.get("attributes") or {}).get("invocationSemantics") == "MODEL_EXECUTION"
    assert any(node.get("node_type") == "AI_OUTPUT" for node in graph.nodes)


def test_get_accepted_reader_does_not_create_business_decision(tmp_path: Path) -> None:
    (tmp_path / "reader.py").write_text(
        '''
def load(client):
    return client.get_accepted_technical_evidence_report()
''',
        encoding="utf-8",
    )

    graph = _assemble(tmp_path)

    assert not any(
        node.get("node_type") in {"APPROVAL", "BUSINESS_DECISION"}
        and "get_accepted" in str(node.get("label") or "").lower()
        for node in graph.nodes
    )


def test_action_word_without_state_effect_is_not_business_decision(tmp_path: Path) -> None:
    (tmp_path / "candidate.py").write_text(
        '''
def decide(request):
    result = approve(request)
    return result
''',
        encoding="utf-8",
    )

    graph = _assemble(tmp_path)

    assert any(node.get("node_type") == "APPROVAL" for node in graph.nodes)
    assert not any(node.get("node_type") == "BUSINESS_DECISION" for node in graph.nodes)


def test_explicit_approve_action_remains_business_decision(tmp_path: Path) -> None:
    (tmp_path / "approval.py").write_text(
        '''
def decide(repository, request):
    result = repository.approve(request)
    repository.update(result)
    return result
''',
        encoding="utf-8",
    )

    graph = _assemble(tmp_path)

    assert any(
        node.get("node_type") == "APPROVAL"
        and "repository.approve" in str(node.get("label") or "")
        for node in graph.nodes
    )
    decision = next(
        node
        for node in graph.nodes
        if node.get("node_type") == "BUSINESS_DECISION"
        and "repository.approve" in str(node.get("label") or "")
    )
    assert any(
        edge.get("edge_type") == "WRITES_BUSINESS_STATE"
        and edge.get("source_node_id") == decision.get("node_id")
        for edge in graph.edges
    )


def test_software_fingerprint_near_generic_verify_is_not_biometric(tmp_path: Path) -> None:
    (tmp_path / "fingerprint.py").write_text(
        '''
def verify_cache(cache, payload):
    fingerprintToken = cache.latestFingerprint
    verified = verify(fingerprintToken, payload)
    return verified
''',
        encoding="utf-8",
    )

    graph = _assemble(tmp_path)

    biometric = [
        node
        for node in graph.nodes
        if "SENSITIVE.BIOMETRIC" in (node.get("semantic_types") or [])
    ]
    assert all(node.get("resolution_state") != "CORROBORATED" for node in biometric)


def test_same_file_disconnected_biometric_signals_do_not_corroborate(tmp_path: Path) -> None:
    (tmp_path / "disconnected.py").write_text(
        '''
def encode_photo(photo):
    return face_encoder.encode(photo)

def compare_unrelated(left, right):
    return similarity(left, right)
''',
        encoding="utf-8",
    )

    graph = _assemble(tmp_path)

    biometric = [
        node
        for node in graph.nodes
        if "SENSITIVE.BIOMETRIC" in (node.get("semantic_types") or [])
    ]
    assert all(node.get("resolution_state") != "CORROBORATED" for node in biometric)


def test_same_file_disconnected_ocr_and_passport_signals_do_not_corroborate(tmp_path: Path) -> None:
    (tmp_path / "documents.py").write_text(
        '''
def extract_text(blob):
    return ocr.extract(blob)

def passport_policy(config):
    return config.passport_rules
''',
        encoding="utf-8",
    )

    graph = _assemble(tmp_path)

    government_id = [
        node
        for node in graph.nodes
        if "PII.GOVERNMENT_ID" in (node.get("semantic_types") or [])
    ]
    assert all(node.get("resolution_state") != "CORROBORATED" for node in government_id)
