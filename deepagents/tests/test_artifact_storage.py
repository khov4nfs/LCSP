import os
import json
import shutil

from tools.common.capabilities.platform.artifact_storage import ArtifactStorage


def test_artifact_storage_chunking() -> None:
    from tools.common.capabilities.platform.logging_path import get_repo_root

    storage_path = os.path.join(get_repo_root(), "tmp", "lcsp-storage-test-python")
    storage = ArtifactStorage(storage_path=storage_path)

    payload = {
        "hello": "world",
        "data": "A" * 1000,
    }

    manifest = storage.write_payload_chunks(payload, chunk_size=200)

    assert manifest["total_size"] > 0
    assert len(manifest["chunks"]) >= 5
    assert manifest["hash"]

    reconstructed_bytes = b""
    for chunk_id in manifest["chunks"]:
        chunk_path = os.path.join(storage.chunks_path, chunk_id)
        with open(chunk_path, "rb") as file_handle:
            reconstructed_bytes += file_handle.read()

    reconstructed_payload = json.loads(reconstructed_bytes.decode("utf-8"))
    assert reconstructed_payload == payload

    shutil.rmtree(storage_path, ignore_errors=True)
