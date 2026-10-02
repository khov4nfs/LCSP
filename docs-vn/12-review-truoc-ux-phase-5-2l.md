# 12 — Review trước UX cho Phase 5.2L

## Phạm vi review

- Repository: `khovan123/LCSP`.
- Base `main`: `73f47560a075fe7991ba2611a87f52abbe2e0496`.
- Branch review trước khi cập nhật tệp này: `docs/add-vietnamese-condensed-guide` tại `aa641ef1489a5659721dd166d9d18deb7074089d`.
- Review toàn bộ inventory thay đổi của PR #2 và các active source-of-truth liên quan.
- Sau pass rút gọn, archive/planning/code-map/blueprint không còn thuộc active documentation inventory.

## Kết luận

```text
UX_REBASE_PENDING_AFTER_DOC_PRUNING
PHASE_5_2L_P0_CLOSURE_COMPLETED
PROJECT_OWNER_DOC_REMEDIATION_APPROVED
UX_ARTIFACT_REMOVED_FROM_ACTIVE_DOC_SET
DOC_INVENTORY_PRUNED_TO_AUTHORITY_SET
CHROMADB_STRUCTURE_FIRST_VECTORLESS_LEGAL_RAG_APPROVED
POSTGRESQL_PGVECTOR_LEGAL_RETRIEVAL_SUPERSEDED
```

Review ban đầu xác định baseline chưa đạt cross-document closure. Closure pass sau đó đã xử lý các blocker P0 trước UX: approval record, A3 validation plan, business rules, requirements baseline và readiness/traceability markers.

## Closure update

```text
PROJECT_OWNER_APPROVAL_RECORD_COMPLETED
VALIDATION_PLAN_A3_REMEDIATED
BUSINESS_RULES_PBAC_SEMANTICS_ALIGNED
REQUIREMENTS_BASELINE_ATTESTATION_RESIDUE_REMOVED_FROM_ACTIVE_ROWS
READINESS_AND_TRACEABILITY_MARKERS_CORRECTED
UX_ARTIFACT_REMOVED_FROM_ACTIVE_DOC_SET
UX_REBASE_PENDING_AFTER_DOC_PRUNING
CHROMADB_STRUCTURE_FIRST_VECTORLESS_LEGAL_RAG_APPROVED
POSTGRESQL_PGVECTOR_LEGAL_RETRIEVAL_SUPERSEDED
```

## Những phần đã đồng bộ tốt

- PBAC đã thay RBAC trong NFR, architecture, event/queue và phần lớn implementation/code maps.
- `FR-050` đã được định nghĩa lại thành Automatic Trusted Scan Initiation.
- `FR-051` đã được đánh dấu `REMOVED_FROM_PRODUCT`.
- Python Worker Platform đã được đặt làm owner của các asynchronous domain workloads.
- Scanner specs/toolchain cũ đã bị loại khỏi repository; active repository analysis dùng LangGraph + native Deep Agents harness + LCSP Docker sandbox và Codebase Memory tùy chọn.
- Trigger mapping states, domain objects, commands/events và negative paths đã được đưa vào nhiều tài liệu.
- Readiness report đã ghi đúng kết quả `NOT READY` vì thiếu UX, epics/stories và technical decisions.

## P0 findings and closure status

### P0-1 — Project Owner approval closed

Sprint Change Proposal hiện ghi approval cho documentation/planning remediation only. Marker cuối proposal là `CHANGE_PROPOSAL_APPROVED_FOR_DOCUMENTATION_AND_PLANNING_REMEDIATION_ONLY`.

Yêu cầu đóng:

- Không mở rộng approval sang code/test/CI/CD/Docker/deployment/UX/epics/stories/sprint execution.

### P0-2 — Validation Plan A3 closed

Nội dung validation A3 đã được merge vào active scope như PBAC and trusted-trigger abuse risk. Structured attestation chỉ còn `SUPERSEDED_FOR_ACTIVE_MVP` và không còn schema/claim/disclosure active.

Yêu cầu đóng:

- Giữ A3 focused vào PBAC, service identity, trigger mapping, idempotency, duplicate/out-of-order delivery và audit trace.

### P0-3 — Business Rules active semantics closed

Business Rules đã đổi active role semantics sang PBAC subject/policy evaluation và đưa attestation vào superseded register historical-only.

Yêu cầu đóng:

- Carry forward: dedicated ADRs và technical decisions vẫn cần trước stories/readiness.

### P0-4 — UC/AC/traceability P0 residue closed

- Requirements baseline đã chuyển `UC-M09-05` sang `SUPERSEDED_FOR_ACTIVE_MVP`.
- AC-9/11/12 đã đổi sang PBAC/trigger/evidence/audit semantics.
- Requirements traceability matrix hiện giữ `UX_REBASE_PENDING_AFTER_DOC_PRUNING` và `STORY_TRACEABILITY_PENDING`.

Yêu cầu đóng:

- Story coverage vẫn chưa assessable cho đến khi có canonical epics/stories.

### P0-5 — Readiness and authority markers revised after consolidation review

`docs/README.md`, traceability summary và traceability matrix hiện phải dùng remediation/in-progress markers thay vì synchronized/ready markers. UX cần được rebase hoặc tạo lại trên bộ tài liệu active đã rút gọn. Implementation readiness vẫn không được chứng nhận.

Yêu cầu đóng:

- Không dùng implementation readiness report như implementation approval.

## P1 cần carry forward trước stories/readiness

### ADR và technical decisions

Proposal yêu cầu dedicated ADRs cho PBAC, Automatic Trusted Scan Initiation, Python Worker Platform và LCSP Agent Runtime repository-analysis runtime, nhưng PR hiện chủ yếu sửa ADR index và các ADR runtime cũ.

Các decision sau có thể chưa cần chọn implementation cụ thể để bắt đầu UX, nhưng phải được ghi là constraint/dependency rõ:

- PBAC engine, storage, cache, invalidation, topology và failure behavior;
- trigger idempotency key, retry/DLQ, replay authority và recovery;
- repository-analysis failure/coverage và version/config policy;
- Python Worker Platform package/process/deployment boundary.

### Residual implementation wording

Backend, delivery plan và ADR relationship tables còn một số wording như role/grants, Developer Post-MVP hoặc downstream workers retained. Cần sửa trước khi tạo stories và chạy readiness lại.

## Checklist closure

```text
[x] Project Owner approval record completed
[x] validation-plan A3 remediated
[x] PRD attestation duplicate consequences removed
[x] business-rules active semantics converted to PBAC
[x] active UC/FR/AC/NFR crosswalk rebuilt for P0 baseline residue
[x] historical UC-018/FR-045/FR-046/AC-013 separated from active coverage
[x] docs/README and readiness markers corrected for pre-UX closure
[x] prior UX artifact removed from active documentation set
[x] legacy scanner runtime/toolchain removed; repository-analysis authority consolidated
[x] ChromaDB vectorless domain sync completed
[ ] UX rebased after authority-set pruning
[ ] dedicated ADRs added or explicit pre-story decision records created
[ ] backend/delivery/ADR residual wording closed
[x] repository-wide active-doc search returns no P0 structured-attestation validation residue
[x] consolidation review states UX_REBASE_PENDING_AFTER_DOC_PRUNING
```

## Trình tự hợp lệ

```text
1. Project Owner approves or revises Phase 5.2L proposal.
2. Run a short documentation closure pass for the P0 findings.
3. Revalidate all active documents and traceability.
4. Rebase or regenerate UX from the pruned active authority set.
5. Review and approve the rebased UX artifact.
6. Run bmad-create-epics-and-stories.
7. Resolve technical decisions and rebuild story traceability.
8. Re-run bmad-check-implementation-readiness.
```

## Final marker

```text
UX_ARTIFACT_REMOVED_FROM_ACTIVE_DOC_SET
UX_REBASE_PENDING_AFTER_DOC_PRUNING
```
