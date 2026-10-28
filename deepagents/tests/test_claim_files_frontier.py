"""File tools against actual transaction handlers on an explicitly owned disposable DB."""
import json
import os
from copy import deepcopy

import pytest

from claim_files_bridge import bridge, DatabaseFrontierApi
from rule_set_preparation.claim_files import claim_path, disk_path, commit_claims, check_claims, rebuild_claim_files, discovery_status
from rule_set_preparation.claim_inventory import ClaimInventory
from rule_set_preparation.source_graph import PinnedSourceGraph
from rule_set_preparation.tools import RuleSetPreparationContext

pytestmark = pytest.mark.skipif('lcsp_review_frontier_test' not in os.environ.get('REVIEW_FRONTIER_DATABASE_URL', ''), reason='explicit owned frontier DB required')


class RecordingApi(DatabaseFrontierApi):
    def __init__(self):
        self.actions = []
    def source_review_operation(self, run_id, revision, action, **fields):
        self.actions.append((action, fields))
        return super().source_review_operation(run_id, revision, action, **fields)


def context_for(seed, tmp_path):
    source = PinnedSourceGraph(seed['documentGraph'], [{**c, 'chunkId': c['id']} for c in seed['chunks']])
    context = RuleSetPreparationContext(seed['preparationRunId'], RecordingApi(), source_graph=source, source_root=tmp_path, discovery_only=True)
    context.inventory = ClaimInventory(context)
    return context


def files_for(context, *, material=True):
    source = context.source_graph
    result = {}
    for source_path, ids in source.source_files.items():
        path = claim_path(source_path)
        node = next(nid for nid in ids if source.nodes[nid]['content'])
        row = {'key': 'definition', 'type': 'DEFINITION', 'statement': source.nodes[node]['content'], 'actor': None, 'action': None, 'authority': 'DEFINITION', 'assessability': 'NON_ASSESSABLE', 'frame': {}, 'relevant': True, 'nonOperativeReason': None, 'support': [{'locator': source.locators[node], 'quote': source.nodes[node]['content']}], 'relations': []}
        references = {}
        for ref in source.forward.get(node, []):
            rid = ref['referenceId']
            target = claim_path(source.node_files[ref['toNodeId']]).removeprefix('/work/claims/') + '#definition'
            if material:
                row['relations'].append({'kind': 'DEFINED_BY', 'to': target, 'referenceId': rid})
                references[rid] = {'material': True, 'binding': {'from': row['key'], 'to': target, 'kind': 'DEFINED_BY'}}
            else:
                references[rid] = {'material': 'UNRESOLVED', 'reason': 'Semantic target has not been reviewed'}
        value = {'article': source.file_articles[source_path], 'claims': [row], 'noClaims': {source.locators[nid]: 'Structural context' for nid in ids if nid != node}, 'references': references}
        result[path] = value
    for path, value in result.items():
        target = disk_path(context, path); target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(value))
    return result


def state(context):
    return bridge({'action': 'STATE', 'request': {'preparationRunId': context.run_id}})


def test_commit_without_next_happy_idempotent_and_restart_rebuild(tmp_path):
    seed = bridge({'action': 'SEED_DEPENDENCIES', 'nodes': 2, 'edges': []})
    context = context_for(seed, tmp_path)
    files = files_for(context)
    assert check_claims(context, list(files))[0]['outcome'] == 'PASSED'
    result = commit_claims(context, list(files))
    assert result['outcome'] == 'PASSED', result
    assert len(result['committedNodes']) == 2
    second = commit_claims(context, list(files))
    assert second['outcome'] == 'PASSED', second
    assert all(action != 'NEXT' for action, _ in context.api.actions)
    complete = [fields for action, fields in context.api.actions if action == 'COMPLETE']
    assert len(complete) == 2 and all(len(fields['batch']) == 2 for fields in complete)
    restarted = context_for(seed, tmp_path / 'restart')
    # A worker reclaim clears the previous operation in production. Reuse its operation in this direct bridge restart.
    restarted.inventory.frontier.operation_id = context.inventory.frontier.operation_id
    rebuild_claim_files(restarted)
    for path in files:
        assert disk_path(restarted, path).exists()
    checked = check_claims(restarted, list(files))[0]
    assert checked['outcome'] == 'PASSED', checked
    assert discovery_status(restarted)['progress']['discoveryCompleteEligible']
    assert commit_claims(restarted, list(files))['outcome'] == 'PASSED'


def test_multi_file_circular_references_commit_in_one_complete(tmp_path):
    seed = bridge({'action': 'SEED_DEPENDENCIES', 'nodes': 2, 'edges': [{'from': 0, 'to': 1}, {'from': 1, 'to': 0}]})
    context = context_for(seed, tmp_path)
    files = files_for(context)
    assert check_claims(context, list(files))[0]['outcome'] == 'PASSED'
    result = commit_claims(context, list(files))
    assert result['outcome'] == 'PASSED', result
    assert len(result['committedNodes']) == 2 and len(context.draft['claimRelations']) == 2
    assert len([a for a, _ in context.api.actions if a == 'COMPLETE']) == 1
    assert all(r['state'] == 'REVIEWED_WITH_CLAIMS' for r in state(context)['rows'])


def test_deferred_law_wide_limits_survive_restart_and_must_link_before_freeze(tmp_path):
    from rule_set_preparation.semantic_closure import semantic_closure

    seed = bridge({'action': 'SEED_DEPENDENCIES', 'nodes': 2, 'edges': []})
    context = context_for(seed, tmp_path)
    files = files_for(context)
    limit_path, duty_path = list(files)
    scope = files[limit_path]['claims'][0]
    scope.update(key='scope', type='SCOPE', authority='LEGAL_NORMATIVE')
    exception = deepcopy(scope)
    exception.update(key='exclusion', type='EXCEPTION')
    files[limit_path]['claims'].append(exception)
    files[duty_path]['claims'][0].update(key='duty', type='DUTY', authority='LEGAL_NORMATIVE', actor='Source operator', action='Perform the source duty', assessability='EXTERNAL_FULFILLMENT')
    for path, value in files.items():
        disk_path(context, path).write_text(json.dumps(value))
    assert commit_claims(context, list(files))['outcome'] == 'PASSED'
    assert discovery_status(context)['progress']['discoveryCompleteEligible']
    refused = context.api.claim_inventory_operation(context.run_id, 'FINALIZE', 1, graph=context.inventory.graph(), identities=context.inventory.identities)
    assert refused['outcome'] == 'FAILED', refused
    assert len([f for f in refused['failures'] if f['detail'].startswith('FREE_FLOATING_MODIFIER:')]) == 2, refused
    restarted = context_for(seed, tmp_path / 'restart')
    restarted.inventory.frontier.operation_id = context.inventory.frontier.operation_id
    rebuild_claim_files(restarted)
    restored = json.loads(disk_path(restarted, limit_path).read_text())
    assert all(c['relevant'] and c['nonOperativeReason'] is None for c in restored['claims'])
    target = duty_path.removeprefix('/work/claims/') + '#duty'
    for claim in restored['claims']:
        claim['relations'] = [{'kind': 'CONDITION_OF' if claim['type'] == 'SCOPE' else 'EXCEPTION_TO', 'to': target}]
    disk_path(restarted, limit_path).write_text(json.dumps(restored))
    assert commit_claims(restarted, [limit_path])['outcome'] == 'PASSED'
    graph = restarted.inventory.graph()
    frozen = restarted.api.claim_inventory_operation(restarted.run_id, 'FINALIZE', 1, graph=graph, identities=restarted.inventory.identities)
    assert frozen['outcome'] == 'PASSED', frozen
    duty = next(c for c in graph['claims'] if c['claimType'] == 'DUTY')
    closure = semantic_closure(graph, duty['claimId'])
    assert {c['role'] for c in closure['claims']} == {'OPERATIVE_PROPOSITION', 'APPLICABILITY_CONDITION', 'EXCEPTION'}
    assert len(state(restarted)['rows']) == 2


def test_waiting_reference_publishes_blocked_claims_then_recommit_resolves(tmp_path):
    seed = bridge({'action': 'SEED_DEPENDENCIES', 'nodes': 2, 'edges': [{'from': 0, 'to': 1}]})
    context = context_for(seed, tmp_path)
    files = files_for(context, material=False)
    source_file = next(p for p, v in files.items() if v['references'])
    result = commit_claims(context, [source_file])
    assert result['outcome'] == 'PASSED', result
    assert result['waitingReferences']
    assert not context.draft['sourceAccounting']
    assert any(r['state'] == 'BLOCKED_REFERENCE' for r in state(context)['rows'])
    files = files_for(context)
    result = commit_claims(context, list(files))
    assert result['outcome'] == 'PASSED', result
    assert discovery_status(context)['progress']['discoveryCompleteEligible']


def test_long_reference_wait_diagnostics_fit_the_api_without_losing_references_or_claims(tmp_path):
    seed = bridge({'action': 'SEED_DEPENDENCIES', 'nodes': 4, 'edges': [{'from': 0, 'to': target} for target in range(1, 4)]})
    context = context_for(seed, tmp_path)
    files = files_for(context, material=False)
    path = next(p for p, value in files.items() if value['references'])
    for index, decision in enumerate(files[path]['references'].values()):
        decision['reason'] = f'Target {index}: ' + '😀' * 1100
    disk_path(context, path).write_text(json.dumps(files[path]))
    before = deepcopy(files[path])
    result = commit_claims(context, [path])
    assert result['outcome'] == 'PASSED', result
    batch = next(fields['batch'] for action, fields in context.api.actions if action == 'COMPLETE')
    waiting = next(row for row in batch if row['disposition'] == 'REQUIRES_REFERENCE_RESOLUTION')
    assert len(waiting['reason'].encode('utf-16-le')) // 2 <= 2000
    assert set(waiting['referenceIds']) == set(before['references'])
    assert len(waiting['payload']['claims']) == len(before['claims'])
    assert json.loads(disk_path(context, path).read_text()) == before
    assert any(row['state'] == 'BLOCKED_REFERENCE' for row in state(context)['rows'])




def test_changed_committed_file_reopens_only_changed_unit(tmp_path):
    seed = bridge({'action': 'SEED_DEPENDENCIES', 'nodes': 2, 'edges': []})
    context = context_for(seed, tmp_path)
    files = files_for(context)
    assert commit_claims(context, list(files))['outcome'] == 'PASSED'
    path = next(iter(files))
    # Any changed committed claim reopens its owner before the corrected COMPLETE.
    files[path]['claims'][0]['frame'] = {'scope': 'A source-supported scope dimension added by the correction'}
    disk_path(context, path).write_text(json.dumps(files[path]))
    result = commit_claims(context, [path])
    assert result['outcome'] == 'PASSED', result
    reopens = [fields for action, fields in context.api.actions if action == 'REOPEN']
    assert len(reopens) == 1






def test_batch_detached_reference_guidance_uses_the_failed_units_owner(tmp_path):
    seed = bridge({'action': 'SEED_DEPENDENCIES', 'nodes': 2, 'edges': [{'from': 0, 'to': 1}]})
    context = context_for(seed, tmp_path)
    files = files_for(context)
    original = context.api.source_review_operation
    def refuse(run_id, revision, action, **fields):
        if action == 'COMPLETE':
            unit = next(u for u in fields['batch'] if u['payload']['relations'])
            relation = unit['payload']['relations'][0]
            return {'outcome': 'FAILED', 'failures': [{'sourceNodeId': unit['sourceNodeId'], 'failure': {'failures': [{
                'code': 'SEMANTIC_DEPENDENCY_DETACHED', 'ref': 'claimRelation:'+relation['relationId'],
                'detail': 'Mechanical API-refusal fixture', 'suppliedToClaimId': relation['toClaimId'], 'targetClaimIds': []}]}}]}
        return original(run_id, revision, action, **fields)
    context.api.source_review_operation = refuse
    result = commit_claims(context, list(files))
    assert result['outcome'] == 'FAILED' and result['committedNodes'] == []
    assert len(result['detachedRelations']) == 1, result
    assert result['requiredAction'] == 'edit_file'






def test_rewording_a_committed_claim_persists_the_authors_statement(tmp_path):
    seed = bridge({'action': 'SEED_DEPENDENCIES', 'nodes': 2, 'edges': []})
    context = context_for(seed, tmp_path)
    files = files_for(context)
    first = commit_claims(context, list(files))
    assert first['outcome'] == 'PASSED', first
    audited = {cid: c['statement'] for cid, c in context.draft['semanticClaims'].items()}
    for path, value in files.items():
        value['claims'][0]['statement'] = value['claims'][0]['statement'] + ' (rewritten by a file rewrite)'
        disk_path(context, path).write_text(json.dumps(value))
    second = commit_claims(context, list(files))
    assert second['outcome'] == 'PASSED', second
    assert {cid: c['statement'] for cid, c in context.draft['semanticClaims'].items()} == {cid: text + ' (rewritten by a file rewrite)' for cid, text in audited.items()}
    assert all(r['state'] == 'REVIEWED_WITH_CLAIMS' for r in state(context)['rows'])






def test_file_commit_events_and_complete_payload_shape(tmp_path, monkeypatch):
    seed = bridge({'action': 'SEED_DEPENDENCIES', 'nodes': 2, 'edges': []})
    context = context_for(seed, tmp_path)
    files = files_for(context)
    events = []
    monkeypatch.setattr('rule_set_preparation.claim_files.publish_agent_stream_event', lambda kind, **fields: events.append(fields['data']))
    result = commit_claims(context, list(files))
    assert result['outcome'] == 'PASSED', result
    assert len(events) == 2 and all(e['activity_kind'] == 'CLAIM_FILE_COMMITTED' and len(e['committedNodes']) == 1 and not e['rejected'] for e in events)
    complete = [fields for action, fields in context.api.actions if action == 'COMPLETE']
    assert len(complete) == 1
    for unit in complete[0]['batch']:
        assert set(unit['payload']) == {'claims', 'identities', 'relations', 'referenceAccounting', 'dependencyFingerprints'}
    assert set(context.inventory.graph()) == {'contractVersion', 'reviewFrontier', 'legalSourceVersionId', 'materializationId', 'claims', 'relations', 'sourceAccounting', 'referenceAccounting'}


@pytest.mark.parametrize('delete_target', [False, True])
def test_changed_or_deleted_target_invalidates_dependents_until_explicit_file_repair(tmp_path, delete_target):
    seed = bridge({'action': 'SEED_DEPENDENCIES', 'nodes': 2, 'edges': [{'from': 0, 'to': 1}]})
    context = context_for(seed, tmp_path)
    files = files_for(context)
    assert commit_claims(context, list(files))['outcome'] == 'PASSED'
    source_path = next(path for path, value in files.items() if value['references'])
    target_path = next(path for path, value in files.items() if not value['references'])
    if delete_target:
        target_node = context.source_graph.source_files[context.source_graph.node_files[seed['documentGraph']['references'][0]['toNodeId']]][0]
        files[target_path]['claims'] = []
        files[target_path]['noClaims'][context.source_graph.locators[target_node]] = 'The fixture explicitly removes its mistaken definition'
    else:
        files[target_path]['claims'][0]['statement'] += ' Corrected statement.'
    disk_path(context, target_path).write_text(json.dumps(files[target_path]))
    result = commit_claims(context, [target_path])
    assert result['outcome'] == 'PASSED', result
    assert not discovery_status(context)['progress']['discoveryCompleteEligible']
    assert context.inventory.validate_inventory(finalize=True)['outcome'] == 'FAILED'
    if delete_target:
        rejected = commit_claims(context, [source_path])
        assert rejected['outcome'] == 'FAILED'
        assert 'RELATION_TARGET_MISSING' in {row['code'] for keys in rejected['errors'].values() for rows in keys.values() for row in rows}
        files[source_path]['claims'][0]['relations'] = []
        for rid in files[source_path]['references']:
            files[source_path]['references'][rid] = {'material': False, 'reason': 'The mechanical fixture no longer asserts an incorporated definition'}
        disk_path(context, source_path).write_text(json.dumps(files[source_path]))
    repaired = commit_claims(context, [source_path])
    assert repaired['outcome'] == 'PASSED', repaired
    assert discovery_status(context)['progress']['discoveryCompleteEligible']


def test_reopen_then_discovery_status_and_commit_work_in_the_same_process(tmp_path):
    """Reopening restarts discovery of the whole law; the very next commits must be accepted, not refused as an uninitialised operation."""
    seed = bridge({'action': 'SEED_DEPENDENCIES', 'nodes': 2, 'edges': []})
    context = context_for(seed, tmp_path)
    import psycopg
    with psycopg.connect(os.environ['REVIEW_FRONTIER_DATABASE_URL'], autocommit=True) as connection:  # a live run, not the discovery-only fixture
        connection.execute('UPDATE "RuleSetPreparationRun" SET "executionState"=\'RUNNING\', "claimDiscoveryOnly"=false WHERE id=%s', (seed['preparationRunId'],))
    files = files_for(context)
    for path, value in files.items():
        value['claims'][0].update(type='DUTY', authority='LEGAL_NORMATIVE', assessability='EXTERNAL_FULFILLMENT', actor='operator', action='keep records')
        disk_path(context, path).write_text(json.dumps(value))
    assert commit_claims(context, list(files))['outcome'] == 'PASSED'
    finalized = context.inventory.validate_inventory(True)
    assert finalized['outcome'] == 'PASSED', finalized
    reopened = context.inventory.reopen('discovery was incomplete')
    assert reopened['outcome'] == 'PASSED', reopened
    status = discovery_status(context)
    assert status['progress']['pending'] == 2, status
    again = commit_claims(context, list(files))
    assert again['outcome'] == 'PASSED', again
    assert discovery_status(context)['progress']['discoveryCompleteEligible']


def test_authoring_draft_round_trips_through_the_real_inventory_handler(tmp_path):
    seed = bridge({'action': 'SEED_DEPENDENCIES', 'nodes': 2, 'edges': []})
    context = context_for(seed, tmp_path)
    import psycopg
    with psycopg.connect(os.environ['REVIEW_FRONTIER_DATABASE_URL'], autocommit=True) as connection:
        connection.execute('UPDATE "RuleSetPreparationRun" SET "executionState"=\'RUNNING\', "claimDiscoveryOnly"=false WHERE id=%s', (seed['preparationRunId'],))
    files = files_for(context)
    for path, value in files.items():
        value['claims'][0].update(type='DUTY', authority='LEGAL_NORMATIVE', assessability='EXTERNAL_FULFILLMENT', actor='operator', action='keep records')
        disk_path(context, path).write_text(json.dumps(value))
    assert commit_claims(context, list(files))['outcome'] == 'PASSED'
    assert context.inventory.validate_inventory(True)['outcome'] == 'PASSED'
    api, run = context.api, context.run_id
    assert api.claim_inventory_operation(run, 'LOAD_AUTHORING_DRAFT', 1)['draft'] is None
    context.discovery_only = False
    from rule_set_preparation.claim_tools import build_claim_tools
    tools = {t.name: t for t in build_claim_tools(context)}
    anchors = sorted(context.draft['semanticClaims'])
    for i, anchor in enumerate(anchors, 1):
        result = json.loads(tools['author_legal_requirement'].invoke({'requirement_key': f'R-{i}', 'title': f'Duty {i}', 'operative_claim_ids': [anchor]}))
        assert result['outcome'] == 'PASSED', result
    saved = api.claim_inventory_operation(run, 'LOAD_AUTHORING_DRAFT', 1)
    assert saved['draftVersion'] == 2
    assert set(saved['draft']['legalRequirements']) == {'R-1', 'R-2'}
    assert api.claim_inventory_operation(run, 'SAVE_AUTHORING_DRAFT', 1, draft=saved['draft'], draftVersion=1)['replayed']
    older = deepcopy(saved['draft'])
    older['legalRequirements'].pop('R-2')
    assert api.claim_inventory_operation(run, 'SAVE_AUTHORING_DRAFT', 1, draft=older, draftVersion=0)['outcome'] == 'FAILED'
    restarted = context_for(seed, tmp_path / 'restarted')
    restarted.discovery_only = False
    restarted.inventory.frontier.operation_id = context.inventory.frontier.operation_id
    rebuild_claim_files(restarted)
    restarted.inventory.revision, restarted.inventory.phase = context.inventory.revision, context.inventory.phase
    restarted.inventory.restore_frozen_inventory({"revision": context.inventory.revision, "fingerprint": context.inventory.frozen_fingerprint,
        "graph": context.inventory.frozen, "identities": context.inventory.identities})
    resumed = restarted.inventory.begin_authoring()
    assert resumed['outcome'] == 'PASSED', resumed
    assert restarted.draft['legalRequirements'] == saved['draft']['legalRequirements']
    retried = json.loads(tools['author_legal_requirement'].invoke({'requirement_key': 'R-1', 'title': 'Duty 1', 'operative_claim_ids': [anchors[0]]}))
    assert retried['outcome'] == 'PASSED' and context.inventory.draft_version == 2
    assert api.claim_inventory_operation(run, 'SAVE_AUTHORING_DRAFT', 2, draft=saved['draft'], draftVersion=2)['outcome'] == 'FAILED'
