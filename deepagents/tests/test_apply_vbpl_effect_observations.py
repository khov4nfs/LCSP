from __future__ import annotations

import json
from pathlib import Path

from tools.legal.sources.vbpl_effects.vbpl_effect_applier import apply_effect_observations


def test_applies_effect_observations_and_propagates_repealed_descendants(
    tmp_path: Path,
) -> None:
    normalized_path = tmp_path / "normalized.json"
    normalized_path.write_text(
        json.dumps(
            {
                "sourceManifest": {"normalizationWarnings": []},
                "documents": [
                    {
                        "documentId": "LAW-TEST",
                        "chunks": [
                            chunk("art-1"),
                            chunk("art-1::cl-1"),
                            chunk("art-1::cl-1::pt-a"),
                            chunk("art-2"),
                        ],
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    observations_path = tmp_path / "effects.json"
    observations_path.write_text(
        json.dumps(
            {
                "summary": {"observationCount": 2},
                "observations": [
                    observation("art-1::cl-1", "REPEALED", "REPEALED"),
                    observation("art-2", "AMENDED", "AMENDED"),
                ],
            }
        ),
        encoding="utf-8",
    )

    output_path = apply_effect_observations(
        normalized_payload_path=normalized_path,
        effect_observations_path=observations_path,
        output_path=tmp_path / "merged.json",
    )

    payload = json.loads(output_path.read_text(encoding="utf-8"))
    chunks = {
        chunk["locator"]: chunk
        for chunk in payload["documents"][0]["chunks"]
    }
    assert chunks["art-1"]["legalStatus"] == "ACTIVE"
    assert chunks["art-1::cl-1"]["legalStatus"] == "REPEALED"
    assert chunks["art-1::cl-1::pt-a"]["legalStatus"] == "REPEALED"
    assert chunks["art-2"]["legalStatus"] == "AMENDED"
    inherited = chunks["art-1::cl-1::pt-a"]["hierarchy"][
        "legalEffectObservations"
    ][0]
    assert inherited["inheritedFromLocator"] == "art-1::cl-1"
    assert payload["sourceManifest"]["effectMergeSummary"]["updatedChunkCount"] == 3


def chunk(locator: str) -> dict[str, object]:
    return {
        "id": f"LAW-TEST::{locator}",
        "locator": locator,
        "content": locator,
        "contentSha256": "sha256:" + "a" * 64,
        "hierarchy": {},
        "legalStatus": "ACTIVE",
    }


def observation(
    locator: str, effect_kind: str, legal_status_candidate: str
) -> dict[str, object]:
    return {
        "documentId": "LAW-TEST",
        "locator": locator,
        "effectKind": effect_kind,
        "legalStatusCandidate": legal_status_candidate,
        "htmlId": f"html-{locator}",
        "htmlParagraphIndex": 1,
        "type": {"typeCode": "1", "typeRef": "ref", "effectKind": effect_kind},
        "newType": None,
        "textSha256": "sha256:" + "b" * 64,
        "reviewRequired": True,
    }
