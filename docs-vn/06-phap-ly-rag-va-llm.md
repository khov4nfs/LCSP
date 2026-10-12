# 06 — Pháp lý, RAG và LLM

> **Historical pre-freeze documentation.** This document records the earlier design or implementation. Current architecture authority is [the canonical Architecture Freeze](../reports/architecture-freeze-migration-manifest.md); current runtime names and release status must be read there and in the current PR #367 receipts.

## Legal corpus

Nguồn pháp lý phải là URL chính thức đã được xác minh. Mỗi lần ingest lưu snapshot bất biến trong S3-compatible storage cùng URL, thời điểm lấy và SHA-256 hash.

Dữ liệu được chuẩn hóa theo văn bản, chương, điều, khoản, điểm và phụ lục. Mọi thay đổi nội dung hoặc hiệu lực tạo phiên bản mới; LegalCorpusVersion đã APPROVED không bị sửa.

Quy trình:

```text
LegalSource VALIDATED
-> ingest snapshot và metadata
-> DRAFT corpus
-> Internal Legal Operator review
-> APPROVED
-> build ChromaDB vectorless legal index
-> READY cho retrieval
```

Corpus approval là kiểm soát nội bộ, không phải chứng nhận pháp lý.

## ChromaDB vectorless retrieval

Quyết định Phase 5.2L khóa:

```text
CHROMADB_STRUCTURE_FIRST_VECTORLESS_LEGAL_RAG_APPROVED
POSTGRESQL_PGVECTOR_LEGAL_RETRIEVAL_SUPERSEDED
LEGAL_STRUCTURE_PRESERVATION_REQUIRED
CROSS_REFERENCE_EXPANSION_REQUIRED
RETRIEVED_CITATION_ALLOWLIST_REQUIRED
```

LCSP MVP không dùng dense embedding hoặc vector-similarity làm retrieval path chính cho legal corpus. ChromaDB được dùng cho document/chunk storage, stable IDs, metadata filtering, full-text matching, direct lookup theo ID/filter và lấy referenced context theo xref graph.

Đơn vị retrieval cơ sở là Khoản. Điểm phải kèm context Khoản và Điều cha khi assemble. Khi Điều/Khoản X dẫn chiếu Y, ingestion tạo xref edge; nếu X được retrieve thì Y được lấy thêm 1-hop với `context_role=REFERENCED_CONTEXT`.

Kết quả gửi sang legal matching hoặc LLM phải phân biệt:

```text
PRIMARY_MATCH
PARENT_CONTEXT
REFERENCED_CONTEXT
```

`legal_ref` chỉ hợp lệ khi trỏ tới chunk trong `retrieved_chunks` hoặc `referenced_context_chunks`. Ref ngoài allowlist bị reject.

Mỗi kết quả quan trọng phải dựng lại được document ID, số/loại/tiêu đề/cơ quan ban hành, điều/khoản/điểm, source URL, content hash, corpus version, ngày hiệu lực, chunk ID, context role và retrieval audit ID. Candidate thiếu citation không được dùng cho LegalRuleMatch quan trọng.

## LLM Gateway

Mọi external model call đi qua LLM Gateway. Bài nghiệm thu A-to-Z dùng provider/model thật; mock chỉ dùng cho test hoặc phát triển offline.

Gateway chịu trách nhiệm cấu hình provider/model, secret reference, timeout, retry, output schema validation, token/cost budget, ModelRunMetadata, output hash và fail-closed behavior.

Không gửi raw repository source, credentials, full customer prompt, full AST hoặc unredacted logs sang LLM service. Classification và document generation không được tạo kết luận vượt quá evidence và citation allowlist đã retrieve.

BGE-M3 hoặc model embedding khác chỉ là optional future reranker/semantic retrieval model. Không ghi nhận là dependency bắt buộc của legal retrieval MVP.
