"""Reference-only source boundaries and deterministic commits."""
import json
import os
import pytest
from test_claim_files import runtime, first_path, file_value, write
from test_claim_files_frontier import context_for, files_for, state
from claim_files_bridge import bridge
from rule_set_preparation.claim_files import check_claims, claim_path, commit_claims, discovery_status
from rule_set_preparation.claim_tools import build_claim_tools
from rule_set_preparation.legal_source_files import materialize_legal_source
from rule_set_preparation.source_graph import PinnedSourceGraph


def reference_context(tmp_path):
    context, bundle = runtime(tmp_path)
    bundle['documents'][1]['corpusRole'] = 'REFERENCE_ONLY'
    bundle['documentGraph']['referenceOnlyDocumentIds'] = ['qd-33']
    source = PinnedSourceGraph(bundle['documentGraph'], [c for d in bundle['documents'] for c in d['chunks']])
    origin = next(n for n in source.nodes.values() if n['documentId'] == 'luat-134' and n['nodeType'] == 'CLAUSE')
    target = next(n for n in source.nodes.values() if n['documentId'] == 'qd-33' and n['nodeType'] == 'ARTICLE')
    ref = {'referenceId': 'e'*64, 'fromNodeId': origin['nodeId'], 'toNodeId': target['nodeId'], 'resolutionState': 'RESOLVED', 'candidateNodeIds': [], 'text': 'B', 'charStart': 0, 'charEnd': 1}
    bundle['documentGraph']['references'] = [ref, {**ref, 'referenceId': 'f'*64, 'fromNodeId': target['nodeId'], 'toNodeId': origin['nodeId']}]
    context.source_graph = PinnedSourceGraph(bundle['documentGraph'], [c for d in bundle['documents'] for c in d['chunks']])
    return context, bundle, ref


def test_reference_only_readable_without_assignments_or_reference_owners(tmp_path):
    context, bundle, ref = reference_context(tmp_path)
    source = context.source_graph
    materialize_legal_source(bundle, tmp_path)
    index = (tmp_path / 'legal-source/INDEX.md').read_text()
    assert 'qd-33' in index and 'REFERENCE_ONLY (no claim file)' in index
    assert not (tmp_path / 'work/claims/qd-33').exists()
    assert all(source.nodes[n]['documentId'] != 'qd-33' for n in source.review_node_ids())
    assert all('qd-33' not in p for p in source.source_files)
    assert source.reference_owners()['f'*64] is None
    target_path = source.node_files[ref['toNodeId']]
    assert 'role: REFERENCE_ONLY (no claim file)' in (tmp_path / target_path.lstrip('/')).read_text()
    path = first_path(context)
    write(context, path, file_value(context, path))
    checked, files, _ = check_claims(context, [path])
    assert checked['outcome'] == 'PASSED', checked
    assert files[path]['references'][ref['referenceId']] == {'material': False, 'reason': 'REFERENCE_ONLY_TARGET'}
    forbidden = claim_path(target_path)
    write(context, forbidden, {'article': source.file_articles[target_path], 'claims': []})
    assert check_claims(context, [forbidden])[0]['errors'][forbidden]['_file'][0]['code'] == 'ARTICLE_PATH_UNKNOWN'


@pytest.mark.parametrize('decision', [False, 'UNRESOLVED', True])
def test_reference_only_target_decisions_fixed_or_rejected(tmp_path, decision):
    context, _, ref = reference_context(tmp_path)
    path = first_path(context)
    value = file_value(context, path)
    value['references'][ref['referenceId']] = ({'material': True, 'binding': {'from': 'duty', 'to': 'no-claim', 'kind': 'DEFINED_BY'}} if decision is True else {'material': decision, 'reason': 'context'})
    write(context, path, value)
    checked, files, _ = check_claims(context, [path])
    if decision is True:
        assert any(e['code'] == 'REFERENCE_ONLY_TARGET' for errors in checked['errors'][path].values() for e in errors)
    else:
        assert checked['outcome'] == 'PASSED', checked
        assert files[path]['references'][ref['referenceId']]['reason'] == 'REFERENCE_ONLY_TARGET'


@pytest.mark.skipif('lcsp_review_frontier_test' not in os.environ.get('REVIEW_FRONTIER_DATABASE_URL', ''), reason='explicit disposable DB required')
def test_bridge_only_a_reviewed_b_effect_target_resolves_and_is_committed(tmp_path):
    seed = bridge({'action': 'SEED_DEPENDENCIES', 'nodes': 2, 'edges': [{'from': 0, 'to': 1}, {'from': 1, 'to': 0}], 'referenceOnlyTarget': True})
    context = context_for(seed, tmp_path)
    source = context.source_graph
    assert source.graph['referenceOnlyDocumentIds'] == ['reference-only-b']
    status = discovery_status(context)
    assert status['progress']['total'] == 1
    assert all('reference-only-b' not in json.dumps(a) for a in status.get('assignments', []))
    files = files_for(context, material=False)
    assert len(files) == 1
    path, value = next(iter(files.items()))
    value['references'] = {}
    target = next(n for n in source.nodes.values() if source.is_reference_only(n['nodeId']))
    tools = {t.name: t for t in build_claim_tools(context)}
    resolved = json.loads(tools['get_applicable_legal_state'].invoke({'node_id': f"{target['documentId']}#{source.locators[target['nodeId']]}", 'at_date': '2026-10-24'}))
    assert resolved['nodeId'] == target['nodeId']
    value['claims'][0]['frame']['legalEffect'] = {'kind': 'REPEALS', 'targets': [{'nodeId': resolved['nodeId'], 'scope': 'EXACT'}], 'unresolvedTargets': [], 'effectiveFrom': None, 'effectiveUntil': None, 'conditions': None}
    write(context, path, value)
    checked, _, _ = check_claims(context, [path])
    assert checked['outcome'] == 'PASSED', checked
    result = commit_claims(context, [path])
    assert result['outcome'] == 'PASSED', result
    assert len(result['committedNodes']) == 1
    persisted = state(context)['rows'][0]
    assert persisted['payload']['claims'][0]['semanticFrame']['legalEffect']['targets'][0]['nodeId'] == target['nodeId']
    assert context.draft['referenceAccounting'][seed['documentGraph']['references'][0]['referenceId']]['nonMaterialReason'] == 'REFERENCE_ONLY_TARGET'
    assert discovery_status(context)['progress']['discoveryCompleteEligible']
    assert len(state(context)['rows']) == 1
    frozen = context.api.claim_inventory_operation(context.run_id, 'FINALIZE', 1, graph=context.inventory.graph(), identities=context.inventory.identities)
    assert frozen['outcome'] == 'PASSED', frozen
