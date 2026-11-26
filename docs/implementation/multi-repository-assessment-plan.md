# Multi-repository Assessment: kế hoạch triển khai chi tiết (Hướng B)

> Mục tiêu: một Assessment ghim **một tập N repository snapshot** (immutable). Discovery chạy cho từng repo. Root agent hydrate cả N repo trong cùng một sandbox và suy luận xuyên repo. Evidence và decision mang toạ độ repo. Báo cáo trình bày theo hệ thống và theo từng repo.
>
> Trạng thái: đang triển khai (Phase 0-7 xong), các quyết định ở §2 đã chốt (xem ADR).

---

## Trạng thái triển khai

| Phase | Trạng thái |
|---|---|
| 0 Contracts nền, ADR | Xong. `repository-set.ts`, test vector dùng chung TS/Python |
| 1 Data model, backfill, dual-write | Xong. Migration `20261126090000_assessment_case_repository_set` |
| 2 API đọc/ghi theo tập pin | **Xong phần chặn N>1 (ghi, kiểm tra, runtime).** `loadPins` trả tập pin + digest; validator, completion gate, `accept-assessment-evidence` (resolve `repositoryKey`, commit và prefix theo từng repo; `evidenceId` có key khi N>1, giữ công thức cũ khi N=1), `accept-assessment-fact`, `open-human-request(+batch)`, `report-unresolvable-human-fact`, `request-assessment-finalization`, `get-root-context` (`repositories[]`, `repositorySetDigest`, `repositoryKey` trên evidence), checkpoint recovery (so `repository_set_digest` khi metadata có), rule-audit submit/retry/export/reuse (`pinnedRepositorySetMatches`: commit-only bị từ chối khi N>1), runtime-control resume (mọi pin), hydration-ticket reconcile (ticket thuộc tập pin), provenance loader, tracking (evidence hợp lệ nếu thuộc bất kỳ pin nào). **Còn để Phase 5-7:** freshness theo từng pin trong tracking SQL, loader detail/session-export/report (chỉ pin chính), report builder V2/V3 (V4 ở Phase 6), `resolveAssessmentFactNeedInTx` và discovery theo từng repo (Phase 5), siết `NOT NULL` (Phase 9: evidence HUMAN_ANSWER cố ý không gắn repo) |
| 3 Setup flow N repo (API và Web) | **Xong.** API: `pinRuntimeInputsInTx`/`prepareInTx` nhận `snapshotIds[]` (key duy nhất, mỗi snapshot một hydration ticket, một digest, kiểm tra bất biến trước khi đụng cột scalar); `complete` nhận danh sách snapshot tường minh (không có danh sách thì dùng snapshot mới nhất của connection ACTIVE); command `remove-assessment-repository` (`DELETE /assessments/:id/repository-setup/repositories/:snapshotId`, chỉ khi chưa pin); `pin-snapshot` từ chối khi tập đã pin; loader trả `repositories[]`, `repositoryLimit`, `setupCompleted`; giới hạn số repo lấy từ `LCSP_MAX_ASSESSMENT_REPOSITORIES` (chỉ hạ, tối đa 5). Web: chọn nhiều repo (form `react-hook-form` + `useFieldArray`, schema trong `schemas/`), danh sách repo + nút xoá, nút "Bắt đầu phân tích", tên assessment `{repo} +N`, BFF complete/DELETE, i18n vi/en, mock 2 repo. **Chưa có:** ô nhập `sourcePathPrefix` trên UI (API và client đã hỗ trợ, D2 chưa chọn được từ UI), kiểm tra ngân sách D5 (cần dung lượng archive, làm ở Phase 4), giới hạn từ capability policy (D7: hiện dùng biến môi trường) |
| 4 Worker hydrate N repo | **Xong phần chạy được (kiểm chứng offline).** Layout theo số repo: 1 repo giữ nguyên `/workspace/repository` (assessment đang chạy và checkpoint không đổi), nhiều repo dùng `/workspace/repositories/<key>/` với marker từng repo và manifest `repository-set.json` (khớp digest, bằng đúng test vector của TS). `hydrate_repository_set` chỉ xoá thư mục của repo đang hydrate; reuse theo marker từng repo. Docker: thêm mount `/workspace/repositories` (4096m, D5) và cho phép trong `_sandbox_path`. Codebase Memory: index **một project cho cả thư mục `/workspace/repositories`** (tên project đọc từ listing của engine theo đường dẫn, không đoán; stamp = marker của mọi repo), nên mọi path trong kết quả graph tự mang tiền tố `<key>/` và **4 graph tool giữ nguyên bề mặt model-facing** (không cần instruction revision cho phần này; plan ban đầu là project riêng từng repo kèm tham số `repository`, bị bỏ vì bộ test instruction-framework khoá mô tả tool). Scanner nhận `profile_path`/`discovery_path`/`graph_project`. `sandbox_backend_factory` hydrate + index + profile cho mọi repo. Root: `RootRun` giữ tập repo và digest (đổi giữa chừng thì fail), path `/<key>/...` được `_locate_source` kiểm theo commit/prefix của đúng repo, `cite_repository_source` gửi `repositoryKey` + commit của repo đó, `record_search_coverage` ghi **một coverage cho mỗi repo** từ trace (search ở root phủ mọi repo, graph query theo `repository`), `repository_set_digest` vào metadata checkpoint. Hướng dẫn cho model (path, `repository`, cite từng repo) đi qua `get_assessment_context` (`repositoryGuidance`) khi N>1 nên prompt hash-locked của N=1 không đổi. Kiểm chứng: 49 test offline mới (`test_multi_repository_worker.py`) và 2 e2e Docker thật (`tests/integration/test_multi_repository_docker_e2e.py`: hydrate 2 repo, git baseline, engine Codebase Memory thật, scanner qua `sandbox_backend_factory`). **Chưa làm:** instruction revision r6 và chạy `assessment-root-live-eval` (cần suy luận trả phí), discovery chỉ cho repo chính (API ràng buộc 1 discovery, xong ở Phase 5), kiểm tra dung lượng D5 lúc hydrate theo tổng, test với Docker sandbox thật + engine Codebase Memory thật |
| 5 Discovery theo từng repo | **Xong.** `AssessmentDiscoveryRunService.start` tạo N run (một cho mỗi pin) chung một `discoveryBatchId`, mỗi run một outbox. N=1 giữ nguyên idempotency key và digest cũ; N>1 dùng khoá `<key>#<repositoryKey>` và digest có `repositoryKey`+`repositorySetDigest`. `claim`/`complete`/`get`/`latest` so run với đúng pin của snapshot đó (`pinsForRepository`, `pinOfRun`); `latest` trả cả batch (primary đầu tiên). Artifact discovery **không đổi** (không thêm `repositoryKey` vào payload để không đổi chữ ký scanner/digest): repo của một record suy ra từ `repositorySnapshotId` của dòng DB, và Root gửi artifact theo toạ độ của chính nó (`repositoryId`+commit+prefix) nên API tự xếp đúng pin. Trang ranges/details/expansion theo `recordId` tự suy repo từ record; `GET /discovery?repositoryKey=` cho summary theo repo (mặc định repo chính). Interview, profile và FactNeed (provenance + evidence) kiểm theo pin của repo mà record thuộc về. Worker: Root quét và gửi discovery cho từng repo, tái dùng discovery đã có theo từng pin; `repositoryDiscoveries` theo key trong `get_assessment_context`; expansion chỉ chứa thao tác của repo mà record mô tả. Web: `start` trả batch, tiến độ từng repo, chọn repo để xem kết quả, gợi ý rule từ nhiều repo được cộng dồn. Kiểm chứng: unit API (run, discovery, interview, profile, FactNeed), 1 integration thật trên Postgres (start → claim → complete cho 2 repo, từ chối artifact của repo khác, `latest`, summary theo key), 2 e2e Docker thật (mỗi repo được scan và gửi một artifact), contracts và web. Còn thiếu: UI chưa gộp (union) ứng viên rule giữa các repo ở mức một danh sách, và chưa có chạy API → queue → worker thật với 2 repo (cần credential) |
| 6 Rule audit, completion, báo cáo V4 | **Xong.** Rule audit/request/export đã mang `repositorySetDigest` và `repositoryKey` từ Phase 2; completion gate trả `pins.repositories` + `repositorySetDigest` trong snapshot đóng băng. Báo cáo: **V4 chỉ dùng khi tập pin có từ 2 repo** (1 repo vẫn xuất V3, nội dung như cũ, nên không có thay đổi hành vi cho assessment hiện có). `v4-schemas.ts`: `identity.{repositorySetDigest,repositories[]}`, `pins.{repositorySetDigest,repositories[]}`, `sourceScopes[]` mỗi repo một khai báo phạm vi, `evidenceIndex[].repositoryKey`. Invariants không nhân đôi V3: phần lõi V3 được tách tham số `ReportRepositoryBinding` (dữ liệu: pin theo key, pin mặc định, commit cho HUMAN_ANSWER) nên cùng một bộ kiểm tra chạy cho V3 và V4; phạm vi nguồn kiểm riêng từng repo trên evidence của repo đó (issue được đổi path về `sourceScopes/<i>`). Builder: `buildAssessmentFinalReportParts` dùng chung (phạm vi, `platformScanSuccess` và coverage tính theo từng repo; evidence repo phải gắn key hợp lệ), `buildAssessmentFinalReportV4`; hạn chế của một repo kéo cả báo cáo xuống "limited". Handler chọn builder theo số repo, ghi `schemaVersion` V4, replay/loader kiểm digest (artifact + case) và `sourcePathPrefix` của từng snapshot (`final-report-repository-pins.ts`). Presentation: adapter V4 (header/traceability thêm `repositories[]`, evidence có `repositoryKey`), PDF V4 (bảng repo, nhãn key, banner phạm vi theo repo, traceability theo repo). Web: `V3Report` render cả V4 với `ReportRepositorySet`, banner theo repo, nhãn key trên evidence. Kiểm chứng: V3 builder spec không đổi (8 pass), 13 test V4 builder/invariants/presentation/HTML, handler (V4 publish + replay + 2 trường hợp từ chối), loader (3), gate, contracts, web. Còn thiếu: chưa có e2e render PDF thật bằng Chromium (môi trường thiếu Chromium), chưa chạy một assessment 2 repo thật qua model, evidence HUMAN_ANSWER mang commit repo chính với key null |
| 7 Web runtime, báo cáo, tracking | **Xong.** Rule audit: picker gửi `repositorySetDigest` của catalog (không có nó API từ chối audit N>1) và catalog phân trang phải khớp digest. Runtime: `repositoryPinViews` + molecule `RepositoryPinList` cho context panel, tin nhắn mở đầu liệt kê mọi repo (`openingRepositories`), conversation projection mang `repositories[]`. Provenance: contract `pins.{repositorySetDigest,repositories[]}` + loader trả tập pin theo thứ tự; view liệt kê từng repo (key, tên, commit, snapshot, prefix) và gắn badge repo trên evidence. Evidence viewer/`legal-rule-presentation` có `repositoryKey` badge. Báo cáo V4 render trong `V3Report` (Phase 6). Tracking: item thêm `repositories[]`; `repository` là repo chính còn `freshnessStatus`/`isStale` là tổng hợp (stale nếu có ít nhất một repo stale) ở cả ba nơi tính freshness (SQL `pinnedFreshnessSelect` dùng chung cho aggregate/obligation/filter, trang overview và chi tiết per-assessment, đều qua `judgePinnedRepositoryFreshness`); card hiện "+N repo" và danh sách từng repo trong phần chi tiết. Kiểm chứng: test web mới (7 + 3 + provenance đa repo), loader provenance (2), integration thật trên Postgres cho freshness đa repo (SQL aggregate, overview, bộ lọc `freshness`, 31/31 pass trong file parity). Còn thiếu: báo cáo `reports` list và các màn admin tracking vẫn chỉ hiển thị repo chính; session export mang tập pin qua `pins.repositories` (kế thừa provenance) nhưng khối `repository` vẫn là repo chính; chưa có fixture mock báo cáo V4 (không có màn mock nào dùng) |
| 8 E2E và vận hành | **Xong phần chạy được không cần LLM trả phí.** Vertical mới `tests/assessment-multi-repository-vertical.mjs` (API build thật + PostgreSQL thật + Root tools thật + model scripted, worker `deepagents/tests/vertical/scripted_root_multi_repository.py`): 2 repo (web toàn cây, api giới hạn `services/billing`) được pin thành một tập; Root cite evidence và ghi coverage theo từng repo; rule `ER-CONSENT` cite evidence của cả hai repo, `ER-RETENTION` chỉ cite repo api; báo cáo V4 được publish, tải về khớp hash, `pins.repositories`/`repositorySetDigest`/source scope đúng từng repo. Vertical bắt được **2 lỗi thật** mà unit test không thấy: (1) completion gate không `select` `repositorySetDigest` của decision nên mọi decision của assessment N>1 bị coi là `STALE_DECISION` (đã sửa + test hồi quy); (2) `RepositoryScopeContext` dùng constructor parameter property nên contracts không nạp được dưới Node strip-only (API build thật nạp contracts từ `.ts`) (đã sửa). Hạ tầng test: whitelist script mới trong `runPython` (admission fixture) và `pathToFileURL` cho import trên Windows. Observability: log `ASSESSMENT_REPOSITORY_HYDRATED` / `ASSESSMENT_REPOSITORY_HYDRATION_FAILED` theo `repository_key` (thời gian, reuse, số file, coverage). **Chưa chạy (cần môi trường/chi phí ngoài phạm vi máy này):** `assessment-root-live-eval.mjs` so N=1 với N=2 (suy luận trả phí), browser stack (cần Playwright + web server), tracking freshness trong vertical (đã có parity SQL integration 31/31). **Billing/capacity:** admission và reservation là theo từng Root run (một slot cho mọi `repositoryCount`); giới hạn model-call/token là cấu hình env theo workload, mặc định không giới hạn, nên N>1 không làm chạy sai; nếu vận hành đặt trần thì phải nâng trần cho N>1 sau khi đo bằng live eval. Chưa thêm hệ số theo `repositoryCount` vì chưa có số liệu đo. |
| 9 Dọn dẹp | **Chủ động chưa làm.** Vẫn còn reader của các cột scalar (khoảng 33 file API đọc `repositorySnapshotId`, 18 file đọc `repositoryScanJobId`, tracking loader ~93 chỗ) và worker N=1 cần context scalar cho assessment đang chạy khi deploy; drop cột là migration không thể hoàn tác nên chỉ làm sau khi N>1 chạy ổn ở staging và xác nhận hết reader. `graphify` không có trên máy này nên chưa cập nhật graph. |

**Trước khi nâng `LCSP_MAX_ASSESSMENT_REPOSITORIES` ở production:** chạy live eval N=1 và N=2, chạy browser stack, chạy lại vertical này trên staging. Cho tới lúc đó giữ giá trị `1`.

Kiểm chứng migration: `apps/api/test/scripts/verify-multi-repository-migrations.sh` (Postgres dùng-một-lần; seed dữ liệu legacy gồm assessment bị fence, rồi ma trận chấp nhận/từ chối cho tập hai repo và xoá cascade).

---

## 0. Hiện trạng: các chỗ đang giả định 1 repo

| Tầng | Điểm nghẽn chính |
|---|---|
| Prisma | `AssessmentCase.{repositorySnapshotId, repositoryScanJobId, repositoryCommit}` là scalar. `AssessmentEvidence` chỉ có `repositoryCommit`. `AssessmentRuleAuditRequest`, `AssessmentArtifact` và `AssessmentRuleDecision` (cột + JSON) mỗi bảng ghim một snapshot/commit. `AssessmentDiscoveryRun` và `AssessmentRepositoryDiscovery` thì đã ở mức từng repo. |
| API (điểm nghẽn trung tâm) | `assessment-case-support.service.ts` `loadPins` (73-138) và `buildValidationContext` (314+). Gần như mọi handler đi qua hai hàm này. |
| API: ghi pin | `assessment-runtime-preparation.service.ts` `pinRuntimeInputsInTx` (115-223). `complete-repository-setup.handler.ts` lấy connection và snapshot mới nhất bằng `findFirst`. |
| API: kiểm tra | `domain/decision-validator.ts` (130-138, 173). `accept-assessment-evidence` (75-138). `submit-rule-decision` (259). `assessment-completion-gate` (`snapshotPinsValid`, 437-460). |
| API: đọc và báo cáo | Các loader `detail`, `provenance`, `report`, `session-export`, `tracking` (SQL CTE join `repositoryCommit = case`, freshness tính theo một repo). Report builder v2/v3 và PDF HTML. |
| API: runtime | `get-root-context` (292-303). `assessment-runtime-authority` (`claimRoot`, `findFailedNativeCheckpoint`). `runtime-hydration-ticket-lifecycle` (`reconcileTerminalRuntime`, 293-309). `assessment-runtime-control.service.ts` (resume, 190-206). |
| Worker | `repository_sandbox.py` dùng hằng số cố định `REPOSITORY_ROOT=/workspace/repository`, mỗi lần hydrate **xoá toàn bộ root**, và chỉ có một marker. `codebase_memory.py` có một project `workspace-repository`, một stamp và một ContextVar. `repository_scanner.py` dùng một file profile và một file discovery cố định, `rangeId` không chứa repo. `tools.py`: `RootRun.pins` scalar, `cite_repository_source` không có repo, `_repository_view` đọc một marker. Prompt `assessment-root.system.txt:41` viết "ONE pinned snapshot". |
| Contracts | `assessmentRepositorySetupSchema.connection/snapshot/scanJob` là số ít. `assessmentRootContextSchema`, `decisionScopeShape`, `rule-audits.ts` (submit, catalog, view, export), report v2/v3 (`identity`, `pins` và các refine buộc chúng bằng nhau), `presentation-model.ts` và provenance `pins` đều dùng scalar. |
| Web | `repository-setup-step.tsx` (form một URL). `repository-analysis-client.ts` (chặn connection thứ 2 ở :58-60). Context panel, opening turn, report view, provenance view, rule-audit-picker, evidence viewer (không có repo) và tracking card. |

Những phần đã hỗ trợ nhiều repo, không cần sửa:
- `RepositoryConnection` và `RepositorySnapshot` cho phép nhiều bản ghi trên một assessment. `pin-snapshot.handler` không giới hạn số lượng.
- Tải archive được khoá theo cặp (snapshot, scanJob).
- `cacheIdentity` của discovery đã tính theo từng repo.
- `@@unique([installationId, repositoryId])` hiện không có tác dụng: code không ghi `installationId` khác null, nên không cản trở việc nối nhiều repo.

---

### Phát hiện khi làm Phase 1: trigger ở tầng DB (khảo sát code không thấy)

PostgreSQL đang **cưỡng chế bằng trigger** chính những bất biến mà plan định đổi. Phase 2 phải có một migration riêng viết lại các trigger này, nếu không thì N>1 sẽ bị DB từ chối dù code đã đúng.

| Trigger (hàm) | Ràng buộc hiện tại | Việc cần làm ở Phase 2 |
|---|---|---|
| `AssessmentCase_guard` (`lcsp_assessment_case_guard`) | Pin snapshot/commit/scanJob của case bất biến; scanJob phải thuộc đúng snapshot | Giữ cho pin ordinal 0 (đang mirror). Thêm kiểm tra tương đương cho `AssessmentCaseRepository` (bất biến, scanJob thuộc snapshot) |
| `AssessmentEvidence_guard` (`lcsp_assessment_evidence_guard`) | INSERT chỉ hợp lệ khi `repositoryCommit` = commit scalar của case; evidence ACCEPTED bất biến (so sánh danh sách cột cố định) | Viết lại: evidence hợp lệ khi `(assessmentId, repositoryKey, repositoryCommit)` thuộc `AssessmentCaseRepository`. Đây là chỗ **chặn evidence của repo thứ 2** |
| `AssessmentRuleDecision_guard` | INSERT chỉ hợp lệ khi commit = commit scalar của case | Viết lại theo `repositorySetDigest` của case |
| `AssessmentRuleAuditRequest_identity_guard`, `AssessmentArtifact_guard` | So sánh danh sách cột cố định (không gồm `repositorySetDigest`) | Thêm `repositorySetDigest` vào danh sách bất biến sau khi các writer đã ghi cột này |
| `AssessmentRepositoryDiscovery_immutable_guard`, `...Expansion_immutable_guard` | **Cấm mọi UPDATE** | Không backfill được. Vì vậy Phase 1 **không** thêm `repositoryKey` cho hai bảng này; repo của chúng suy ra từ `repositorySnapshotId` (duy nhất trong `AssessmentCaseRepository`) |
| `lcsp_execution_writer_fence` (Case, Evidence, Decision, AuditRequest, Artifact, ...) | Assessment đã "enroll" chỉ ghi được bởi `writerRole` riêng | Migration backfill tạm tắt fence trên đúng 5 bảng, bật lại trong cùng transaction (có tiền lệ `20261024150000_remove_semantic_auditor`) |

Các điều chỉnh so với thiết kế ở §1.2 do phát hiện này:
- Các cột set mới trên Evidence/Decision/AuditRequest/Artifact/DiscoveryRun là **nullable** ở Phase 1 (code cũ vẫn ghi được); siết `NOT NULL` ở Phase 2 khi mọi writer đã ghi.
- `AssessmentRepositoryDiscovery` và `...Expansion` không có cột `repositoryKey` (xem trên).
- FK từ pin sang `RepositorySnapshot` và từ Evidence sang pin dùng `ON DELETE NO ACTION` (kiểm tra cuối câu lệnh) để xoá dây chuyền từ Assessment không bị RESTRICT chặn.
- Evidence khác commit của case không thể tồn tại (DB từ chối khi INSERT), nên backfill `repositoryKey` cho evidence không có nhánh "lệch commit".

---

## 1. Thiết kế đích

### 1.1 Khái niệm

- **Repository pin**: bộ bất biến `{repositoryKey, ordinal, connectionId, repositoryId, repositoryFullName, snapshotId, scanJobId (hydration ticket), commit, sourcePathPrefix}`.
- **`repositoryKey`**: slug ngắn, ổn định và duy nhất trong assessment, dạng `^[a-z0-9][a-z0-9-]{0,39}$`, sinh từ tên repo và khử trùng lặp (`notice-service`, `notice-service-2`). Đây là toạ độ dùng chung giữa sandbox (thư mục), evidence, decision và UI.
- **Repository set**: tập pin đã sắp theo `ordinal`. Ký hiệu nhận diện là **`repositorySetDigest`** = sha256 của JSON canonical `[[key, snapshotId, commit.lower, prefix], …]`. Digest này thay thế cặp `(repositorySnapshotId, repositoryCommit)` ở mọi chỗ cần "chứng minh vẫn đúng tập pin" (rule-audit submit, decision scope, report identity, checkpoint metadata).
- **Tập pin bất biến sau khi ACTIVE**. Muốn thêm hoặc bớt repo thì tạo assessment mới. Lý do: mọi decision, evidence và coverage đều neo vào digest; nếu cho sửa tập pin thì phải invalidation toàn case, phức tạp hơn nhiều so với lợi ích.

### 1.2 Data model (Prisma)

```prisma
model AssessmentCaseRepository {
  assessmentId         String
  repositoryKey        String
  ordinal              Int
  connectionId         String
  repositoryId         String
  repositoryFullName   String
  repositorySnapshotId String
  repositoryScanJobId  String
  repositoryCommit     String
  sourcePathPrefix     String?
  pinnedAt             DateTime @default(now()) @db.Timestamptz(3)
  assessmentCase       AssessmentCase     @relation(fields: [assessmentId], references: [assessmentId], onDelete: Cascade, onUpdate: Restrict)
  snapshot             RepositorySnapshot @relation(fields: [repositorySnapshotId], references: [id], onDelete: Restrict)

  @@id([assessmentId, repositoryKey])
  @@unique([assessmentId, ordinal])
  @@unique([assessmentId, repositorySnapshotId])
  @@unique([assessmentId, repositoryKey, repositoryCommit]) // đích của composite FK từ evidence
}
```

- `AssessmentCase`: thêm `repositorySetDigest String?` và `repositoryCount Int @default(0)`. Các cột scalar cũ giữ lại ở Phase 1 (mirror cho pin `ordinal=0`) rồi **drop ở Phase 9**.
- `AssessmentEvidence`: thêm `repositoryKey String` (backfill từ pin ordinal 0) và composite FK `(assessmentId, repositoryKey, repositoryCommit)` → `AssessmentCaseRepository`. Index `[assessmentId, repositoryKey, state]`.
- `AssessmentRuleDecision`: thêm `repositorySetDigest String`. Cột `repositoryCommit` cũ bỏ ở Phase 9.
- `AssessmentRuleAuditRequest`: thêm `repositorySetDigest`. Bỏ `repositorySnapshotId/Commit` ở Phase 9.
- `AssessmentArtifact`: thêm `repositorySetDigest`.
- `AssessmentDiscoveryRun` và `AssessmentRepositoryDiscovery`: thêm `repositoryKey`. Đổi index thành `[assessmentId, repositoryKey, createdAt desc]`. Thêm `discoveryBatchId String? @db.Uuid` để một lần "Run discovery" tạo N run cho N repo.
- `AssessmentRepositoryDiscoveryExpansion`: thêm `repositoryKey`.
- Không dùng enum mới cho repositoryKey (đây là giá trị mở). Mọi status hay reason mới phải là Prisma enum `SCREAMING_SNAKE_CASE` và có hằng số tương ứng trong `packages/contracts`.

**Migration backfill** (chung một migration với phần tạo bảng):
1. Với mỗi `AssessmentCase` có đủ 3 cột pin, insert một dòng `AssessmentCaseRepository` với `ordinal=0`. `repositoryKey` sinh từ `RepositorySnapshot.repositoryFullName`. `connectionId` và `repositoryId` lấy từ snapshot.
2. Tính `repositorySetDigest`, đặt `repositoryCount=1`.
3. Backfill `repositoryKey` cho evidence, discovery run, discovery và expansion. Backfill `repositorySetDigest` cho decision, audit request và artifact.
4. Thêm script kiểm tra parity (giống `assessment-tracking-sql-parity`): mọi dòng con phải resolve được về một pin.

Hàm sinh digest đặt ở `packages/contracts` (`computeRepositorySetDigest`) để API, Web và migration dùng chung. Phía Python sinh lại theo cùng thuật toán, có test vector chung.

### 1.3 Contracts (`packages/contracts`)

- **Mới**, file `assessment-domain/repository-set.ts`:
  - `repositoryPinSchema`, `repositorySetSchema`, `computeRepositorySetDigest`, `deriveRepositoryKey`.
  - `ASSESSMENT_REPOSITORY_LIMITS = { maxRepositories: 5 } as const` (hoặc đọc từ capability policy, xem §2).
  - Error codes mới:
    - `REPOSITORY_SET_LIMIT_EXCEEDED`
    - `REPOSITORY_SET_DUPLICATE`
    - `REPOSITORY_SET_IMMUTABLE`
    - `REPOSITORY_KEY_UNKNOWN`
    - `REPOSITORY_SET_DIGEST_STALE`
- **`assessmentRepositorySetupSchema`**: đổi thành `{ repositories: Array<{ connection, snapshot | null, scanJob | null }>, setupCompleted }`. Thêm schema riêng cho request và response của connect và remove.
- **`completeAssessmentRepositorySetupResultSchema`**: `{ assessment_id, repository_set_digest, repositories: [{ repository_key, connection_id, snapshot_id, commit_sha }] }`.
- **`assessmentRootContextSchema`**: thay 5 field scalar bằng `repositories: repositoryPinSchema[]` và `repositorySetDigest`.
- **Evidence request**: `REPOSITORY_SOURCE` và `SEARCH_COVERAGE` thêm `repositoryKey`, giữ `repositoryCommit` để kiểm tra chéo. Với `SEARCH_COVERAGE`, mỗi `scope` mang `repositoryKey`. Một coverage cũng có thể gắn với cả tập: `repositoryKey: null` kèm `scopes[].repositoryKey`.
- **`decisionScopeShape`** (`assessment/agentic-runtime.ts:682-683`): thay `repositorySnapshotId/repositoryCommit` bằng `repositorySetDigest`. Blocker `REPOSITORY_SNAPSHOT_UNAVAILABLE` thêm `repositoryKey`.
- **`rule-audits.ts`**: `submitRuleAuditSchema`, catalog, view và export dùng `repositorySetDigest` cùng danh sách `repositories` (chỉ để hiển thị).
- **Discovery** (`repository-discovery.ts`): `repositoryDiscoverySchema` thêm `repositoryKey`. `sourceRange.rangeId` phải gắn với repo (băm thêm `repositoryKey`). `assessmentDiscoveryRunViewSchema` và `ClaimSchema` thêm `repositoryKey`. Thêm `assessmentDiscoveryBatchViewSchema`.
- **Report**: thêm **V4** (`assessment-report/v4-schemas.ts`):
  - `identity.repositorySetDigest`, `pins.repositories[]`.
  - Evidence index mang `repositoryKey`.
  - Kiểm tra `sourceScope` theo từng repo.
  - V2 và V3 giữ nguyên để đọc các artifact cũ. `presentation-model.ts` thêm adapter V4, và adapter V2/V3 trả về `repositories` có một phần tử để UI dùng một model chung.
- **Tracking**: `customerTrackingAssessmentItemSchema.repository` đổi thành `repositories[]`, kèm `freshnessStatus` tổng hợp ("stale nếu có ít nhất một repo stale").
- **Events**: thêm `ASSESSMENT_REPOSITORY_ADDED` và `ASSESSMENT_REPOSITORY_REMOVED` (chỉ phát được khi đang PREPARING). Giữ `REPOSITORY_SETUP_COMPLETED` với payload mới.

---

## 2. Các quyết định cần chốt trước khi code

| # | Câu hỏi | Đề xuất mặc định |
|---|---|---|
| D1 | Số repo tối đa | 5. Lấy từ capability policy (LCSP-368) nếu đã có khung, nếu không thì hằng số trong contracts. |
| D2 | Có cho cùng một repo xuất hiện 2 lần với 2 `sourcePathPrefix` khác nhau (trường hợp monorepo)? | **Có**. Key khử trùng lặp, unique theo (snapshot), không theo repositoryId. |
| D3 | Có cho thêm hoặc bớt repo sau khi ACTIVE? | **Không**. Tập pin bất biến. |
| D4 | Discovery chạy tuần tự hay song song trong một sandbox? | Một sandbox cho mỗi run, mỗi run một repo, các run chạy song song và chịu giới hạn của Root capacity. |
| D5 | Ngân sách hydrate (dung lượng, số file) | Tổng ≤ giới hạn hiện tại × 2, kiểm tra từ lúc pin. Vượt thì báo `REPOSITORY_SET_LIMIT_EXCEEDED`. |
| D6 | Phiên bản báo cáo | Thêm V4. V2 và V3 chỉ còn dùng để đọc. |
| D7 | Feature gate | Capability `MULTI_REPOSITORY_ASSESSMENT`. Khi tắt, UI giới hạn N=1, còn backend vẫn chạy trên model mới. |

---

## 3. Lộ trình theo phase

Nguyên tắc: **Phase 1-2 chuyển toàn bộ hệ thống sang model "tập pin" nhưng N vẫn bằng 1**, hành vi không đổi và test hiện có vẫn phải xanh. Từ Phase 3 mới mở N>1. Mỗi phase là một PR riêng, merge được độc lập.

### Phase 0: ADR và contracts nền
- [ ] `docs/adr/LCSP-xxx-multi-repository-assessment.md`: ghi lại các quyết định ở §1 và §2.
- [ ] `packages/contracts/src/assessment-domain/repository-set.ts` cùng test (`packages/contracts/test/repository-set.spec.ts`): digest ổn định với test vector, key derivation, giới hạn.
- [ ] Test vector JSON dùng chung, đặt ở `packages/contracts/test/fixtures/repository-set-digest.json`. Python cũng đọc file này.

### Phase 1: Data model và backfill (N=1, không đổi hành vi)
- [ ] Prisma: tạo model `AssessmentCaseRepository` và thêm các cột ở §1.2.
- [ ] Migration `2026xxxx_assessment_case_repository_set`, gồm cả backfill.
- [ ] `pinRuntimeInputsInTx`: ghi **đồng thời** dòng pin và các cột scalar cũ (dual-write).
- [ ] Integration test cho backfill và parity: `apps/api/test/assessment-repository-set-backfill.integration.spec.ts`.
- [ ] Chạy `pnpm run check:business-logic-docs` (cần JSDoc 5 mục cho mọi hàm đổi semantic).

### Phase 2: API đọc theo tập pin (N=1)
Abstraction trung tâm là **`PinnedRepositorySet`**, thay thế `PinnedCase` scalar.
- [ ] `assessment-case-support.service.ts`:
  - `loadPins` trả về `{ ruleSetVersionId, repositorySetDigest, repositories: PinnedRepository[] }` và kiểm tra từng snapshot (READY, commit khớp, prefix khớp).
  - `buildValidationContext` lọc evidence theo `(repositoryKey, commit) ∈ set`.
- [ ] `domain/decision-validator.ts`:
  - `REPOSITORY_PIN_MISMATCH` khi `decision.repositorySetDigest ≠ pins.digest`.
  - `EVIDENCE_PIN_MISMATCH` khi `(evidence.repositoryKey, commit) ∉ set`.
- [ ] `accept-assessment-evidence.handler`:
  - Resolve `repositoryKey`. Bắt buộc từ Phase 4; trong giai đoạn N=1 nếu thiếu thì mặc định lấy pin duy nhất.
  - Kiểm tra path theo **prefix của repo đó**.
  - `evidenceId = uuid(assessmentId|repositoryKey|commit|identity)`. Lưu ý: ID của evidence mới thay đổi; evidence cũ giữ nguyên ID.
- [ ] Các command còn lại chuyển sang dùng digest hoặc set: `accept-assessment-fact`, `answer-human-request`, `submit-rule-decision`, `report-unresolvable-human-fact`, `request-assessment-finalization`, `open-human-request(+batch)`.
- [ ] `assessment-fact-need.ts`: `validateFactNeedDiscoveryProvenanceInTx` và `resolveAssessmentFactNeedInTx` kiểm tra provenance theo từng repo.
- [ ] `assessment-completion-gate.service.ts`: `snapshotPinsValid` lặp qua từng pin. Blocker reference chứa `repositoryKey`. Kiểm tra evidence/decision theo set.
- [ ] `assessment-rule-audit.service.ts`:
  - `catalog` trả về `repositorySetDigest` và `repositories`.
  - `submit`, `retry`, `createExport` so sánh theo digest.
  - Decision reuse ở dòng 543 chuyển sang so digest.
- [ ] Runtime:
  - `get-root-context`: thêm `repositories[]` và `repositorySetDigest`. Giai đoạn chuyển tiếp vẫn gửi kèm các field scalar khi N=1, để worker cũ chạy được.
  - `assessment-runtime-authority`: `claimRoot` và `findFailedNativeCheckpoint` so `repository_set_digest` trong metadata checkpoint. Checkpoint cũ không có digest thì so theo scalar.
  - `runtime-hydration-ticket-lifecycle.reconcileTerminalRuntime`: ticket phải thuộc tập pin.
  - `assessment-runtime-control.service.ts` (resume): kiểm tra mọi pin.
- [ ] Loaders:
  - `detail`: trả về `case.repositories[]`.
  - `provenance`: `pins.repositories[]`, evidence có `repositoryKey`.
  - `report`: kiểm tra identity V4 hoặc set.
  - `session-export`: xuất `repositories[]`.
  - `repository-setup.loader`: xem Phase 3.
- [ ] `assessment-tracking.loader.ts` (rủi ro cao nhất, toàn SQL):
  - CTE `ownerCanonicalDecisionEvaluationCte` join theo `repositorySetDigest`.
  - Join evidence qua `AssessmentCaseRepository`.
  - `ownerScopedFreshnessCte` tính freshness **cho từng pin**, rồi lấy kết quả xấu nhất làm trạng thái tổng.
  - Điều kiện "pins complete" đổi thành `repositoryCount > 0 AND digest NOT NULL`.
  - Cập nhật `apps/api/test/assessment-tracking-sql-parity.integration.spec.ts`.
- [ ] Toàn bộ spec của các file trên phải xanh với N=1.

### Phase 3: Setup flow N repo (API và Web)
API:
- [ ] `connect-assessment-repository.handler`:
  - Cho nhiều connection trên một assessment ở trạng thái PREPARING.
  - Từ chối trùng (cùng repositoryId và prefix) và vượt giới hạn (D1).
  - `connect-github-cli-repository.handler` sửa tương tự.
- [ ] **Command mới `remove-assessment-repository`**: chỉ chạy khi PREPARING. Revoke liên kết giữa connection và assessment, đánh dấu snapshot chưa pin là không dùng. Phát audit event `ASSESSMENT_REPOSITORY_REMOVED`.
- [ ] `pin-snapshot.handler`: thêm guard lifecycle PREPARING. Mỗi connection có tối đa một snapshot "ứng viên" (snapshot mới thay thế snapshot cũ chưa pin).
- [ ] `complete-repository-setup.handler`:
  - Thu thập **mọi** connection ACTIVE cùng snapshot READY mới nhất của từng connection. Thiếu bất kỳ repo nào thì báo `repositorySetupIncomplete`, kèm `meta.missingRepositoryKeys`.
  - Gọi `prepareInTx({ snapshotIds[] })`.
  - Audit payload chứa danh sách.
- [ ] `assessment-runtime-preparation.service.ts`:
  - `pinRuntimeInputsInTx` nhận danh sách và gán key + ordinal.
  - Tạo một hydration ticket cho mỗi snapshot (giữ key `runtime-hydration:{assessmentId}:{snapshotId}`).
  - Insert các dòng `AssessmentCaseRepository`, tính digest.
  - Gặp `REPOSITORY_SET_IMMUTABLE` khi đã có tập khác thì từ chối.
  - Kiểm tra ngân sách D5.
- [ ] `assessment-repository-setup.loader`: trả về `repositories[]`.

Web (`apps/web/src/features/assessment-flow`):
- [ ] `schemas/repository-setup.schema.ts`:
  - `{ repositories: z.array(z.object({ provider, repositoryUrl, sourcePathPrefix?: string })).min(1).max(limit) }`.
  - `superRefine` báo lỗi khi URL và prefix trùng nhau.
- [ ] `config/`: hằng số giới hạn lấy từ contracts.
- [ ] Molecules mới trong `components/molecules/`:
  - `repository-entry-row.tsx`: dùng `useFormContext` và `Controller`; gồm provider, URL, prefix, nút xoá và badge trạng thái.
  - `repository-setup-status-badge.tsx`
- [ ] Organisms trong `components/organisms/`:
  - Tách `repository-setup-step.tsx` (493 dòng) thành container (orchestrate submit và resume) cộng `repository-setup-list.tsx` (dùng `useFieldArray`).
  - `repository-setup-conversation.tsx` hiển thị danh sách câu trả lời.
- [ ] `utils/repository-setup-history.ts` nhận mảng.
- [ ] `types/`: `RepositorySetupAnswer[]`, `RepositoryHistory[]`.
- [ ] `lib/api/repository-analysis-client.ts`:
  - Bỏ guard `connectionAlreadyExists` ở :58-60.
  - `resumeRepositoryAnalysis` lặp qua từng repo (connect, rồi pin nếu chưa có snapshot) với khả năng thất bại cục bộ, sau cùng gọi `complete` một lần.
  - Thêm `removeAssessmentRepository`.
  - Cập nhật in-flight key.
- [ ] `lib/api/assessment-domain-queries.ts`: mutation remove và invalidate các query liên quan.
- [ ] BFF:
  - `repository-connection/route.ts`: validate body bằng schema contract (thêm `sourcePathPrefix?`).
  - Route mới `repository-connection/[connectionId]/route.ts` (DELETE).
  - `snapshots/route.ts`: validate request và response.
  - Mọi route dùng helper chung (`upstream-request`, `assessment-domain-proxy`).
- [ ] Tên assessment: sinh từ repo đầu tiên kèm "+N" qua key i18n (`assessmentNameFromUrl` được thay bằng một util có i18n).
- [ ] i18n (`@lcsp/i18n`): key cho nút thêm/xoá repo, lỗi trùng, lỗi vượt giới hạn, trạng thái từng repo và tên assessment nhiều repo.
- [ ] Mocks (`apps/web/src/public/assets/mocks/enterprise-legal-compliance-workspace.json`): `repositorySetup.repositories[]` gồm 2 repo.

### Phase 4: Worker hydrate N repo
Sandbox layout mới:
```
/workspace/repositories/<repositoryKey>/        ← mã nguồn (read-only với agent)
/workspace/repositories/<repositoryKey>/.lcsp/repository.json   ← marker từng repo
/workspace/repositories/.lcsp/repository-set.json              ← manifest {digest, repositories[]}
/workspace/runtime/<repositoryKey>/repository_profile.json | repository_discovery.json
/workspace/runtime/codebase-memory/<repositoryKey>/lcsp-index-stamp.json
```
Agent thấy `/` = `/workspace/repositories`, nên mọi path có dạng `/<repositoryKey>/src/...`. Toạ độ repo vì vậy nằm sẵn trong path; tool vẫn gửi `repositoryKey` tường minh để API kiểm tra.

- [ ] `repository_sandbox.py`:
  - Thay hằng `REPOSITORY_ROOT` bằng `REPOSITORIES_ROOT` cộng `repository_root(key)`.
  - Thêm `hydrate_repository_set(backend, pins[], digest, ...)`: hydrate tuần tự từng pin. **Chỉ xoá thư mục của key đó**. `_ARCHIVE_PATH` tách theo key.
  - Reuse theo marker của từng repo; manifest phải khớp digest.
  - Giữ `hydrate_repository` làm wrapper cho N=1 (chỉ trong giai đoạn chuyển tiếp).
  - Sửa `_real_path`/`_virtual_path`, `execute` (`cd`) và vùng ghi `.lcsp/agent` (chuyển lên `/workspace/repositories/.lcsp/agent`).
- [ ] `docker_sandbox.py`: workdir `/workspace/repositories`, cập nhật allowlist root ở :245 và giới hạn dung lượng.
- [ ] `subject_repository_tools.py`: dùng `SUBJECT_REPOSITORY_ROOT` mới.
- [ ] `codebase_memory.py`:
  - Một project cho mỗi repo: `workspace-repository-<key>` (fixture isolation test đã có sẵn tiền lệ `-alpha/-beta`).
  - `_ACTIVE_INDEX` chuyển thành map key → identity.
  - `graph_index_version` lấy theo từng repo.
- [ ] `codebase_memory_graph/code.py`: mọi graph tool nhận tham số bắt buộc `repository` (key) khi N>1, kiểm tra key thuộc manifest. Output prefix path bằng `/<key>/`.
- [ ] `repository_scanner.py`:
  - Đường dẫn profile và discovery tách theo key.
  - `rangeId` băm thêm `repository_key`.
  - Payload thêm `repositoryKey`.
  - `cacheIdentity` giữ nguyên công thức (vốn đã theo repo).
- [ ] `assessment_root/boundary.py` `sandbox_backend_factory`:
  - Đọc `context["repositories"]` và gọi `hydrate_repository_set`.
  - Với từng repo: `ensure_codebase_memory_index`, `ensure_repository_profile`, rồi kiểm tra discovery đã có (lookup theo key) hoặc `ensure_repository_discovery`.
  - `discovery_sink` nhận `repositoryKey`.
- [ ] `assessment_root/tools.py`:
  - `RootRun.pins` → `{ruleSetVersionId, repositorySetDigest, repositories{key→pin}}`.
  - `adopt_context` kiểm tra digest không đổi trong suốt run.
  - `_repo_path` và `_source_evidence_path` tách `/<key>/rest`, kiểm tra prefix của repo đó.
  - `cite_repository_source` gửi `repositoryKey` + `repositoryCommit` của key đó.
  - `record_search_coverage`: mỗi scope có `repositoryKey`.
  - `submit_rule_decision` gửi `repositorySetDigest`.
  - `_repository_view` đọc manifest cùng marker từng repo.
  - `_context_snapshot` và `_coverage_snapshot` băm theo digest.
  - `record_repository_discovery_expansion` mang key.
- [ ] `assessment_root/client.py`: `repository_discovery_summary(key)`; các endpoint ranges và details nhận `repositoryKey`.
- [ ] `runner.py`: metadata checkpoint `repository_set_digest` (và bỏ dần `repository_snapshot_id/commit`).
- [ ] `runtime_control.py` và `scripts/run_resume_turn.py`: đọc context mới.
- [ ] Prompt và guidance (bản en và vi):
  - `instructions/candidates/r1/assessment-root.system.txt:41`: thay "ONE pinned snapshot" bằng mô tả tập repo, quy ước path `/<key>/…`, và yêu cầu khi kết luận xuyên repo phải cite evidence từ từng repo liên quan.
  - `assessment-tool.cite_repository_source.guidance.txt`, `assessment-tool.get_repository_architecture.guidance.txt`, `tool_contracts.py` (8-17, 85-86, 161-163) và `CODEBASE_MEMORY_GRAPH_GUIDANCE`.
  - Subagent `repository-researcher` (`researcher.py`): prompt biết về manifest; deny ghi `/.lcsp/**` theo layout mới.
  - Tạo instruction revision mới (r6) theo quy trình revisions hiện có và chạy eval (`tests/assessment-root-live-eval.mjs`).
- [ ] Docstring 5 mục cho mọi hàm Python bị đổi.
- [ ] Tests:
  - Cập nhật các test đã liệt kê ở báo cáo khảo sát: `test_repository_sandbox.py`, `test_repository_hydration_coverage.py`, `test_codebase_memory_index.py`, `test_repository_scanner.py`, `test_assessment_root_agent.py`, `test_assessment_discovery_boundary.py`, `test_docker_sandbox.py`, `test_assessment_context_paging.py`, `test_assessment_concurrency.py`, `test_run_manifest.py`, `test_runtime_capability_layout.py`, cùng các test integration và vertical.
  - Test mới `test_repository_set_hydration.py`: hydrate 2 repo; re-hydrate một repo không xoá repo kia; key lạ bị từ chối; path traversal giữa các repo bị chặn.

### Phase 5: Discovery theo từng repo
- [x] `assessment-discovery-run.service.ts`:
  - `start` tạo **N run** (một cho mỗi pin) chung một `discoveryBatchId`. Idempotency theo `(batchKey, repositoryKey)`. Mỗi run gửi một outbox riêng.
  - `latest` trả về view theo batch (danh sách run).
  - `claim`, `complete`, `get` so run với **pin của key đó**.
  - `claimCoordinates` thêm `repositoryKey`.
- [x] `assessment-repository-discovery.service.ts`:
  - `currentPinWhere(key)`; `assertArtifactPins` và `parseVerifiedRow` theo key.
  - Các endpoint ranges và details nhận `repositoryKey`.
- [x] `assessment-repository-profile.service.ts`: một profile cho mỗi repo (`getProfileInTx(key)`).
- [x] `assessment-discovery-interview.service.ts`: proposal và evidence HUMAN_ANSWER. Evidence loại human không gắn repo thì `repositoryKey` = null. Cần quyết định có cho phép null hay không; đề xuất là thêm evidence type không gắn repo, kiểm tra theo digest.
- [x] `deepagents/assessment_root/discovery_boundary.py`: claim trả về một pin, hydrate đúng repo đó (sandbox của discovery chỉ cần 1 repo).
- [x] Controller `assessment-repository-discovery.controller.ts`: tham số query `repositoryKey`.
- [x] Web: `assessment-discovery-queries.ts` và BFF `discovery-runs/*` trả về batch view; UI hiển thị tiến độ từng repo.

> Ghi chú triển khai: không đổi `repositoryDiscoverySchema` và `sourceRange.rangeId` (xem trạng thái Phase 5); `assessment-repository-profile.service.ts` chưa có đường gọi sản xuất nên chỉ được làm theo pin của repo (lưu theo toạ độ profile, đọc theo `repositoryKey`); evidence HUMAN_ANSWER của interview giữ commit repo chính với `repositoryKey` null (DB chấp nhận); controller discovery nhận `repositoryKey` ở summary vì các trang khác đã gắn với `recordId`.

### Phase 6: Rule audit, completion và báo cáo V4
- [x] `assessment-rule-audit.service.ts`: request lưu `repositorySetDigest`; export chứa `repositories[]`; evidence trong export có `repositoryKey`.
- [x] `assessment-completion-gate.service.ts`: `sourcePathPrefix` (dòng 570) chuyển thành map theo key. Trả về `pins` dạng set.
- [x] `submit-assessment-final-report.handler.ts`: replay check theo digest. Re-read prefix từng repo. Artifact ghi `repositorySetDigest`.
- [x] Builder mới `assessment-final-report-v4.builder.ts`:
  - Phần header tóm tắt hệ thống (danh sách repo, commit, prefix).
  - Evidence index nhóm theo repo.
  - `scopeTraceability` theo từng repo.
  - Coverage tìm kiếm theo từng repo.
  - V2 và V3 builder đóng băng, chỉ phục vụ artifact cũ.
- [x] `infrastructure/report/assessment-report-v4-pdf-html.ts`: bảng repository set và nhãn `repositoryKey` trên từng evidence.
- [x] `assessment-report.loader.ts`: phân nhánh V2/V3/V4.

### Phase 7: Web runtime, báo cáo và tracking
- [x] `assessment-context-panel.tsx`: danh sách repo (molecule mới `repository-pin-list.tsx` trong `features/assessment-runtime/components/molecules`), mỗi dòng gồm `fullName@commit` và prefix.
- [x] `use-assessment-conversation.ts`, `conversation-projection.ts`, `conversation.types.ts` và `conversation-opening-turn.tsx`: chuyển sang `repositories[]`.
- [x] `rule-audit-picker.tsx`: submit `repositorySetDigest`.
- [x] `evidence-relationship-viewer.tsx` và `legal-rule-presentation.ts`: hiển thị badge `repositoryKey` trước path, và nhóm evidence theo repo.
- [x] `assessment-report-view.tsx`: render V4 (section repository set; traceability theo repo); V2/V3 dùng adapter.
- [x] `assessment-provenance-view.tsx`: bảng pin; evidence có cột repo.
- [x] `tracking/.../assessment-tracking-card.tsx`: hiển thị repo đầu tiên kèm "+N" và tooltip/danh sách; freshness tổng hợp.
- [x] Mocks: cập nhật mọi file `selected-rule-audit-*.json`, `localized-assessment-*.json`, `reviewed-report-browser.json`, `rule-grouping-review.json`, `customer-tracking.json`. Thêm một fixture V4 có 2 repo.
- [x] i18n cho mọi nhãn mới. Rà các class `-[` theo chính sách Tailwind v4.3.

### Phase 8: Kiểm thử end-to-end và vận hành
- [x] Vertical test mới `tests/assessment-multi-repository-vertical.mjs`, gồm 2 repo:
  - repo A: frontend thu consent;
  - repo B: backend lưu và xoá dữ liệu.
  - Một rule chỉ đạt khi có evidence từ cả hai repo.
  - Assert: decision cite evidence của 2 key, report V4 đúng, tracking đúng freshness.
- [ ] Browser stack (`tests/assessment-browser-stack.mjs`): setup với 2 repo, xoá 1 repo khi đang PREPARING, resume sau khi reload.
- [ ] Chạy lại `tests/assessment-root-live-eval.mjs` và so chất lượng giữa N=1 và N=2 (rà xem có regression ở case đơn repo không).
- [x] Billing và capacity (đã rà: theo Root run, không cần hệ số khi chưa có số đo; xem bảng trạng thái): ước tính token tăng theo N; kiểm tra `BillingReservation` và admission cho Root lớn hơn; có thể cần hệ số reservation theo `repositoryCount`.
- [x] Observability: log hydrate theo key (log có cấu trúc; chưa có metric riêng) (thời gian, dung lượng, lỗi).

### Phase 9: Dọn dẹp
- [ ] Bỏ dual-write; drop các cột scalar `AssessmentCase.repositorySnapshotId/ScanJobId/Commit`, `AssessmentRuleAuditRequest.repositorySnapshotId/Commit` và `AssessmentRuleDecision.repositoryCommit` (sau khi xác nhận không còn reader).
- [ ] Bỏ field scalar khỏi `assessmentRootContextSchema` và bỏ wrapper `hydrate_repository` N=1.
- [ ] Bỏ đường so checkpoint cũ khi không còn run in-flight nào dùng metadata scalar.
- [ ] `graphify update .`

---

## 4. Rủi ro và cách giảm

| Rủi ro | Giảm thiểu |
|---|---|
| SQL tracking (khoảng 3.5k dòng) sai khi đổi join | Phase 2 giữ N=1 và có parity test SQL so với dữ liệu thật đã backfill. |
| Run đang chạy dở lúc deploy (checkpoint metadata scalar) | Authority chấp nhận cả hai dạng metadata trong giai đoạn chuyển tiếp. Context gửi cả dạng scalar khi N=1. |
| Sandbox quá tải dung lượng hoặc thời gian index khi N lớn | Giới hạn D1 và D5, index tuần tự và reuse stamp theo từng repo. |
| LLM nhầm repo khi cite, hoặc kết luận xuyên repo thiếu căn cứ | Path bắt buộc có tiền tố `/<key>/`; API kiểm tra key, commit và prefix; prompt yêu cầu cite từng repo; có eval riêng cho kịch bản xuyên repo. |
| `evidenceId` mới khác công thức cũ | Chỉ áp dụng cho evidence mới. Evidence cũ đã backfill `repositoryKey` và giữ nguyên ID. |
| Artifact báo cáo cũ | V2/V3 chỉ còn đọc; adapter đưa về model chung. |
| Quy định tài liệu business-logic | Mọi handler hoặc service đổi semantic phải cập nhật JSDoc/docstring 5 mục. Không regenerate baseline. |

## 5. Ước lượng thô

| Phase | Khối lượng |
|---|---|
| 0-1 | S-M |
| 2 | **L** (khoảng 30 file API cùng spec, SQL tracking) |
| 3 | M-L (API cộng UI setup) |
| 4 | **L** (sandbox, index, tools, prompt, eval) |
| 5 | M |
| 6 | M-L (report V4) |
| 7 | M |
| 8 | M |
| 9 | S |

Đường găng: 0 → 1 → 2 → (3 ∥ 4) → 5 → 6 → 7 → 8 → 9. Phase 3 (setup) và Phase 4 (worker) chạy song song được sau khi Phase 2 merge.
