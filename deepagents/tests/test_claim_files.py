"""File discovery mechanics; deterministic source and file accounting."""
import json
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace

import pytest

from legal_graph_fixture import document_graph_for_bundle
from rule_set_preparation.claim_files import check_claims, claim_path, disk_path
from rule_set_preparation.claim_inventory import ClaimInventory
from rule_set_preparation.legal_source_files import materialize_legal_source, refute_source_block
from rule_set_preparation.source_graph import PinnedSourceGraph
from rule_set_preparation.tools import RuleSetPreparationContext


def fixture_bundle():
    documents = []
    for doc in ['luat-134', 'qd-33']:
        documents.append({'documentId': doc, 'title': doc, 'sourceEffectStatus': 'EFFECTIVE', 'chunks': [
            {'chunkId': doc + '-1', 'documentId': doc, 'locator': 'art-1::cl-1', 'content': 'Nhà cung cấp 😀 phải bảo vệ dữ liệu. A. A. A.', 'contentSha256': 'a'*64, 'legalEffectStatus': 'EFFECTIVE'},
            {'chunkId': doc + '-2', 'documentId': doc, 'locator': 'art-2', 'content': 'Đối tượng áp dụng là nhà cung cấp.', 'contentSha256': 'b'*64, 'legalEffectStatus': 'EFFECTIVE'}]})
    bundle = {'legalSourceVersionId': '22222222-2222-4222-8222-222222222222', 'legalSourceVersion': 'fixture', 'documents': documents,
              'claimInventoryRevision': 1, 'claimPhase': 'CLAIM_DISCOVERY', 'frozenInventory': None}
    bundle['documentGraph'] = document_graph_for_bundle(bundle)
    return bundle


def runtime(tmp_path):
    bundle = fixture_bundle()
    source = PinnedSourceGraph(bundle['documentGraph'], [c for d in bundle['documents'] for c in d['chunks']])
    context = RuleSetPreparationContext('11111111-1111-4111-8111-111111111111', object(), source_root=tmp_path, source_graph=source)
    context.inventory = ClaimInventory(context)
    return context, bundle


def file_value(context, path):
    source = context.source_graph
    ids = next(ids for p, ids in source.source_files.items() if claim_path(p) == path)
    supported = next(nid for nid in ids if source.nodes[nid]['content'])
    value = {'article': source.file_articles[source.node_files[ids[0]]], 'claims': [{'key': 'duty', 'type': 'DUTY', 'statement': 'Nhà cung cấp phải bảo vệ dữ liệu.', 'actor': 'Nhà cung cấp', 'action': 'bảo vệ dữ liệu', 'authority': 'LEGAL_NORMATIVE', 'assessability': 'REPOSITORY_VERIFIABLE', 'frame': {}, 'relevant': True, 'nonOperativeReason': None, 'support': [{'locator': source.locators[supported], 'quote': 'phải bảo vệ dữ liệu.'}], 'relations': []}], 'noClaims': {source.locators[nid]: 'Structural heading' for nid in ids if nid != supported}, 'references': {}}
    return value


def write(context, path, value):
    target = disk_path(context, path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(value, ensure_ascii=False))


def first_path(context):
    return next(claim_path(p) for p in context.source_graph.source_files if 'dieu-1.md' in p)


def test_materialization_each_node_once_and_occurrences_references_non_article(tmp_path):
    bundle = fixture_bundle()
    graph = bundle['documentGraph']
    root = graph['nodes'][0]
    root['content'] = 'Lời nói đầu.'
    article = next(n for n in graph['nodes'] if n['nodeType'] == 'ARTICLE')
    clause = next(n for n in graph['nodes'] if n['parentNodeId'] == article['nodeId'])
    for node_type, label, path in [('CLAUSE', '1', clause['structuralPath']+'/occurrence/2'), ('ANNEX', 'A', root['structuralPath']+'/annex/A'), ('TABLE', '1', root['structuralPath']+'/table/1'), ('UNSTRUCTURED', '1', root['structuralPath']+'/unstructured/1')]:
        graph['nodes'].append({**clause, 'nodeId': f'{len(graph["nodes"]):064x}', 'parentNodeId': article['nodeId'] if node_type == 'CLAUSE' else root['nodeId'], 'nodeType': node_type, 'label': label, 'structuralPath': path, 'content': 'Extra content.'})
    ref = {'referenceId': 'c'*64, 'fromNodeId': clause['nodeId'], 'toNodeId': graph['nodes'][-1]['nodeId'], 'resolutionState': 'RESOLVED', 'candidateNodeIds': [], 'text': 'target', 'charStart': 0, 'charEnd': 1}
    graph['references'] = [ref]
    source = PinnedSourceGraph(graph, [c for d in bundle['documents'] for c in d['chunks']])
    paths = materialize_legal_source(bundle, tmp_path)
    contents = '\n'.join((tmp_path / p.lstrip('/')).read_text() for p in source.source_files)
    for node in graph['nodes']:
        assert contents.count('[' + source.locators[node['nodeId']] + ']') >= 1
        own = (tmp_path / source.node_files[node['nodeId']].lstrip('/')).read_text()
        assert own.count('[' + source.locators[node['nodeId']] + ']') == 1
        assert node['nodeId'] not in contents
    assert '/occurrence/2]' in contents and 'RESOLVED' in contents and ref['referenceId'] in contents
    assert not any(p.name in {'nodes', 'CITATIONS.md', '.pins.json'} for p in (tmp_path / 'legal-source').rglob('*'))
    assert any('annex-A.md' in p for p in paths)
    assert refute_source_block(tmp_path, 'SOURCE_PINS_INCONSISTENT', paths[1]) is not None
    (tmp_path / paths[1].lstrip('/')).write_text('changed')
    assert refute_source_block(tmp_path, 'SOURCE_PINS_INCONSENT', paths[1]) is None


def test_repeated_articles_keep_distinct_pinned_ancestor_locators(tmp_path):
    bundle = fixture_bundle()
    nodes = bundle['documentGraph']['nodes']
    article = next(n for n in nodes if n['nodeType'] == 'ARTICLE')
    clause = next(n for n in nodes if n['parentNodeId'] == article['nodeId'])
    root = next(n for n in nodes if n['nodeId'] == article['parentNodeId'])
    for number, chapter in enumerate(('i', 'viii'), 1000):
        parent = {**root, 'nodeId': f'{number:064x}', 'nodeType': 'CHAPTER', 'label': chapter,
                  'parentNodeId': root['nodeId'], 'structuralPath': root['structuralPath'] + '/chapter/' + chapter}
        copy = {**article, 'nodeId': f'{number+10:064x}', 'parentNodeId': parent['nodeId'],
                'structuralPath': parent['structuralPath'] + '/article/1'}
        child = {**clause, 'nodeId': f'{number+20:064x}', 'parentNodeId': copy['nodeId'],
                 'structuralPath': copy['structuralPath'] + '/clause/1'}
        nodes.extend([parent, copy, child])
    # The ordinary unqualified occurrence remains a different pinned source node too.
    before = deepcopy(nodes)
    source = PinnedSourceGraph(bundle['documentGraph'], [c for d in bundle['documents'] for c in d['chunks']])
    materialize_legal_source(bundle, tmp_path)
    for chapter in ('i', 'viii'):
        locator = f'chap-{chapter}::art-1::cl-1'
        node_id = source.locator_nodes[article['documentId'], locator]
        assert locator in (tmp_path / source.node_files[node_id].lstrip('/')).read_text()
    assert len(source.locator_nodes) == len(nodes)
    assert nodes == before


def test_check_valid_resolves_utf16_and_never_calls_api(tmp_path):
    context, _ = runtime(tmp_path)
    path = first_path(context)
    write(context, path, file_value(context, path))
    result, _, candidates = check_claims(context, [path])
    assert result == {'outcome': 'PASSED', 'errors': {}}
    span = candidates[path, 'duty']['sourceSupport'][0]
    assert span['startOffset'] > len('Nhà cung cấp 😀 ')
    assert not context.draft['semanticClaims']


@pytest.mark.parametrize('change,code', [
    (lambda v: v.update(extra=True), 'CLAIM_SCHEMA_INVALID'),
    (lambda v: v['claims'][0]['support'][0].update(locator='art-999', quote='no such passage anywhere'), 'LOCATOR_UNKNOWN'),
    (lambda v: v['claims'][0]['support'][0].update(quote='missing'), 'SOURCE_SUPPORT_INVALID'),
    (lambda v: v['claims'][0]['support'][0].update(quote='A. A.'), 'SOURCE_SUPPORT_INVALID'),
    (lambda v: v.update(claims=[], noClaims={}), 'LOCATOR_UNACCOUNTED'),
    (lambda v: v['claims'].append(deepcopy(v['claims'][0])), 'CLAIM_KEY_DUPLICATE'),
    (lambda v: v['claims'][0]['relations'].append({'kind': 'DEFINED_BY', 'to': 'missing'}), 'RELATION_TARGET_MISSING'),
    (lambda v: v['claims'][0]['relations'].append({'kind': 'EXCEPTION_TO', 'to': 'other'}), 'RELATION_DIRECTION_INVALID'),
    (lambda v: v['claims'][0]['support'].append(deepcopy(v['claims'][0]['support'][0])), 'SOURCE_SUPPORT_DUPLICATE'),
    (lambda v: v['claims'][0]['relations'].append({'kind': 'CROSS_REFERENCE', 'to': 'duty'}), 'RELATION_SELF_LINK'),
    (lambda v: v['claims'][1].update(type='EXCEPTION', actor=None, action=None, relations=[{'kind': 'EXCEPTION_TO', 'to': 'scope'}]) or v['claims'].append({**deepcopy(v['claims'][0]), 'key': 'scope', 'type': 'CONDITION', 'actor': None, 'action': None}), 'RELATION_TARGET_NOT_OPERATIVE'),
])
def test_check_error_matrix(tmp_path, change, code):
    context, _ = runtime(tmp_path)
    path = first_path(context)
    value = file_value(context, path)
    other = deepcopy(value['claims'][0]); other['key'] = 'other'
    value['claims'].append(other)
    change(value)
    write(context, path, value)
    result, _, _ = check_claims(context, [path])
    assert result['outcome'] == 'FAILED'
    failures = [e for by_key in result['errors'].values() for rows in by_key.values() for e in rows]
    assert code in {e['code'] for e in failures}, failures
    assert all(e['fix'] for e in failures)


@pytest.mark.parametrize('claim_type', ['SCOPE', 'CONDITION', 'EXCEPTION', 'QUALIFIER', 'TEMPORAL_RULE', 'TRANSITION_RULE'])
def test_source_grounded_limits_can_wait_for_later_article_targets_without_being_excluded(tmp_path, claim_type):
    context, _ = runtime(tmp_path)
    path = first_path(context)
    value = file_value(context, path)
    value['claims'][0].update(type=claim_type, actor=None, action=None, assessability='NON_ASSESSABLE')
    write(context, path, value)
    result, files, _ = check_claims(context, [path])
    assert result['outcome'] == 'PASSED', result
    assert files[path]['claims'][0]['relevant'] is True
    assert files[path]['claims'][0]['nonOperativeReason'] is None


def test_reference_unaccounted_and_wrong_structural_direction(tmp_path):
    context, bundle = runtime(tmp_path)
    nodes = list(context.source_graph.nodes.values())
    origin = next(n for n in nodes if n['documentId'] == 'luat-134' and n['content'])
    target = next(n for n in nodes if n['documentId'] == 'qd-33' and n['content'])
    ref = {'referenceId': 'c'*64, 'fromNodeId': origin['nodeId'], 'toNodeId': target['nodeId'], 'resolutionState': 'RESOLVED', 'candidateNodeIds': [], 'text': 'target', 'charStart': 0, 'charEnd': 1}
    bundle['documentGraph']['references'] = [ref]
    context.source_graph = PinnedSourceGraph(bundle['documentGraph'], [c for d in bundle['documents'] for c in d['chunks']])
    path = first_path(context)
    value = file_value(context, path)
    write(context, path, value)
    result, _, _ = check_claims(context, [path])
    assert result['errors'][path]['_file'][0]['code'] == 'REFERENCE_UNACCOUNTED'
    value['references'][ref['referenceId']] = {'material': 'UNRESOLVED', 'reason': 'Target not yet interpreted'}
    write(context, path, value)
    assert check_claims(context, [path])[0]['outcome'] == 'PASSED'


@pytest.mark.parametrize('path', ['/etc/passwd', '/legal-source/x.json', '/work/claims/../escape.json', 'work/claims/x.json'])
def test_check_rejects_path_escape(tmp_path, path):
    context, _ = runtime(tmp_path)
    assert check_claims(context, [path])[0]['outcome'] == 'FAILED'


def test_symlink_escape(tmp_path):
    context, _ = runtime(tmp_path)
    (tmp_path / 'work/claims').mkdir(parents=True)
    (tmp_path / 'work/claims/out').symlink_to(tmp_path.parent, target_is_directory=True)
    with pytest.raises(ValueError, match='symlink'):
        disk_path(context, '/work/claims/out/secret.json')


def test_schema_value_sets_match_existing_review_contract():
    from rule_set_preparation.claim_files import SCHEMA
    from rule_set_preparation.claim_inventory import CLAIM_SCHEMA
    from rule_set_preparation.claim_inventory import FRAME_FIELDS
    claim = SCHEMA['properties']['claims']['items']['properties']
    assert set(claim['type']['enum']) == set(CLAIM_SCHEMA['properties']['claimType']['enum'])
    assert set(claim['authority']['enum']) == set(CLAIM_SCHEMA['properties']['semanticAuthority']['enum'])
    assert set(claim['assessability']['enum']) == set(CLAIM_SCHEMA['properties']['assessability']['enum'])
    assert set(claim['frame']['anyOf'][0]['properties']) == set(FRAME_FIELDS) | {'legalEffect'}
    assert set(claim['relations']['items']['properties']['kind']['enum']) == set(SCHEMA['properties']['claims']['items']['properties']['relations']['items']['properties']['kind']['enum'])


def test_native_permissions_deny_source_writes_and_traversal(tmp_path):
    from deepagents.backends.filesystem import FilesystemBackend
    from rule_set_preparation.agent import preparation_filesystem
    middleware = preparation_filesystem(FilesystemBackend(root_dir=tmp_path, virtual_mode=True), files=True)
    tools = {t.name: t for t in middleware.tools}
    for path in ['/legal-source/x.md', '/work/../legal-source/x.md', '/etc/passwd']:
        result = tools['write_file'].func(file_path=path, content='injected', runtime=SimpleNamespace(tool_call_id='test'))
        assert 'denied' in str(result).lower() or 'invalid' in str(result).lower() or 'not allowed' in str(result).lower(), result
    result = tools['write_file'].func(file_path='/work/claims/owned.json', content='{}', runtime=SimpleNamespace(tool_call_id='test'))
    assert (tmp_path / 'work/claims/owned.json').read_text() == '{}', result


def test_claim_directories_are_ready_for_native_listing_without_creating_candidates(tmp_path):
    from deepagents.backends.filesystem import FilesystemBackend
    from rule_set_preparation.agent import preparation_filesystem
    context, bundle = runtime(tmp_path)
    materialize_legal_source(bundle, tmp_path)
    tools = {t.name: t for t in preparation_filesystem(FilesystemBackend(root_dir=tmp_path, virtual_mode=True), files=True).tools}
    for source_path in context.source_graph.source_files:
        parent = str(Path(claim_path(source_path)).parent)
        assert disk_path(context, claim_path(source_path)).parent.is_dir()
        listed = tools['ls'].func(path=parent, runtime=SimpleNamespace(tool_call_id='list'))
        assert 'error' not in str(listed).lower(), listed
    assert not list((tmp_path / 'work/claims').rglob('*.json'))
    path = first_path(context)
    write(context, path, {'existing': 'draft'})
    materialize_legal_source(bundle, tmp_path)
    assert json.loads(disk_path(context, path).read_text()) == {'existing': 'draft'}


def test_phase_filters_tools_and_loads_only_phase_instructions(tmp_path):
    from langchain.agents.middleware.types import ModelRequest
    from langchain_core.messages import SystemMessage
    from rule_set_preparation.agent import PreparationPhaseMiddleware, phase_instructions
    context, _ = runtime(tmp_path)
    names = ['commit_claims', 'discovery_status', 'author_legal_requirement', 'start_rule_authoring', 'validate_compliance_rule_set']
    request = ModelRequest(model=object(), messages=[], tools=[{'name': name} for name in names], system_message=SystemMessage(content=phase_instructions(context)+'\n<LCSP_PHASE_END>native tool instructions'), state={})
    middleware = PreparationPhaseMiddleware(context)
    discovery = middleware._request(request)
    # The parent coordinates only: no source reading and no claim-file tools (those belong to the claim-author children).
    assert [t['name'] for t in discovery.tools] == ['discovery_status']
    assert '## Frozen inventory -> RULE_AUTHORING' not in discovery.system_message.content
    assert 'native tool instructions' in discovery.system_message.content
    context.inventory.frozen = {'claims': []}
    context.inventory.phase = 'CLAIM_INVENTORY_READY'
    authoring = middleware._request(request)
    assert [t['name'] for t in authoring.tools] == names[2:]
    assert '## CLAIM_DISCOVERY: files' not in authoring.system_message.content


def test_quota_mode_is_shared_and_never_trims_history():
    from middleware.agent_run_budget import AgentRunBudgetMiddleware
    from middleware.failure_policy import AgentRunBudgetExceeded
    from langchain.agents.middleware.types import ModelRequest
    from langchain_core.messages import HumanMessage
    request = ModelRequest(model=object(), messages=[HumanMessage(content='source')], tools=[], state={})
    budget = AgentRunBudgetMiddleware(run_quotas={'model_calls': 1})
    assert budget._bounded_request(request) is request
    assert budget.after_model({}, None) is None
    with pytest.raises(AgentRunBudgetExceeded):
        budget._bounded_request(request)
    token_budget = AgentRunBudgetMiddleware(run_quotas={'input_tokens': 1})
    with pytest.raises(AgentRunBudgetExceeded):
        token_budget._bounded_request(request)


def test_runner_budget_callback_pauses_instead_of_failing(tmp_path, monkeypatch):
    from rule_set_preparation import runner
    from middleware.failure_policy import AgentRunBudgetExceeded
    from rule_set_preparation.tools import RuleSetPreparationContext
    context, bundle = runtime(tmp_path)
    class Api:
        calls = []
        def claim_rule_set_preparation(self, run_id): return bundle
        def fail_rule_set_preparation(self, run_id, reason):
            self.calls.append(reason)
            return {'executionState': 'PAUSED'}
    class Agent:
        def invoke(self, *args, **kwargs): raise AgentRunBudgetExceeded('fixture quota')
    monkeypatch.setattr(runner, 'create_rule_set_preparation_agent', lambda **kwargs: Agent())
    monkeypatch.setattr('rule_set_preparation.claim_files.rebuild_claim_files', lambda _: None)
    api = Api()
    result = runner.run_rule_set_preparation(api, context.run_id, work_dir=tmp_path)
    assert result['state'] == 'PAUSED' and result['failureReason'] is None
    assert api.calls == ['AGENT_BUDGET_REACHED']


def test_files_factory_uses_native_todos_shared_budget_and_exclusive_child_tools(tmp_path, monkeypatch):
    import rule_set_preparation.agent as agent_module
    from middleware.agent_run_budget import AgentRunBudgetMiddleware
    from test_rule_set_preparation_native_isolation_preparation import RuleSetPreparationScriptedModel
    from langchain_core.messages import AIMessage
    context, _ = runtime(tmp_path)
    captured = {}
    class Graph:
        def with_config(self, config):
            captured['config'] = config
            return self
    monkeypatch.setattr(agent_module, 'create_deep_agent', lambda **kwargs: (captured.update(kwargs) or Graph()))
    monkeypatch.setattr(agent_module, '_lookup_profile_key', lambda _: 'test:files')
    agent_module.create_rule_set_preparation_agent(context=context, legal_source_root=tmp_path, model=RuleSetPreparationScriptedModel(responses=[AIMessage(content='fixture')]))
    child = captured['subagents'][0]
    assert captured['config']['max_concurrency'] == 2
    assert child['name'] == 'claim-author'
    assert {t.name for t in child['tools']} == {'commit_claims'}
    filesystem = child['middleware'][0]
    assert {t.name for t in filesystem.tools} == {'ls', 'grep', 'read_file', 'write_file', 'edit_file'}
    parent_budget = next(m for m in captured['middleware'] if isinstance(m, AgentRunBudgetMiddleware))
    assert parent_budget is next(m for m in child['middleware'] if isinstance(m, AgentRunBudgetMiddleware))
    assert any(m.name == 'TodoListMiddleware' for m in captured['middleware'])
    from langchain.agents.middleware import ModelCallLimitMiddleware
    limit = next(m for m in child['middleware'] if isinstance(m, ModelCallLimitMiddleware))
    assert limit.run_limit == agent_module.CLAIM_AUTHOR_MODEL_CALLS and limit.exit_behavior == 'end'
    assert 'ONE line: done: X articles, Y claims, Z waiting reference' in child['system_prompt']






def test_check_groups_independent_errors_by_file_and_claim_key(tmp_path):
    context, _ = runtime(tmp_path)
    path = first_path(context)
    value = file_value(context, path)
    value['claims'][0]['support'][0]['quote'] = 'absent'
    other = deepcopy(value['claims'][0]); other['key'] = 'other'
    other['support'][0]['locator'] = 'art-404'
    value['claims'].append(other)
    write(context, path, value)
    result = check_claims(context, [path, '/outside.json'])[0]
    assert {'duty', 'other'} <= result['errors'][path].keys()
    assert '/outside.json' in result['errors']


def test_nested_frame_schema_errors_name_each_invalid_unresolved_target(tmp_path):
    context, _ = runtime(tmp_path)
    path = first_path(context)
    value = file_value(context, path)
    value['claims'][0]['frame'] = {'legalEffect': {'kind': 'REPEALS', 'targets': [],
        'unresolvedTargets': [{'documentIdentifier': 'Outside document A'}, {'documentIdentifier': 'Outside document B'}],
        'effectiveFrom': None, 'effectiveUntil': None, 'conditions': None}}
    write(context, path, value)
    result = check_claims(context, [path])[0]
    errors = result['errors'][path]['duty']
    assert len(errors) == 4
    for index in range(2):
        matching = [error['detail'] for error in errors if f'claims.0.frame.legalEffect.unresolvedTargets.{index}:' in error['detail']]
        assert len(matching) == 2
        assert any("'locator' is a required property" in detail for detail in matching)
        assert any("'reason' is a required property" in detail for detail in matching)
    assert not context.draft['semanticClaims']


def test_quota_replaces_input_reservation_with_reported_usage():
    from middleware.agent_run_budget import AgentRunBudgetMiddleware
    from langchain.agents.middleware.types import ModelRequest, ModelResponse
    from langchain_core.messages import AIMessage
    request = ModelRequest(model=object(), messages=[], tools=[], state={})
    response = ModelResponse(result=[AIMessage(content='fixture', usage_metadata={'input_tokens': 7, 'output_tokens': 1, 'total_tokens': 8})])
    budget = AgentRunBudgetMiddleware(run_quotas={})
    assert budget.wrap_model_call(request, lambda _: response) is response
    assert budget.quota_calls == 1 and budget.quota_input_tokens == 7


def test_files_materialization_replaces_legacy_generated_tree_only(tmp_path):
    context, bundle = runtime(tmp_path)
    (tmp_path / 'work').mkdir()
    (tmp_path / 'work/owner.txt').write_text('keep')
    (tmp_path / 'legal-source/nodes').mkdir(parents=True)
    (tmp_path / 'legal-source/.pins.json').write_text('{}')
    assert (tmp_path / 'legal-source/nodes').is_dir()
    materialize_legal_source(bundle, tmp_path)
    assert not (tmp_path / 'legal-source/nodes').exists()
    assert not (tmp_path / 'legal-source/.pins.json').exists()
    assert (tmp_path / 'work/owner.txt').read_text() == 'keep'


def test_omitted_mechanical_fields_default_and_heading_locators_are_optional(tmp_path):
    context, _ = runtime(tmp_path)
    path = first_path(context)
    value = file_value(context, path)
    # Only the semantic fields remain: frame/relevant/nonOperativeReason/relations/actor/action and the file maps default.
    for claim in value['claims']:
        for field in ('frame', 'relevant', 'nonOperativeReason', 'relations', 'actor', 'action'):
            claim.pop(field, None)
        claim['type'] = 'DEFINITION'
        claim['authority'] = 'DEFINITION'
        claim['assessability'] = 'NON_ASSESSABLE'
    if not value['references']:
        value.pop('references')
    write(context, path, value)
    result, files, _ = check_claims(context, [path])
    assert result == {'outcome': 'PASSED', 'errors': {}}, result
    claim = files[path]['claims'][0]
    assert claim['frame'] == {} and claim['relevant'] is True and claim['relations'] == [] and claim['actor'] is None


def test_article_title_owns_scope_with_its_exact_source_support(tmp_path):
    context, _ = runtime(tmp_path)
    source, path = context.source_graph, first_path(context)
    value = file_value(context, path)
    ids = next(ids for source_path, ids in source.source_files.items() if claim_path(source_path) == path)
    article = next(source.nodes[nid] for nid in ids if source.nodes[nid]['nodeType'] == 'ARTICLE')
    article.update(title='Responsibilities of registered operators', content='Article 1. Responsibilities of registered operators')
    source._review_ids = None
    locator = source.locators[article['nodeId']]
    value['noClaims'].pop(locator, None)
    value['claims'].append({'key': 'scope', 'type': 'SCOPE', 'statement': 'Registered operators.',
        'authority': 'LEGAL_NORMATIVE', 'assessability': 'NON_ASSESSABLE',
        'support': [{'locator': locator, 'quote': 'registered operators'}],
        'relations': [{'kind': 'CONDITION_OF', 'to': 'duty'}]})
    write(context, path, value)
    result, _, candidates = check_claims(context, [path])
    assert result['outcome'] == 'PASSED', result
    assert article['nodeId'] in source.review_node_ids()
    assert candidates[(path, 'scope')]['sourceNodeIds'] == [article['nodeId']]
    # `frame: null` is the same as no frame.
    value['claims'][0]['frame'] = None
    write(context, path, value)
    assert check_claims(context, [path])[0]['outcome'] == 'PASSED'


def test_support_quote_tolerates_whitespace_only_and_stores_the_original_slice():
    from types import SimpleNamespace
    from rule_set_preparation.claim_tools import support_span
    content = "Nhà cung cấp\nphải  thông báo\nkết quả. Nhà cung cấp phải khác."
    source = SimpleNamespace(nodes={"n": {"content": content}})
    span = support_span(source, "n", "phải thông báo kết quả")
    assert content[span["startOffset"]:span["endOffset"]] == "phải  thông báo\nkết quả"
    with pytest.raises(ValueError, match="verbatim"):
        support_span(source, "n", "phải báo cáo kết quả")
    with pytest.raises(ValueError, match="more than once"):
        support_span(source, "n", "Nhà cung cấp")


def test_invalid_json_error_points_at_the_fault(tmp_path):
    context, _ = runtime(tmp_path)
    path = first_path(context)
    target = disk_path(context, path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text('{"article": "art-1", "claims": [{"key": "a" "type": "DUTY"}]}')
    result, _, _ = check_claims(context, [path])
    detail = result['errors'][path]['_file'][0]['detail']
    assert '<<HERE>>' in detail and 'line 1 column' in detail


def test_wrong_locator_is_corrected_when_the_quote_sits_in_one_node_of_the_file(tmp_path):
    context, _ = runtime(tmp_path)
    path = first_path(context)
    value = file_value(context, path)
    printed = value['claims'][0]['support'][0]['locator']
    value['claims'][0]['support'][0]['locator'] = 'art-999'
    write(context, path, value)
    result, files, candidates = check_claims(context, [path])
    assert result['outcome'] == 'PASSED', result
    span = candidates[path, value['claims'][0]['key']]['sourceSupport'][0]
    assert context.source_graph.locators[span['nodeId']] == printed




def test_only_a_container_made_of_its_own_label_and_title_is_a_pure_heading():
    from types import SimpleNamespace
    from rule_set_preparation.claim_files import is_pure_heading
    def node(kind, content):
        return {"nodeType": kind, "content": content}
    nodes = {"c1": node("CHAPTER", "Chương I\nNHỮNG QUY ĐỊNH CHUNG"), "c2": node("CHAPTER", "Chương II\nQuản lý rủi ro."), "c3": node("CHAPTER", "Chương III"),
             "a1": node("ARTICLE", "Điều 1. Phạm vi điều chỉnh"), "c4": node("CHAPTER", "Chương IV\nMột\nHai\nBa\nBốn"), "c5": node("CHAPTER", "Chương V\n" + "x" * 300),
             "s1": node("SECTION", "Mục 1\nQuy định chung")}
    source = SimpleNamespace(nodes=nodes, children={k: ["child"] for k in nodes if k != "c3"})
    assert [is_pure_heading(source, k) for k in ("c1", "c2", "c3", "a1", "c4", "c5", "s1")] == [True, False, False, True, False, False, True]


def test_a_reference_without_a_target_node_is_accounted_as_unresolved_target_and_never_waits(tmp_path):
    context, bundle = runtime(tmp_path)
    origin = next(n for n in context.source_graph.nodes.values() if n['documentId'] == 'luat-134' and n['content'])
    ref = {'referenceId': 'd'*64, 'fromNodeId': origin['nodeId'], 'toNodeId': None, 'resolutionState': 'UNRESOLVED', 'candidateNodeIds': [], 'text': 'Điều 11', 'charStart': 0, 'charEnd': 1}
    bundle['documentGraph']['references'] = [ref]
    context.source_graph = PinnedSourceGraph(bundle['documentGraph'], [c for d in bundle['documents'] for c in d['chunks']])
    path = first_path(context)
    value = file_value(context, path)
    value['references'][ref['referenceId']] = {'material': 'UNRESOLVED', 'reason': 'Article 11 is not in the pinned source'}
    write(context, path, value)
    result, files, _ = check_claims(context, [path])
    assert result['outcome'] == 'PASSED', result
    assert files[path]['references'][ref['referenceId']] == {'material': False, 'reason': 'UNRESOLVED_TARGET: Article 11 is not in the pinned source'}


def test_an_overlapping_repeat_is_an_ambiguous_quote():
    from rule_set_preparation.claim_tools import support_span
    source = SimpleNamespace(nodes={"n": {"content": "a) Keep the notice. Keep the notice. Keep the notice."}})
    quote = "Keep the notice. Keep the notice."
    with pytest.raises(ValueError, match="more than once"):
        support_span(source, "n", quote)
    assert support_span(source, "n", "a) " + quote)["startOffset"] == 0


@pytest.mark.parametrize('change, code', [
    (lambda value: value['noClaims'].update({value['claims'][0]['support'][0]['locator']: 'No claim'}), 'LOCATOR_ACCOUNTING_CONFLICT'),
    (lambda value: value['noClaims'].update({'art-999': 'No claim'}), 'LOCATOR_UNKNOWN'),
    (lambda value: value['noClaims'].update({next(iter(value['noClaims'])): '   '}), 'CLAIM_SCHEMA_INVALID'),
])
def test_commit_rejects_conflicting_or_invalid_locator_accounting_without_side_effects(tmp_path, change, code):
    from rule_set_preparation.claim_files import commit_claims
    context, _ = runtime(tmp_path)
    path = first_path(context)
    value = file_value(context, path)
    change(value)
    write(context, path, value)
    before = deepcopy(context.draft)
    result = commit_claims(context, [path])
    assert result['outcome'] == 'FAILED'
    assert code in {row['code'] for keys in result['errors'].values() for rows in keys.values() for row in rows}
    assert context.draft == before


def test_structural_context_file_with_no_review_units_never_sends_an_empty_complete(tmp_path, monkeypatch):
    from rule_set_preparation.claim_files import commit_claims
    context, _ = runtime(tmp_path)
    source, frontier = context.source_graph, context.inventory.frontier
    source_path, ids = next((path, ids) for path, ids in source.source_files.items() if not set(ids) & source.review_node_ids())
    path = claim_path(source_path)
    write(context, path, {'article': source.file_articles[source_path], 'claims': [],
        'noClaims': {source.locators[nid]: 'Structural context only' for nid in ids}})
    frontier.snapshot = {'progress': {'total': len(source.review_node_ids())}}
    monkeypatch.setattr(frontier, 'restore', lambda **kwargs: None)
    assert commit_claims(context, [path]) == {'outcome': 'PASSED', 'committedNodes': []}
    assert not context.draft['sourceAccounting']


@pytest.mark.parametrize('start,end', [(-1, 1), (0, 0), (0, 9), (1, 2), (2, 3), (True, 2)])
def test_source_support_rejects_invalid_or_half_surrogate_offsets(start, end):
    from rule_set_preparation.claim_inventory import utf16_slice
    with pytest.raises((ValueError, UnicodeError)):
        utf16_slice('a😀b', start, end)


def test_support_resolves_utf16_and_pins_hash_without_duplicating_text():
    from rule_set_preparation.claim_inventory import canonical_support, utf16_slice
    source = SimpleNamespace(nodes={'n': {'content': 'a😀b'}})
    support = canonical_support(source, ['n'], [{'nodeId': 'n', 'startOffset': 1, 'endOffset': 3}])
    assert set(support[0]) == {'nodeId', 'startOffset', 'endOffset', 'contentSha256'}
    assert utf16_slice(source.nodes['n']['content'], 1, 3) == '😀'
    with pytest.raises(ValueError, match='mismatch'):
        canonical_support(source, ['n'], [{**support[0], 'contentSha256': '0' * 64}])


def test_quote_provenance_keeps_original_whitespace_and_utf16_coordinates():
    from rule_set_preparation.claim_inventory import utf16_slice, text_sha
    from rule_set_preparation.claim_tools import support_span
    source = SimpleNamespace(nodes={'n': {'content': '😀  Alpha\n\t beta.'}})
    span = support_span(source, 'n', 'Alpha beta.')
    assert span['startOffset'] == 4
    assert utf16_slice(source.nodes['n']['content'], span['startOffset'], span['endOffset']) == 'Alpha\n\t beta.'
    assert span['contentSha256'] == text_sha('Alpha\n\t beta.')
    with pytest.raises(ValueError, match='verbatim'):
        support_span(source, 'n', 'alpha beta.')
    source.nodes['n']['content'] = 'Alpha beta. Alpha beta.'
    with pytest.raises(ValueError, match='more than once'):
        support_span(source, 'n', 'Alpha beta.')


def test_bound_reference_is_declared_once_and_its_relation_is_derived():
    from rule_set_preparation.claim_files import _normalize

    rid = "a" * 64
    value = {"claims": [{"key": "duty", "type": "DUTY"}, {"key": "defn", "type": "DEFINITION"}],
             "references": {rid: {"material": True, "binding": {"from": "duty", "to": "defn", "kind": "DEFINED_BY"}}}}
    _normalize(value)
    assert value["claims"][0]["relations"] == [{"kind": "DEFINED_BY", "to": "defn", "referenceId": rid}]
    _normalize(value)  # idempotent: an explicit or already derived relation is not duplicated
    assert len(value["claims"][0]["relations"]) == 1 and value["claims"][1]["relations"] == []


def test_finalize_gaps_name_claims_by_file_and_key_instead_of_hash():
    from rule_set_preparation.claim_inventory import grouped_gaps

    cid = "b" * 64
    result = {"failures": [{"code": "SEMANTIC_CLOSURE_INVALID", "ref": "semanticGraph", "detail": "FREE_FLOATING_MODIFIER:" + cid}]}
    gaps = grouped_gaps(result, {}, {cid: "doc/chapter-i/dieu-2.json#scope-1"})
    assert gaps["gaps"]["SEMANTIC_CLOSURE_INVALID"]["examples"][0]["detail"] == "FREE_FLOATING_MODIFIER:doc/chapter-i/dieu-2.json#scope-1"
    assert grouped_gaps(result)["gaps"]["SEMANTIC_CLOSURE_INVALID"]["examples"][0]["detail"].endswith(cid)


def test_finalize_reports_all_actionable_gaps_in_a_bounded_batch():
    from rule_set_preparation.claim_inventory import grouped_gaps
    failures = [{"code": "APPLICABILITY_AUTHORITY_MISSING", "ref": f"claim:{i}", "detail": "Repair this exact claim"} for i in range(25)]
    group = grouped_gaps({'failures': failures})['gaps']['APPLICABILITY_AUTHORITY_MISSING']
    assert group['count'] == 25 and len(group['examples']) == 20
    assert [row['ref'] for row in group['examples']] == [f'claim:{i}' for i in range(20)]


def test_reference_binding_in_the_wrong_place_names_the_expected_locators(tmp_path):
    context, bundle = runtime(tmp_path)
    nodes = list(context.source_graph.nodes.values())
    origin = next(n for n in nodes if n['documentId'] == 'luat-134' and n['content'])
    target = next(n for n in nodes if n['documentId'] == 'qd-33' and n['content'])
    rid = 'd' * 64
    bundle['documentGraph']['references'] = [{'referenceId': rid, 'fromNodeId': origin['nodeId'], 'toNodeId': target['nodeId'], 'resolutionState': 'RESOLVED',
                                              'candidateNodeIds': [], 'text': 'target', 'charStart': 0, 'charEnd': 1}]
    context.source_graph = PinnedSourceGraph(bundle['documentGraph'], [c for d in bundle['documents'] for c in d['chunks']])
    path = first_path(context)
    value = file_value(context, path)
    other = deepcopy(value['claims'][0]); other['key'] = 'other'
    value['claims'].append(other)
    value['references'][rid] = {'material': True, 'binding': {'from': 'duty', 'to': 'other', 'kind': 'CROSS_REFERENCE'}}
    write(context, path, value)
    errors = [e for by_key in check_claims(context, [path])[0]['errors'].values() for rows in by_key.values() for e in rows]
    fix = next(e['fix'] for e in errors if e['code'] == 'REFERENCE_DIRECTION_INVALID')
    assert context.source_graph.locators[origin['nodeId']] in fix and context.source_graph.locators[target['nodeId']] in fix


def test_legal_effect_target_is_cited_as_printed_and_resolved_to_its_node(tmp_path):
    context, _ = runtime(tmp_path)
    path = first_path(context)
    value = file_value(context, path)
    value['claims'][0]['frame'] = {'legalEffect': {'kind': 'REPEALS', 'targets': [{'nodeId': 'qd-33#art-2', 'scope': 'EXACT'}], 'unresolvedTargets': [],
                                                    'effectiveFrom': None, 'effectiveUntil': None, 'conditions': None}}
    write(context, path, value)
    result, _, candidates = check_claims(context, [path])
    assert result['outcome'] == 'PASSED', result
    node = context.source_graph.resolve_locator('qd-33', 'art-2')
    assert candidates[(path, 'duty')]['semanticFrame']['legalEffect']['targets'][0]['nodeId'] == node


def test_a_modifier_relation_written_backwards_is_turned_around():
    from rule_set_preparation.claim_files import _normalize

    value = {"claims": [{"key": "duty", "type": "DUTY", "relations": [{"kind": "CONDITION_OF", "to": "scope"}]},
                        {"key": "scope", "type": "SCOPE"}, {"key": "defn", "type": "DEFINITION", "relations": [{"kind": "DEFINED_BY", "to": "duty"}]}]}
    _normalize(value)
    duty, scope, defn = value["claims"]
    assert duty["relations"] == [] and scope["relations"] == [{"kind": "CONDITION_OF", "to": "duty"}]
    assert defn["relations"] == [{"kind": "DEFINED_BY", "to": "duty"}]  # only modifier kinds are turned
    _normalize(value)
    assert scope["relations"] == [{"kind": "CONDITION_OF", "to": "duty"}]


def test_finalize_releases_unreachable_definitions_and_never_a_duty_or_a_limit(tmp_path, monkeypatch):
    import json
    import rule_set_preparation.claim_files as claim_files
    from rule_set_preparation.claim_inventory import identity_key

    context, _ = runtime(tmp_path)
    path = first_path(context)
    value = file_value(context, path)
    defn = deepcopy(value['claims'][0])
    defn.update(key='Defn', type='DEFINITION', authority='DEFINITION', assessability='NON_ASSESSABLE', actor=None, action=None, relations=[{'kind': 'DEFINED_BY', 'to': 'duty'}])
    scope = deepcopy(defn)
    scope.update(key='scope', type='SCOPE', authority='LEGAL_NORMATIVE', relations=[])
    value['claims'] += [defn, scope]
    write(context, path, value)
    ids = {'d' * 64: 'Defn', 'e' * 64: 'duty', 'f' * 64: 'scope'}
    context.inventory.identities.update({cid: identity_key(claim_files.global_key(path, key)) for cid, key in ids.items()})
    context.draft['semanticClaims'] = {'d' * 64: {'claimType': 'DEFINITION'}, 'e' * 64: {'claimType': 'DUTY'}, 'f' * 64: {'claimType': 'SCOPE'}}
    committed = []
    monkeypatch.setattr(claim_files, 'commit_claims', lambda ctx, paths: committed.append(paths) or {'outcome': 'PASSED'})
    unreachable = lambda cid: {'code': 'SEMANTIC_CLOSURE_INVALID', 'ref': 'claim:' + cid, 'detail': 'UNREACHABLE_RELEVANT_CLAIM: declare its relationship'}
    released = claim_files.release_unconnected(context, [unreachable('d' * 64), unreachable('e' * 64), unreachable('f' * 64)])
    assert released == [context.inventory.identities['d' * 64]]
    saved = {c['key']: c for c in json.loads(claim_files.disk_path(context, path).read_text(encoding='utf-8'))['claims']}
    assert saved['Defn']['relevant'] is False and saved['Defn']['nonOperativeReason'] == claim_files.RELEASE_REASON and saved['Defn']['relations'] == []
    assert saved['duty'].get('relevant', True) is True and saved['scope'].get('relevant', True) is True and committed == [[path]]
    assert claim_files.release_unconnected(context, [unreachable('e' * 64), unreachable('f' * 64)]) == []  # a duty or a limit is never released



def test_finalize_gaps_name_a_wrong_relation_by_kind_and_endpoints():
    from rule_set_preparation.claim_inventory import grouped_gaps, readable_names

    a, b, rid = 'a' * 64, 'b' * 64, 'c' * 64
    names = readable_names({a: 'doc/dieu-1.json#duty', b: 'doc/dieu-1.json#scope'}, {rid: {'kind': 'CONDITION_OF', 'fromClaimId': a, 'toClaimId': b}})
    gaps = grouped_gaps({'failures': [{'code': 'SEMANTIC_CLOSURE_INVALID', 'ref': 'semanticGraph', 'detail': 'WRONG_RELATION:' + rid}]}, {}, names)
    assert gaps['gaps']['SEMANTIC_CLOSURE_INVALID']['examples'][0]['detail'] == 'WRONG_RELATION:CONDITION_OF doc/dieu-1.json#duty -> doc/dieu-1.json#scope'


def test_an_assessable_requirement_without_a_rule_is_named_in_the_packet_failure():
    from rule_set_preparation.tools import _packet_field_repair

    packet = {"legalRequirements": [{"legalRequirementId": "R-a"}, {"legalRequirementId": "R-b"}]}
    detail = _packet_field_repair(packet, "packet.legalRequirements.1.coverage.state")
    assert "'R-b'" in detail and "author_assessment_rule" in detail and "reopen" in detail
    assert _packet_field_repair(packet, "packet.legalRequirements.9.coverage.state") == "Repair this candidate field using the typed authoring tool"


def test_an_assessment_rule_with_a_missing_requirement_names_both_in_the_packet_failure():
    from rule_set_preparation.tools import _packet_field_repair

    packet = {"assessmentRules": [{"assessmentRuleId": "AR-1", "legalRequirementIds": ["R-gone"]}]}
    detail = _packet_field_repair(packet, "packet.assessmentRules.0.legalRequirementIds.0")
    assert "'AR-1'" in detail and "'R-gone'" in detail and "author_assessment_rule" in detail


def test_authoring_draft_is_durable_before_ack_and_retries_an_interrupted_save(tmp_path):
    context, _ = runtime(tmp_path)
    calls = []

    class Api:
        saved = {"draft": None, "draftVersion": 0}
        lose_response = False

        def claim_inventory_operation(self, run_id, action, revision, **fields):
            calls.append((action, revision))
            if action == "SAVE_AUTHORING_DRAFT":
                if fields["draftVersion"] == self.saved["draftVersion"]:
                    self.saved = {"draft": deepcopy(fields["draft"]), "draftVersion": self.saved["draftVersion"] + 1}
                else:
                    assert fields["draft"] == self.saved["draft"]  # retry of the accepted snapshot
                if self.lose_response:
                    self.lose_response = False
                    raise ConnectionError("save response lost")
            return {"outcome": "PASSED", **deepcopy(self.saved)}

    context.api = Api()
    inventory = context.inventory
    inventory.frozen = {"claims": []}
    inventory.restore_authoring_draft()
    context.draft["legalRequirements"] = {"R-1": {"title": "one"}}
    inventory.save_authoring_draft()
    context.draft["legalRequirements"]["R-2"] = {"title": "two"}
    context.api.lose_response = True
    with pytest.raises(ConnectionError):
        inventory.save_authoring_draft()
    assert inventory.draft_unsaved and inventory.draft_version == 1
    inventory.flush_authoring_draft()
    assert inventory.draft_version == 2 and not inventory.draft_unsaved
    assert set(context.api.saved["draft"]["legalRequirements"]) == {"R-1", "R-2"}
    before = len(calls)
    inventory.save_authoring_draft()  # identical retry does not create another snapshot
    assert len(calls) == before
    context.draft["legalRequirements"], inventory.draft_restored = {}, False
    inventory.restore_authoring_draft()
    assert set(context.draft["legalRequirements"]) == {"R-1", "R-2"} and inventory.draft_version == 2
    context.draft["legalRequirements"], inventory.draft_restored = {"R-own": {}}, False
    with pytest.raises(RuntimeError, match="before local edits"):
        inventory.restore_authoring_draft()
    assert not inventory.draft_restored


def test_rejected_draft_save_stays_dirty_and_failed_load_is_retryable(tmp_path):
    context, _ = runtime(tmp_path)
    class Api:
        def claim_inventory_operation(self, *args, **kwargs):
            return {"outcome": "FAILED", "failures": [{"code": "STALE_AUTHORING_DRAFT"}]}
    context.api = Api()
    inventory = context.inventory
    inventory.frozen = {"claims": []}
    with pytest.raises(RuntimeError, match="save rejected"):
        inventory.save_authoring_draft()
    assert inventory.draft_unsaved
    with pytest.raises(RuntimeError, match="load rejected"):
        inventory.restore_authoring_draft()
    assert not inventory.draft_restored


def test_bad_quote_feedback_includes_the_pinned_text_without_accepting_paraphrase(tmp_path):
    context, _ = runtime(tmp_path)
    path = first_path(context)
    value = file_value(context, path)
    value['claims'][0]['support'][0]['quote'] = 'A made-up paraphrase'
    write(context, path, value)
    result = check_claims(context, [path])[0]
    error = next(e for e in result['errors'][path]['duty'] if e['code'] == 'SOURCE_SUPPORT_INVALID')
    assert result['outcome'] == 'FAILED' and 'Nhà cung cấp 😀 phải bảo vệ dữ liệu.' in error['fix']


def test_source_blocks_preserve_the_pinned_ast_parent_context(tmp_path):
    context, bundle = runtime(tmp_path)
    materialize_legal_source(bundle, tmp_path)
    source = context.source_graph
    for path, ids in source.source_files.items():
        rendered = (tmp_path / path.lstrip('/')).read_text()
        for nid in ids:
            node = source.nodes[nid]
            parent = source.locators.get(node.get('parentNodeId'), 'document root')
            assert f'[{source.locators[nid]}]\nnode-type: {node["nodeType"]}; parent-locator: {parent}\n{node["content"]}' in rendered


def test_an_invalid_requirement_id_is_rejected_by_the_tool_and_named_by_the_packet_failure():
    from rule_set_preparation.claim_tools import ID_PATTERN
    from rule_set_preparation.tools import _packet_field_repair
    import re

    assert re.fullmatch(ID_PATTERN, "high_risk.duty:1-a") and not re.fullmatch(ID_PATTERN, "điều_14") and not re.fullmatch(ID_PATTERN, "_x") and not re.fullmatch(ID_PATTERN, "a b")
    detail = _packet_field_repair({"legalRequirements": [{"legalRequirementId": "điều_14"}]}, "packet.legalRequirements.0.legalRequirementId")
    assert "'điều_14'" in detail and "remove_rule_candidate" in detail
