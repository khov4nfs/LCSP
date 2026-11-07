"""Provider-free dependency, imported only by pytest and explicit offline harnesses.

Synthetic approval is never written to a production manifest or selected by an
environment flag. The production loader remains unchanged and independently tested.
"""
from contextlib import contextmanager
from hashlib import sha256
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from runtime_instruction_bundle import ApprovedEnglishRuntimeBundle


def build_test_bundle(directory: Path):
    root = Path(__file__).resolve().parents[1]
    inventory = json.loads((root / "instructions/inventory.json").read_text(encoding="utf-8"))
    entries = []
    origins, runtimes = [], []
    for row in inventory["entries"]:
        identity = row["sourceId"]
        vi = (root / row["vietnameseSourcePath"]).read_bytes()
        en = (root / row["englishCandidatePath"]).read_bytes()
        origin, runtime = sha256(vi).hexdigest(), sha256(en).hexdigest()
        if origin != row["sourceSha256"] or runtime != row["englishCandidateSha256"] or origin != row["candidateOriginSha256"]:
            raise ValueError("TEST_BUNDLE_SOURCE_OR_CANDIDATE_DRIFT:" + identity)
        for path, data in ((row["vietnameseSourcePath"], vi), (row["englishCandidatePath"], en)):
            destination = directory / path
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)
        entries.append({"sourceId": identity, "vietnameseSourcePath": row["vietnameseSourcePath"],
                        "vietnameseSourceRevision": row["vietnameseSourceRevision"], "vietnameseSourceSha256": origin,
                        "englishRuntimePath": row["englishCandidatePath"], "englishRuntimeSha256": runtime})
        origins.append({"sourceId": identity, "sha256": origin})
        runtimes.append({"sourceId": identity, "sha256": runtime})
    def aggregate(rows):
        return sha256(json.dumps(sorted(rows, key=lambda row: row["sourceId"]), separators=(",", ":"), ensure_ascii=False).encode("utf-8")).hexdigest()
    manifest = {"bundleSchemaVersion": "LCSP_EN_RUNTIME_BUNDLE_V1", "bundleId": "TEST_ONLY_COMPLETE_BUNDLE",
                "approvalStatus": "APPROVED", "approvalIdentity": "TEST_ONLY_OFFLINE_REVIEWER", "approvalRevision": "TEST_ONLY_R1",
                "vietnameseInventorySha256": aggregate(origins), "englishBundleSha256": aggregate(runtimes), "entries": entries}
    path = directory / "test-only-manifest.json"
    path.write_text(json.dumps(manifest), encoding="utf-8")
    return ApprovedEnglishRuntimeBundle.load(directory, path, expected_entry_ids=inventory["requiredSourceIds"],
        approval_verifier=lambda value: value["approvalIdentity"] == "TEST_ONLY_OFFLINE_REVIEWER" and value["approvalRevision"] == "TEST_ONLY_R1")


@contextmanager
def offline_instruction_bundle():
    with TemporaryDirectory(prefix="lcsp-test-only-bundle-") as directory:
        bundle = build_test_bundle(Path(directory))
        with patch("runtime_instruction_bundle.production_runtime_bundle", return_value=bundle):
            yield bundle
