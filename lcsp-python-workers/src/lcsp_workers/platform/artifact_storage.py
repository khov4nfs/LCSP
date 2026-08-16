import os
import json
import uuid
import hashlib
from typing import Any, Dict

class ArtifactStorage:
    def __init__(self, storage_path: str | None = None) -> None:
        self.storage_path = storage_path or os.getenv("LCSP_ARTIFACT_STORAGE_PATH", "/tmp/lcsp-storage")
        self.chunks_path = os.path.join(self.storage_path, "chunks")
        os.makedirs(self.chunks_path, exist_ok=True)

    def write_payload_chunks(self, payload: dict[str, Any], chunk_size: int = 500 * 1024) -> dict[str, Any]:
        """Serialize payload to JSON, compute SHA-256 hash, split into chunks, and return the manifest."""
        serialized = json.dumps(payload, ensure_ascii=False)
        serialized_bytes = serialized.encode("utf-8")
        
        sha256_hash = hashlib.sha256(serialized_bytes).hexdigest()
        artifact_id = str(uuid.uuid4())
        chunks = []
        
        total_len = len(serialized_bytes)
        offset = 0
        chunk_idx = 0
        while offset < total_len:
            chunk_data = serialized_bytes[offset : offset + chunk_size]
            chunk_id = f"{artifact_id}_chunk_{chunk_idx}.json"
            chunk_filepath = os.path.join(self.chunks_path, chunk_id)
            
            with open(chunk_filepath, "wb") as f:
                f.write(chunk_data)
                
            chunks.append(chunk_id)
            offset += chunk_size
            chunk_idx += 1
            
        return {
            "artifact_id": artifact_id,
            "total_size": total_len,
            "hash": sha256_hash,
            "chunks": chunks
        }
