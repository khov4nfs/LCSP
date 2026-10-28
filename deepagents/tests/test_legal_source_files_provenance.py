from __future__ import annotations
import pytest

import hashlib
from pathlib import Path

from rule_set_preparation.legal_source_files import INDEX_PATH, materialize_legal_source


def test_unknown_legal_status_source_ref_remains_null_in_index(tmp_path: Path) -> None:
    content = "Synthetic source provision."
    content_sha256 = hashlib.sha256(content.encode("utf-8")).hexdigest()
    from test_claim_files import fixture_bundle
    from rule_set_preparation.source_graph import PinnedSourceGraph
    bundle = fixture_bundle()
    for document in bundle['documents']:
        for chunk in document['chunks']:
            chunk.update(legalStatusSourceRef=None, legalEffectStatus='UNKNOWN')
    for node in bundle['documentGraph']['nodes']:
        node['legalEffectStatus'] = 'UNKNOWN'
    paths = materialize_legal_source(bundle, tmp_path)
    source = PinnedSourceGraph(bundle['documentGraph'], [c for d in bundle['documents'] for c in d['chunks']])
    assert paths[0] == INDEX_PATH
    assert all(c['legalStatusSourceRef'] is None for c in source.chunks.values())
    assert all(n['legalEffectStatus'] == 'UNKNOWN' for n in source.nodes.values())
