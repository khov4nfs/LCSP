# BÁO CÁO ĐÁNH GIÁ TÀI LIỆU USE CASE & THỰC THI HỆ THỐNG
## Module: M03 — REPOSITORY SCAN & TECHNICAL EVIDENCE
*(Đối chiếu trực tiếp giữa Tài liệu UC M03, Module M02 Assessment Setup và Hiện trạng Codebase)*

**Hệ thống:** LCSP (Legal Compliance Software Platform)  
**Tài liệu đánh giá:** [Business Use Case Specification · M03](https://docs.google.com/document/d/1lRlXre0lzsCljufEHTvIZoRFeJG8JJ-LbIxqZHuiDlc/edit?tab=t.0)  
**Ngày đánh giá & Cập nhật:** 04/10/2026  
**Trạng thái Code:** **ĐÃ SỬA VÀ KIỂM THỬ HOÀN TẤT (VERIFIED)**

---

## 1. TỔNG QUAN ĐÁNH GIÁ

Tài liệu đặc tả Use Case **M03 — REPOSITORY SCAN & TECHNICAL EVIDENCE** đã định hướng đúng các nguyên tắc nghiệp vụ cốt lõi:
- Kích hoạt lần quét đầu tiên tự động sau khi hoàn tất thiết lập tại **M02 (Assessment Setup & Repository Connection)**.
- Quản lý và theo dõi tiến trình quét dựa trên trạng thái/checkpoint thực tế (không dùng % giả lập).
- Bảo toàn tính toàn vẹn và khả năng truy vết của Technical Evidence theo từng Repository, Branch, Commit và lần quét.

Tuy nhiên, qua quá trình kiểm tra chéo (cross-audit) giữa **Tài liệu UC M03** và **Hiện trạng mã nguồn thực tế (Codebase NestJS API, Next.js Web, Contracts, Prisma Layer)**, phát hiện các vấn đề xung đột nghiệp vụ và thiếu sót trong chuỗi xử lý (CODE-01 đến CODE-07).

Toàn bộ các lỗi mã nguồn (CODE-01 đến CODE-07) đã được khắc phục triệt để và kiểm thử hồi quy thành công trên toàn bộ test suite.

---

## 2. CHI TIẾT CÁC VẤN ĐỀ XUNG ĐỘT CODEBASE & TÀI LIỆU (ROOT CAUSE & FIX)

### 🔴 CODE-01 — P0: Rerun đang xóa lịch sử mà UC yêu cầu giữ lại

#### 1. Root cause (Nguyên nhân)
- **Vị trí:** [`apps/api/src/modules/scan/application/commands/rerun-scan/rerun-scan.handler.ts`](apps/api/src/modules/scan/application/commands/rerun-scan/rerun-scan.handler.ts)
- **Cơ chế lỗi:** Handler gọi hàm `replaceSameSnapshotScanArtifacts()` trước khi tạo scan job mới. Hàm này không chỉ dọn dẹp dữ liệu tạm mà thực hiện `deleteMany` xóa sạch toàn bộ các bản ghi của những lần scan trước trên cùng snapshot (gồm: Evidence Reports, Technical Profiles, kết quả downstream, Runtime Events và Scan Jobs). Thậm chí một nhánh còn xóa cả `readinessExport` của Assessment.
- **Bằng chứng test:** File `rerun-scan.handler.spec.ts` trước đây viết test khẳng định hành vi xóa này: *"deletes prior scan and evidence artifacts for the same snapshot before rerun"*.
- **Mâu thuẫn:** Tài liệu UC M03 (tại **Luồng thay thế A4** và **Quy tắc nghiệp vụ BR-62**) quy định rõ: *"Lần quét mới dùng phiên bản source code tương ứng và không ghi đè lịch sử của lần quét trước"* & *"Evidence và lịch sử của lần quét trước vẫn được giữ để truy vết"*.

#### 2. Fix (Đã xử lý)
- Đã loại bỏ lời gọi xóa cứng `replaceSameSnapshotScanArtifacts()` trong `rerun-scan.handler.ts`.
- Khi Rerun, hệ thống tạo `scanJob` mới với trạng thái `QUEUED`, liên kết `replacesScanJobId` tới job trước đó, và bảo toàn toàn bộ `scanJob` cũng như `technicalEvidenceReport` cũ trong CSDL.
- Cập nhật unit test `rerun-scan.handler.spec.ts` sang: *"preserves prior scan and evidence artifacts for the same snapshot upon rerun"*, xác nhận `technicalEvidenceReport.deleteMany` và `repositoryScanJob.deleteMany` không bao giờ bị gọi.

---

### 🔴 CODE-02 — P0: Kiểm tra quyền truy cập chưa đồng nhất giữa các API

#### 1. Root cause (Nguyên nhân)
Tồn tại sự thiếu nhất quán trong việc kiểm tra phân quyền sở hữu Assessment (PBAC / Ownership check) trên các endpoint:
- **`GET .../evidence`** ([`apps/api/src/modules/evidence/presentation/http/evidence.controller.ts`](apps/api/src/modules/evidence/presentation/http/evidence.controller.ts)): Controller chỉ truyền `assessmentId` và `role` vào query, không truyền danh tính người dùng (`userId`) để verify ownership.
- **`GET .../scan-jobs/:scanJobId`** ([`apps/api/src/modules/scan/presentation/http/scan.controller.ts`](apps/api/src/modules/scan/presentation/http/scan.controller.ts), [`apps/api/src/modules/scan/application/queries/get-scan-job/get-scan-job.handler.ts`](apps/api/src/modules/scan/application/queries/get-scan-job/get-scan-job.handler.ts)): Query handler trước đây dùng điều kiện `if (query.subjectRole !== AUTH_USER_ROLES.admin && query.userId)`: nếu caller non-admin không truyền `userId`, bước kiểm tra ownership bị bỏ qua thay vì từ chối yêu cầu.
- **Replay Idempotency của Rerun** ([`apps/api/src/modules/scan/application/commands/rerun-scan/rerun-scan.handler.ts`](apps/api/src/modules/scan/application/commands/rerun-scan/rerun-scan.handler.ts)): Nhánh trả về scan job đã có chạy trước bước kiểm tra ownership. Nhánh xử lý race condition cũng trả về job tìm được mà chưa kiểm tra lại phạm vi dữ liệu yêu cầu.

#### 2. Fix (Đã xử lý)
- **`evidence.controller.ts`:** Bổ sung bước kiểm tra ownership trong `getEvidence`: nếu caller là Customer và không sở hữu Assessment (`ownerId !== context.userId`), trả về HTTP 404 `ASSESSMENT_ERROR_CODES.notFound`.
- **`get-scan-job.handler.ts` & `scan.controller.ts`:** Bắt buộc danh tính người dùng đối với non-admin: nếu `query.subjectRole !== AUTH_USER_ROLES.admin`, thiếu `query.userId` hoặc `assessment.ownerId !== query.userId` sẽ lập tức ném lỗi 404 `notFound`, không bao giờ bỏ qua bước kiểm tra ownership. Bổ sung test case xác nhận non-admin thiếu `userId` bị từ chối 404 và admin được phép truy cập.
- **`rerun-scan.handler.ts`:** Đảo thứ tự xử lý: thực hiện xác thực Snapshot và kiểm tra quyền sở hữu Assessment (`isManagerOwner`) **trước** khi kiểm tra và replay idempotency key. Trong nhánh bắt lỗi race condition, bổ sung kiểm tra bắt buộc `raced.assessmentId === command.assessmentId && raced.snapshotId === command.snapshotId`.

---

### 🔴 CODE-03 — P1: Truy vấn Evidence hiện hành không liên kết với phiên Scan mới sau Rerun

#### 1. Root cause (Nguyên nhân)
- Khi bảo toàn lịch sử scan/evidence cũ trong CSDL, các query handler như `GetEvidenceHandler`, `GetAssessmentHandler`, và `GetAssessmentReadinessHandler` trước đây chỉ thực hiện `findFirst({ where: { assessmentId, status: ACCEPTED }, orderBy: { createdAt: "desc" } })`.
- Do không liên kết với phiên quét hiện hành (`scanJobId` / `snapshotId` của `latestScan`), khi Customer bấm Rerun (tạo Job B đang `QUEUED` hoặc `RUNNING`), các endpoint `GET /evidence`, `GET /assessment`, và `GET /assessment/readiness` vẫn đọc và trả về Báo cáo Evidence A và Phân loại A từ lần quét cũ, khiến trạng thái hiển thị là đã sẵn sàng và mở khóa phân loại dù lần quét mới chưa có báo cáo.

#### 2. Fix (Đã xử lý)
- **`get-evidence.handler.ts`:** Truy vấn `latestScan` trước (`repositoryScanJob.findFirst({ where: { assessmentId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] })`). Sau đó truy vấn `technicalEvidenceReport` bắt buộc khớp `scanJobId: latestScan.id, snapshotId: latestScan.snapshotId, status: ACCEPTED`. Nếu phiên quét hiện hành chưa có báo cáo được chấp nhận (ví dụ đang QUEUED/RUNNING/FAILED), ném lỗi 404 Not Found.
- **`get-assessment.handler.ts`:** Xác định `acceptedEvidenceReport` tương ứng với `latestScan`. Nếu phiên quét hiện hành chưa hoàn tất có báo cáo hợp lệ, `acceptedEvidenceReport` là `null`, dẫn đến `readinessState.classification_locked = true`, `lock_reason = evidenceRequired`, `classification_result = null`, và `can_rerun_classification = false`. `classificationResult` nếu có cũng được lọc với điều kiện `createdAt >= acceptedEvidenceReport.createdAt`.
- **`get-assessment-readiness.handler.ts`:** Ràng buộc `acceptedEvidence` phải khớp cả `scanJob.id` và `snapshot.id` của checkpoint hiện hành.
- **Kiểm thử hồi quy:** Bổ sung test E2E `T08` trong `get-technical-evidence.e2e-spec.ts` và unit test trong `get-assessment.handler.spec.ts` chứng minh phiên scan mới đang QUEUED không trả về evidence cũ.

---

### 🟡 CODE-04 — P1: Tiến trình Scanner Activity không đơn điệu khi Graph chưa sẵn sàng

#### 1. Root cause (Nguyên nhân)
- Trong [`apps/web/src/features/assessment-flow/utils/assessment-flow-runtime.ts`](apps/web/src/features/assessment-flow/utils/assessment-flow-runtime.ts): Activity `BUILD_PROGRAM_EVIDENCE_GRAPH` trước đây bị để ở trạng thái `pending` khi `scanCompleted` mà `evidenceGraphReady` chưa đạt, trong khi activity tiếp theo `COLLECT_EVIDENCE` lại chuyển sang `running` hoặc `completed`.
- Ngoài ra, Stage chuyển sang `interview` chỉ dựa vào `evidenceAccepted` mà không đợi `evidenceGraphReady`, dẫn tới tình trạng giao diện kích hoạt phỏng vấn sớm trong khi cây đồ thị tri thức chưa hoàn tất.

#### 2. Fix (Đã xử lý)
- Cập nhật quy tắc chuỗi activity trong `assessment-flow-runtime.ts` đảm bảo tính đơn điệu (monotonic):
  - `SCAN_SOURCE_CODE`: chuyển `running` khi job `RUNNING`, `completed` khi `COMPLETED`, `failed` khi scan thất bại.
  - `BUILD_PROGRAM_EVIDENCE_GRAPH`: chuyển `running` khi `scanCompleted && !evidenceGraphReady`, `completed` khi `evidenceGraphReady = true`.
  - `COLLECT_EVIDENCE`: giữ `pending` trong khi graph đang build, chuyển `running` khi graph đã ready nhưng đang chờ finalize evidence, và `completed` khi cả `evidenceAccepted` và `evidenceGraphReady` đều đạt.
  - Stage `interview` chỉ được mở khi cả `evidenceAccepted && evidenceGraphReady` đều thỏa mãn.
- Bổ sung regression test trong `assessment-repository-flow.test.ts` kiểm chứng trạng thái `accepted evidence waits for graph readiness before opening interview`.

---

### 🟡 CODE-05 — P1: Rerun chưa bảo đảm Concurrency & Retry Idempotency

#### 1. Root cause (Nguyên nhân)
- **Client Idempotency:** Trong `assessment-overview.tsx`, caller trước đây không quản lý `retryKeyRef`. Mỗi lần bấm retry khi gặp sự cố mạng, client tự động sinh một UUID mới tại `repository-analysis-client.ts`, làm mất tác dụng của cơ chế idempotency replay trên server.
- **Server Race Protection & Concurrency:** Trong `rerun-scan.handler.ts`, chuỗi kiểm tra active scan (`tx.repositoryScanJob.findFirst`) và tạo job mới (`tx.repositoryScanJob.create`) chưa có cơ chế khóa mức CSDL trên Assessment. Hai yêu cầu rerun đồng thời với hai idempotency key khác nhau có thể cùng vượt qua kiểm tra và tạo 2 active scan job song song trên cùng một Assessment.

#### 2. Fix (Đã xử lý)
- **Phía Client (UI):**
  - Quản lý `retryKeyRef` (`useRef<string | null>`) trong `assessment-overview.tsx`.
  - Khi bắt đầu yêu cầu retry/rerun, nếu chưa có key thì sinh `crypto.randomUUID()`. Nếu yêu cầu thất bại (lỗi mạng, ngắt kết nối), key được giữ nguyên để lần retry tiếp theo gửi đúng key đó.
  - Khi yêu cầu thành công (`onSuccess`), key được xóa (`null`) để lần rerun chủ động tiếp theo của Customer được cấp key mới.
- **Phía Server (API Concurrency Lock):**
  - Trong transaction của `rerun-scan.handler.ts`, bổ sung khóa hàng bi quan (pessimistic row lock):
    ```ts
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "Assessment" WHERE "id" = ${command.assessmentId} FOR UPDATE`,
    );
    ```
  - Khóa này tuần tự hóa mọi yêu cầu rerun trên cùng một Assessment, triệt tiêu race condition giữa 2 request khác key.
  - Bổ sung unit test concurrency trong `rerun-scan.handler.spec.ts` và test PostgreSQL contention trong `rerun-scan.postgres.spec.ts`.

---

### 🟡 CODE-06 — P1: Phân định bộ lọc Graph Snapshot & nhãn Current/Historical

#### 1. Root cause (Nguyên nhân)
- **Thiếu kết nối bộ lọc xuyên suốt Frontend ➔ BFF ➔ API:**
  - API đã hỗ trợ `snapshotId` và `scanJobId`, nhưng hai BFF route (`evidence-graph/route.ts` và `overview/route.ts`) trước đây không chuyển tiếp query string lên upstream.
  - `evidence-graph-detail-client.ts` và `evidence-graph-overview-client.ts` chỉ nhận `assessmentId`, bỏ qua ngữ cảnh snapshot/job.
  - TanStack Query key cho Graph Overview và Detail chỉ phân biệt theo `assessmentId`, gây cache lẫn lộn giữa các lần chạy khác nhau.

#### 2. Fix (Đã xử lý)
- Cập nhật hai BFF route (`apps/web/src/app/api/assessments/[id]/evidence-graph/route.ts` và `overview/route.ts`): Sử dụng `upstreamUrl` và chuyển tiếp đầy đủ `snapshotId`, `scanJobId` lên backend API.
- Cập nhật `evidence-graph-detail-client.ts` và `evidence-graph-overview-client.ts`: Nhận `filters?: EvidenceGraphFilters`, truyền params lên BFF và lưu giữ `report_id`, `snapshot_id`, `scan_job_id`.
- Cập nhật `query-keys.ts` và `assessment-queries.ts`: Bổ sung `filters?.snapshotId` và `filters?.scanJobId` vào query key để phân tách cache theo từng lần chạy.
- Cập nhật `assessment-overview.tsx`: Truyền chính xác `{ snapshotId: snapshot.id, scanJobId: scanJob?.id }` vào `useProgramEvidenceGraphOverviewQuery`.
- Bổ sung `currentBadge` và `historicalBadge` vào `@lcsp/i18n` hỗ trợ hiển thị đa ngôn ngữ chuẩn hóa.

---

### 🟡 CODE-07 — P1: Màn hình Scanner cần thể hiện trạng thái mất kết nối và trạng thái hàng đợi

#### 1. Root cause (Nguyên nhân)
- Khi job ở trạng thái `QUEUED`, giao diện fallback trước đây hiển thị thông điệp "Tôi đang quét source...", gây mâu thuẫn trực tiếp với trạng thái pending của activity quét source.
- Trong `vi/pages.ts` và `en/pages.ts`, trường `completeThinking` bị hardcode cố định "Đã suy nghĩ trong 18 giây" / "Thought for 18s" dù hệ thống không đo lường thời lượng này.
- SSE Provider (`workspace-runtime-provider.tsx`) có sẵn thông tin `connectionState`, nhưng màn hình chính `ScannerStep` chưa tiếp nhận thông tin này để cảnh báo khi luồng stream sự kiện realtime bị đứt đoạn.

#### 2. Fix (Đã xử lý)
- **`scanner-step.tsx` & `assessment-overview.tsx`:**
  - Bổ sung prop `isQueued?: boolean` (truyền khi `scanJob.status === REPOSITORY_SCAN_JOB_STATUSES.queued`), hiển thị thinking `queuedThinking` ("Đang chờ xử lý...") và mô tả `queuedDescription`.
  - Bổ sung prop `isReconnecting?: boolean` khi `workspaceRuntime.connectionState === WORKSPACE_RUNTIME_CONNECTION_STATES.disconnected`, hiển thị indicator kết nối lại mà không làm mất trạng thái dữ liệu.
- **`@lcsp/i18n`:**
  - Thay thế số liệu mẫu hardcode "18 giây" thành "Đã hoàn tất suy nghĩ" (VI) và "Thought completed" (EN).

---

## 3. CÁC ĐIỂM CẦN CẢI THIỆN TRONG TÀI LIỆU USE CASE (M03 SPEC)

| STT | Khoảng trống trong tài liệu UC | Hướng điều chỉnh trong Tài liệu |
| :--- | :--- | :--- |
| **1** | **Khớp nối Hand-off M02 ➔ M03:** Chưa làm rõ trường hợp mở lại Assessment bị dở dang (chưa có Snapshot/Job). | Quy định rõ: Nếu `needsRepositorySetupResume = true`, hệ thống mở lại giao diện Setup của M02. Chỉ kích hoạt UC-M03 khi đã có đủ `connectionId`, `snapshotId` và `scanJobId`. |
| **2** | **Chuẩn hóa 5 Scanner Activities:** Tài liệu mô tả chung chung các hoạt động. | Cập nhật bảng Normal Flow trong UC-M03-01 với 5 stage chuẩn: `CONNECT_REPOSITORY` ➔ `CLONE_SOURCE_ARCHIVE` ➔ `SCAN_SOURCE_CODE` ➔ `BUILD_PROGRAM_EVIDENCE_GRAPH` ➔ `COLLECT_EVIDENCE`. |
| **3** | **Tiêu chí Gate chuyển sang Interview:** Ghi chung chung "đáp ứng điều kiện sử dụng". | Định nghĩa rõ điều kiện Gate: Phải thỏa mãn đồng thời: `scanJob.status = COMPLETED`, `evidenceReport.status = ACCEPTED` khớp với scan job hiện tại, và `evidenceGraphReady = true`. |
| **4** | **Mã lỗi giả định `[MSG-xxx]`:** Dùng `[MSG-030]` đến `[MSG-038]`. | Thay thế toàn bộ bằng mã lỗi `SCREAMING_SNAKE_CASE` trong `packages/contracts/src/scan/codes.ts` và ánh xạ i18n keys tương ứng. |
| **5** | **Đặc tả Concurrency & Idempotency Key:** Chưa nêu rõ vòng đời key. | Bổ sung quy định: Lần quét đầu và mỗi lần rerun mới do Customer chủ động khởi tạo một `idempotencyKey` mới; các lần retry tự động hoặc thủ công do lỗi mất phản hồi mạng phải tái sử dụng cùng một `idempotencyKey`. |
| **6** | **Quy tắc gắn nhãn Current / Historical:** Chưa quy định logic phân định khi có rerun. | Quy định rõ: Bản ghi Report chỉ được coi là "Current" khi khớp trực tiếp với `scanJobId` của phiên quét hiện hành. Khi một phiên quét mới đang chạy mà chưa ra báo cáo, các báo cáo cũ là "Historical" và không được mở khóa phân loại cho phiên mới. |

---

## 4. KẾT QUẢ THỰC HIỆN & BẰNG CHỨNG KIỂM THỬ (VERIFICATION)

| Hạng mục | Trạng thái Code | Bằng chứng Kiểm thử (Test Suites) |
| :--- | :---: | :--- |
| **CODE-01** (Giữ lịch sử Rerun) | ✅ Hoàn thành | `rerun-scan.handler.spec.ts` (12/12 passed, xác nhận bảo toàn artifact) |
| **CODE-02** (Phân quyền PBAC & Idempotency) | ✅ Hoàn thành | `get-scan-job.handler.spec.ts` (11/11 passed, test missing userId 404, non-owner 404, admin bypass), `evidence-runtime.controller.spec.ts` (21/21 passed) |
| **CODE-03** (Rerun Lineage Binding) | ✅ Hoàn thành | `get-technical-evidence.e2e-spec.ts` (T08 queued rerun 404), `get-assessment.handler.spec.ts` (queued rerun classification lock) |
| **CODE-04** (Scanner Activity Monotonicity & Graph Ready) | ✅ Hoàn thành | `assessment-repository-flow.test.ts` (13/13 passed, graph readiness gate test) |
| **CODE-05** (Idempotency Key reuse UI & Concurrency Row Lock) | ✅ Hoàn thành | `rerun-scan.handler.spec.ts` (test concurrency 409 conflict passed), `rerun-scan.postgres.spec.ts` (Postgres contention lock) |
| **CODE-06** (Lọc Graph Snapshot xuyên suốt & Badge Current/Historical) | ✅ Hoàn thành | `program-evidence*.test.ts` (34/34 passed), BFF routes, clients, và query keys updated |
| **CODE-07** (Cảnh báo kết nối Reconnecting & Queued state) | ✅ Hoàn thành | `scanner-step.tsx`, `assessment-overview.tsx`, i18n build passed |
| **Toàn bộ Web Tests (Repository/Evidence Flow)** | ✅ Hoàn thành | `pnpm --filter @lcsp/web test` (all passed) |
| **Toàn bộ Unit Tests Scan & Evidence API** | ✅ Hoàn thành | `src/modules/scan` (60/60 passed across 7 suites), `src/modules/evidence` (98/98 passed across 13 suites), `src/modules/assessment` (all passed) |
| **Typecheck TypeScript** | ✅ Hoàn thành | `pnpm --filter @lcsp/web exec tsc --noEmit` (0 errors), `pnpm --filter @lcsp/api exec tsc --noEmit` (0 errors) |
