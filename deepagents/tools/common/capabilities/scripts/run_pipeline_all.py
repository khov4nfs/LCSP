import subprocess
import json
import hashlib
import sys
from pathlib import Path

# Đảm bảo đường dẫn chuẩn bất kể chạy script từ thư mục nào
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parents[2]
LEGAL_SCRIPTS_DIR = PROJECT_ROOT / "tools" / "legal" / "scripts"

def sha256_text(text: str) -> str:
    return "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()

def create_seed_files(doc_id: str):
    storage = PROJECT_ROOT / "output" / "test_storage"
    
    # 1. Read real reviewed text
    text_path = PROJECT_ROOT / "output" / f"{doc_id}.reviewed.txt"
    if not text_path.exists():
        print(f"Bỏ qua {doc_id} vì không tìm thấy file text gốc!")
        return False
        
    text = text_path.read_text(encoding="utf-8").rstrip("\n")
    content_hash = sha256_text(text)
    
    # 2. Seed Reviewed Input
    rev_dir = storage / "reviewed-corpus-inputs/registry/reviewed-inputs"
    rev_dir.mkdir(parents=True, exist_ok=True)
    rev_file = rev_dir / f"reviewed-input__{doc_id}.json"
    rev_file.write_text(json.dumps({
        "reviewedInputRef": f"reviewed-input:{doc_id}",
        "provenanceRef": f"prov:reviewed-input:{doc_id}",
        "extractionRef": f"extraction:canonical-{doc_id}",
        "qualityManifestRef": f"quality-manifest:{doc_id}",
        "correctionProfile": "DETERMINISTIC_V1",
        "status": "READY",
        "coverageState": "SUFFICIENT",
        "contentSha256": content_hash,
        "qualityDecision": "PASS",
        "manualApprovalRequired": False,
        "documentId": doc_id,
        "snapshotRef": f"snapshot:{doc_id}",
        "sourceKind": "html",
        "normalizedTextPath": str(text_path.absolute()),
        "manifestPath": str(text_path.absolute()),
        "evidenceRefs": [],
        "limitations": []
    }, indent=2), encoding="utf-8")
    
    # 3. Seed Relationship Manifest
    rel_dir = storage / "relationship-manifests/registry/relationship-manifests"
    rel_dir.mkdir(parents=True, exist_ok=True)
    rel_file = rel_dir / f"relationship-manifest__{doc_id}.json"
    rel_file.write_text(json.dumps({
        "relationshipManifestRef": f"relationship-manifest:{doc_id}",
        "provenanceRef": f"prov:relationships:{doc_id}",
        "chunkSetRef": None,
        "targetDocumentId": doc_id,
        "sourceEffectStatus": "CON_HIEU_LUC",
        "materializedRelationships": [],
        "evidenceRefs": [],
        "limitations": [],
        "manifestPath": str(rel_file.absolute())
    }, indent=2), encoding="utf-8")
    
    return True

def run_pipeline_for(doc_id: str):
    print(f"\n{'='*50}\nBẮT ĐẦU PIPELINE CHO: {doc_id}\n{'='*50}")
    
    reviewed_input_ref = f"reviewed-input:{doc_id}"
    print(f"[OK] BƯỚC 1 (Đã seed giả) -> {reviewed_input_ref}")
    
    # Bước 2
    p2 = subprocess.run([
        sys.executable, str(LEGAL_SCRIPTS_DIR / "build_legal_chunks.py"),
        "--storage-root", "output/test_storage",
        "--reviewed-input-ref", reviewed_input_ref,
        "--document-identity-ref", f"catalog-source:vbpl.vn:law:{doc_id}",
        "--chunk-schema-version", "LEGAL_CHUNK_V1"
    ], capture_output=True, text=True, encoding="utf-8", cwd=str(PROJECT_ROOT))
    
    if p2.returncode != 0 or "READY" not in p2.stdout:
        print("LỖI BƯỚC 2:", p2.stderr or p2.stdout)
        return
        
    out2 = json.loads(p2.stdout)
    chunk_set_ref = out2["result"]["chunkSetRef"]
    print(f"[OK] BƯỚC 2 -> {chunk_set_ref}")
    
    # Bước 3
    p3 = subprocess.run([
        sys.executable, str(LEGAL_SCRIPTS_DIR / "validate_chunk_integrity.py"),
        "--storage-root", "output/test_storage",
        "--chunk-set-ref", chunk_set_ref,
        "--relationship-manifest-ref", f"relationship-manifest:{doc_id}",
        "--validation-profile", "LEGAL_INTEGRITY_V1"
    ], capture_output=True, text=True, encoding="utf-8", cwd=str(PROJECT_ROOT))
    
    if p3.returncode != 0 or "READY" not in p3.stdout:
        print("LỖI BƯỚC 3:", p3.stderr or p3.stdout)
        return
        
    out3 = json.loads(p3.stdout)
    integrity_manifest_ref = out3["result"]["validationManifestRef"]
    print(f"[OK] BƯỚC 3 -> {integrity_manifest_ref}")
    
    # Bước 4
    p4 = subprocess.run([
        sys.executable, str(LEGAL_SCRIPTS_DIR / "build_legal_retrieval_index.py"),
        "--storage-root", "output/test_storage",
        "--chunk-set-ref", chunk_set_ref,
        "--integrity-manifest-ref", integrity_manifest_ref,
        "--index-profile", "CHROMA_STRUCTURE_V1"
    ], capture_output=True, text=True, encoding="utf-8", cwd=str(PROJECT_ROOT))
    
    if p4.returncode != 0 or "READY" not in p4.stdout:
        print("LỖI BƯỚC 4:", p4.stderr or p4.stdout)
        return
        
    out4 = json.loads(p4.stdout)
    collection_name = out4["result"]["collectionName"]
    chunk_count = out4["result"]["indexedChunkCount"]
    print(f"[OK] BƯỚC 4 -> Đã ghi vào collection '{collection_name}' với {chunk_count} chunks!")

def main():
    docs = ["134-2025-QH15", "LAW-71-2025-QH15"]
    for doc in docs:
        if create_seed_files(doc):
            run_pipeline_for(doc)

if __name__ == "__main__":
    main()
