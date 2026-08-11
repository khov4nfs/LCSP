import importlib.util
import json
import sys
from pathlib import Path


script_path = Path(__file__).parents[1] / "scripts" / "normalize_vbpl_document.py"
spec = importlib.util.spec_from_file_location("normalize_vbpl_document", script_path)
assert spec and spec.loader
normalize_module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = normalize_module
spec.loader.exec_module(normalize_module)
VbplNormalizer = normalize_module.VbplNormalizer


def test_normalizer_builds_stable_hierarchy_chunks(tmp_path: Path):
    html_path = tmp_path / "LAW-TEST.source.html"
    html_path.write_text(
        """
        <p class="prov-article">Điều 1. Phạm vi</p>
        <p class="prov-clause">1. Nội dung theo Điều 2.</p>
        <p class="prov-item">a) Chi tiết.</p>
        <p class="prov-article">Điều 2. Tham chiếu</p>
        <p class="prov-content">Nội dung trực tiếp.</p>
        """,
        encoding="utf-8",
    )
    manifest_path = tmp_path / "LAW-TEST.source.json"
    manifest_path.write_text(
        json.dumps(
            {
                "documentId": "LAW-TEST",
                "title": "Luật thử nghiệm",
                "sourceUrl": "https://vbpl.vn/test",
                "sourceSha256": "sha256:" + "a" * 64,
                "sourceEffectStatus": "Còn hiệu lực",
                "effectiveFrom": "2026-01-01T00:00:00",
                "htmlFile": html_path.name,
            }
        ),
        encoding="utf-8",
    )

    output_path = VbplNormalizer().normalize(
        source_manifest_path=manifest_path,
        corpus_version="VN-LEGAL-2026-01",
        output_path=tmp_path / "ingest.json",
    )

    payload = json.loads(output_path.read_text(encoding="utf-8"))
    chunks = {chunk["id"]: chunk for chunk in payload["documents"][0]["chunks"]}
    point = chunks["LAW-TEST::art-1::cl-1::pt-a"]
    assert point["hierarchy"]["parentChunkId"] == "LAW-TEST::art-1::cl-1"
    assert chunks["LAW-TEST::art-1::cl-1"]["hierarchy"]["outgoingRefIds"] == ["LAW-TEST::art-2"]
    assert chunks["LAW-TEST::art-2"]["content"].endswith("Nội dung trực tiếp.")
    assert payload["sourceManifest"]["reviewRequired"] is True
