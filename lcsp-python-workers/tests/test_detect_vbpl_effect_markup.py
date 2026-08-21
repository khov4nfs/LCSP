from __future__ import annotations

import json
from pathlib import Path

from lcsp_workers.legal.vbpl_effect_detector import detect_effects


def test_detects_vbpl_type_markers_as_reviewable_effects(tmp_path: Path) -> None:
    html_path = tmp_path / "LAW-TEST.source.html"
    html_path.write_text(
        """
        <p class="prov-article" id="art">Dieu 1. Scope</p>
        <p class="prov-clause" id="cl1" type="10:amended-ref">1. Amended.</p>
        <p class="prov-item" id="pt-a" parent-id="cl1" type="1:repealed-ref">a) Repealed.</p>
        <p class="prov-item" id="pt-b" parent-id="cl1" type="13:added-ref">b) Added.</p>
        <p class="prov-clause" id="cl2" type="10:old-ref" new-types="13:new-ref">2. Transition.</p>
        """,
        encoding="utf-8",
    )
    manifest_path = tmp_path / "LAW-TEST.source.json"
    manifest_path.write_text(
        json.dumps(
            {
                "documentId": "LAW-TEST",
                "htmlFile": html_path.name,
            }
        ),
        encoding="utf-8",
    )

    output_path = detect_effects(
        source_manifest_path=manifest_path,
        output_path=tmp_path / "LAW-TEST.effect-observations.json",
    )

    payload = json.loads(output_path.read_text(encoding="utf-8"))
    assert payload["summary"]["observationCount"] == 4
    assert payload["summary"]["byEffectKind"] == {
        "AMENDED": 2,
        "REPEALED": 1,
        "ADDED": 1,
    }
    assert payload["summary"]["transitions"] == {"10->13": 1}

    observations = {item["htmlId"]: item for item in payload["observations"]}
    assert observations["cl1"]["legalStatusCandidate"] == "AMENDED"
    assert observations["pt-a"]["legalStatusCandidate"] == "REPEALED"
    assert observations["pt-b"]["legalStatusCandidate"] == "ACTIVE"
    assert observations["cl2"]["newType"]["effectKind"] == "ADDED"
