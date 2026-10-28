"""A source-grounded effect changes only its selected provision and date scope."""
from copy import deepcopy
from types import SimpleNamespace

import pytest

from rule_set_preparation.legal_effect import applicable_legal_state
from rule_set_preparation.source_graph import PinnedSourceGraph
from test_claim_files import fixture_bundle


@pytest.mark.parametrize('scope,descendant_applies', [('EXACT', False), ('SUBTREE', True)])
def test_cross_document_partial_repeal_does_not_expire_a_whole_law(scope, descendant_applies):
    bundle = fixture_bundle()
    source = PinnedSourceGraph(bundle['documentGraph'], [c for d in bundle['documents'] for c in d['chunks']])
    target = next(n for n in source.nodes.values() if n['documentId'] == 'qd-33' and n['nodeType'] == 'ARTICLE')
    child = next(n for n in source.nodes.values() if n['parentNodeId'] == target['nodeId'])
    sibling = next(n for n in source.nodes.values() if n['documentId'] == target['documentId'] and n['nodeType'] == 'ARTICLE' and n != target)
    owner = next(n for n in source.nodes.values() if n['documentId'] == 'luat-134' and n['content'])
    before = deepcopy(source.graph)
    effect = {'kind': 'REPEALS', 'targets': [{'nodeId': target['nodeId'], 'scope': scope}],
              'unresolvedTargets': [], 'effectiveFrom': '2026-01-01', 'effectiveUntil': None, 'conditions': None}
    claim = {'claimId': 'reviewed-repeal', 'sourceNodeIds': [owner['nodeId']], 'semanticFrame': {'legalEffect': effect},
             'sourceSupport': [{'nodeId': owner['nodeId'], 'startOffset': 0, 'endOffset': 1}]}
    frontier = SimpleNamespace(restore=lambda **_: None, claim_owners={}, snapshot={'progress': {'discoveryCompleteEligible': True}})
    context = SimpleNamespace(source_graph=source, draft={'sourceAccounting': {owner['nodeId']: {}}},
                              inventory=SimpleNamespace(frontier=frontier, graph=lambda: {'claims': [claim]}))
    project = lambda node, date='2026-10-25': applicable_legal_state(context, node['nodeId'], date)
    assert project(target)['applicableVerifiedKinds'] == ['REPEALS']
    assert project(child)['applicableVerifiedKinds'] == (['REPEALS'] if descendant_applies else [])
    assert project(sibling)['applicableVerifiedKinds'] == []
    assert project(owner)['applicableVerifiedKinds'] == []
    assert project(target, '2025-12-31')['applicableVerifiedKinds'] == []
    effect['conditions'] = 'A source-stated condition still requires interpretation.'
    assert project(target)['applicableVerifiedKinds'] == []
    assert not project(target)['complete']
    effect['conditions'], effect['effectiveFrom'] = None, None
    assert project(target)['applicableVerifiedKinds'] == []
    assert not project(target)['complete']
    assert source.graph == before
