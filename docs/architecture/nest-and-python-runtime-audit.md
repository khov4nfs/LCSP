# Báo Cáo Phân Tích Kiến Trúc Backend: NestJS API & Python DeepAgents Runtime

> **Trạng thái tài liệu:** Tài liệu nội bộ rà soát kỹ thuật.  
> **Lưu ý kiểm soát phiên bản:** Tài liệu này được tạo và lưu cục bộ trên máy phát triển, **KHÔNG COMMIT HOẶC PUSH LÊN GIT** cho đến khi có lệnh rõ ràng: `"đẩy file báo cáo này lên git đi"`.

---

## 1. TỔNG QUAN KIẾN TRÚC VÀ MÔ HÌNH TƯƠNG TÁC 2 CHIỀU

Hệ thống tính toán và dịch vụ nghiệp vụ của LCSP được thiết kế theo mô hình tách rời giữa tầng điều phối nghiệp vụ doanh nghiệp (**NestJS - `apps/api`**) và tầng tác nhân trí tuệ nhân tạo chuyên sâu (**Python DeepAgents - `deepagents`**).

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              Next.js Web Frontend (apps/web)                           │
│                      Server-Side BFF Proxy (lib/server/ + proxy.ts)                    │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │ Bearer Token / Session Guard
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                NestJS Backend API (apps/api)                           │
│     11 Domain Modules (48 Controllers) + 8 Platform Modules + Transactional Outbox     │
└───────────────────────┬────────────────────────────────────────▲───────────────────────┘
                        │                                        │
     (1) HTTP (Port 8000)│ (2) RabbitMQ (AMQP Event Outbox)       │ (3) HTTP Callback
      Điều khiển Agent: │     Tác vụ nền nặng:                   │     Nạp Facts, Báo cáo
      Run, Cancel, State│     DOCX/PDF Ingest, Docker Scanner    │     Stream Token, Trạng thái
                        ▼                                        │     (WorkerApiKeyGuard)
┌────────────────────────────────────────────────────────────────┴───────────────────────┐
│                           Python DeepAgents Runtime (deepagents)                       │
│  - HTTP Server: Starlette + Uvicorn (LangGraph SDK Facade + Control Endpoints)         │
│  - Message Consumer: rabbitmq_consumer.py                                              │
│  - Agent Graphs: Assessment Root Agent, Rule Set Preparation, Legal Source Ingestion   │
│  - Execution Sandbox: Docker Isolation Scanner, Codebase Ast/Tree-Sitter Memory        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. CHI TIẾT 11 DOMAIN FEATURE MODULES TRONG NESTJS (`apps/api`)

Mỗi module đều tuân thủ nguyên tắc Clean Architecture (Hexagonal Architecture / Ports & Adapters) với các thư mục phân định trách nhiệm rõ ràng: `presentation/http/` (controllers, thin layer), `application/` (commands, queries, handlers, services), `domain/` (entities, value objects, ports), `infrastructure/` (prisma persistence, external adapters).

| STT | Tên Module | Controllers | Tính năng nghiệp vụ chính | Cơ chế bảo vệ & Bất biến kỹ thuật | Mức độ phát triển (Maturity) |
| :--- | :--- | :---: | :--- | :--- | :--- |
| **1** | **`auth`** | 6 | - Đăng ký, đăng nhập email/mật khẩu, đăng xuất.<br>- Xác thực đa yếu tố **MFA TOTP** (RFC 6238): Sinh secret, QR code, xác minh OTP, phát hành mã khôi phục (Recovery codes).<br>- Đăng nhập mạng xã hội (Google & GitHub OAuth).<br>- Re-authentication cho các hành động nhạy cảm (Step-up proof).<br>- Đổi mật khẩu và quy trình khôi phục tài khoản qua email token. | - Khóa tài khoản sau 5 lần nhập sai mã OTP liên tiếp trong 15 phút (`AuthMfaRateLimit`).<br>- Session token fingerprinting.<br>- Chống rò rỉ hash mật khẩu.<br>- Bắt buộc MFA Freshness trên các route quan trọng. | **100% Hoàn thiện (Production-Ready)** |
| **2** | **`assessment`** | 18 | - **Động cơ đánh giá tuân thủ cốt lõi (Core Product Engine)**.<br>- Quản lý vòng đời Assessment Run: Tạo mới, khởi chạy, tạm dừng, hủy, chạy tiếp (State Machine).<br>- **Repository Discovery**: Quét cây thư mục, nhận diện framework, công nghệ và cấu trúc dự án cần kiểm toán.<br>- **Human-in-the-Loop (HITL)**: Tiếp nhận câu hỏi leo thang từ AI khi thiếu dữ kiện hoặc mâu thuẫn để chuyên gia con người giải quyết.<br>- **Evidence & Artifacts**: Quản lý bằng chứng tuân thủ, trích xuất ma trận truy vết (Traceability Matrix).<br>- **Xuất báo cáo**: Sinh biên bản kiểm toán PDF (chuẩn v2 & v3) có phân tích chi tiết từng điều khoản.<br>- Giới hạn ngân sách Token LLM và kiểm soát dung lượng tính toán (Root Capacity). | - Cơ chế **Lease Lock** (`AssessmentLeaseGuard`): Ngăn chặn nhiều worker/tiến trình ghi đè đồng thời lên cùng một assessment.<br>- Giao tiếp bất đồng bộ qua Transactional Outbox.<br>- Bảo vệ chống BOLA (mọi thao tác phải gắn chặt `workspaceId`). | **Rất sâu & Ổn định (Core Engine)** |
| **3** | **`compliance-rule-set`** | 2 | - Quản lý các bộ quy tắc tuân thủ (Compliance Rule Sets - CRS).<br>- Ghim phiên bản nguồn luật (Pinned Legal Source Versions).<br>- Quản lý vòng đời bộ quy tắc: `DRAFT` $\rightarrow$ `ACTIVE` $\rightarrow$ `SUPERSEDED`.<br>- Tự động kích hoạt quy trình *Rule Set Preparation* khi có phiên bản luật mới được kích hoạt. | - Bất biến cấp cơ sở dữ liệu: Database trigger từ chối mọi lệnh `UPDATE` / `DELETE` đối với các bộ quy tắc đã chuyển sang trạng thái `ACTIVE`.<br>- Toàn vẹn tham chiếu khóa ngoại. | **Hoàn thiện cao (Production-Ready)** |
| **4** | **`legal-source`** | 5 | - Quản lý kho văn bản pháp luật chính thức (Luật, Nghị định, Thông tư, Tiêu chuẩn).<br>- Tiếp nhận tài liệu qua Upload (`.docx`, `.pdf`, `.html`, `.md`) hoặc Import từ URL.<br>- Phân đoạn văn bản (Text Chunking), tính băm nội dung SHA-256 từng điều khoản.<br>- Thư viện tra cứu văn bản pháp lý cho người dùng cuối.<br>- Xây dựng đồ thị liên kết văn bản pháp lý (Legal Document Graph: Điều $\rightarrow$ Khoản $\rightarrow$ Điểm). | - Lưu trữ hướng nội dung (Content-Addressed Storage) theo mã băm SHA-256.<br>- Chống sửa đổi tài liệu pháp lý đã nạp vào hệ thống.<br>- Đảm bảo tính toàn vẹn văn bản tuyệt đối. | **Hoàn thiện cao** |
| **5** | **`legal-rule-catalog`** | 1 | - Danh mục phân loại các nghĩa vụ pháp lý chuyên ngành an toàn thông tin (như Nghị định 13/2023/NĐ-CP, Luật An ninh mạng, TCVN 11930, ISO 27001).<br>- Cung cấp bộ lọc tra cứu tiêu chí cho UI và AI Agent. | - Phân cấp danh mục dữ liệu rõ ràng.<br>- Chuẩn hóa mã lỗi và mã định danh theo chuẩn `SCREAMING_SNAKE_CASE`. | **Hoàn thiện & Ổn định** |
| **6** | **`billing`** | 8 | - **Tích hợp cổng thanh toán SePay**: Nhận webhook biến động số dư VietQR / Ngân hàng nội địa, xác thực chữ ký HMAC.<br>- **Kernel kế toán kép** (`BillingAccountingKernel`): Nạp tiền ví, trừ credit khi dùng AI, hoàn tiền, phong tỏa số dư.<br>- Đo đạc lượng tiêu thụ Token LLM (Usage Metering) của từng Workspace theo thời gian thực.<br>- Đối soát giao dịch tự động và báo cáo doanh thu tài chính cho Admin. | - Bất biến số dư: `Wallet.balance >= 0` được bảo vệ bằng Database Row-level lock / Transaction cấp cao nhất.<br>- Idempotency Key bảo đảm một mã thanh toán webhook chỉ được cộng tiền đúng 1 lần. | **Hoàn thiện cao** |
| **7** | **`github-integration`** | 2 | - Kết nối repository qua GitHub OAuth App hoặc Personal Access Token (PAT).<br>- Tải gói mã nguồn (tar.gz archive) đưa vào Sandbox an toàn để AI phân tích.<br>- Điều tiết giới hạn tần suất gọi API (GitHub Rate Limit Backoff - xử lý HTTP 429). | - Mã hóa Token truy cập bằng khóa đối xứng AES-256-GCM (`KeyEncryptionKeyProvider`).<br>- Chống rò rỉ mã nguồn và ngăn chặn tấn công SSRF khi tải snapshot repository. | **Hoàn thiện** |
| **8** | **`admin`** | 2 | - Bảng điều khiển (Dashboard) giám sát tổng thể: số lượng người dùng, số lượt đánh giá, doanh thu nạp tiền.<br>- Quản lý tài khoản người dùng: Khóa/mở khóa tài khoản, phân bổ vai trò quyền hạn (Role assignment). | - Bảo vệ nghiêm ngặt bằng `RbacGuard` với vai trò bắt buộc là `ADMIN`.<br>- Tự động ghi nhật ký kiểm toán cho mọi thao tác can thiệp tài khoản. | **Hoàn thiện** |
| **9** | **`audit`** | 1 | - Tra cứu nhật ký kiểm toán hệ thống (Audit Trail).<br>- Hỗ trợ Compliance Officer và Admin truy vết hành vi: ai đã làm gì, vào thời điểm nào, từ địa chỉ IP nào, trên tài nguyên nào, với mã băm dữ liệu là gì. | - Nhật ký bất biến chỉ ghi (Append-only storage).<br>- Đáp ứng tiêu chuẩn truy vết an toàn thông tin ISO/IEC 27001. | **Hoàn thiện** |
| **10** | **`health`** | 1 | - Cung cấp endpoint Liveness và Readiness probes cho Docker / Kubernetes.<br>- Kiểm tra trạng thái sống còn của: Database PostgreSQL, RabbitMQ Message Broker, và Disk Storage. | - Đảm bảo dịch vụ không nhận traffic khi cơ sở dữ liệu hoặc message broker chưa sẵn sàng. | **Production-Ready** |
| **11** | **`app`** | 1 | - Điều phối chung ứng dụng, cung cấp thông tin phiên bản hệ thống và đàm phán phiên bản API. | - Endpoint cơ sở. | **Hoàn thiện** |

---

## 3. CHI TIẾT 8 PLATFORM MODULES TRONG NESTJS (`apps/api/src/platform`)

1. **`platform/rbac`**:
   - `RbacGuard`: Kiểm tra Bearer Token, tải đối tượng người dùng, kiểm tra quyền hạn (Role / Permission), kiểm tra bằng chứng bước xác thực (Step-up MFA Freshness) đối với các route nhạy cảm.
   - Ghi nhận quyết định cho phép / từ chối vào kho nhật ký phân quyền (`AuthorizationDecisionRepository`).
2. **`platform/http`**:
   - `HttpExceptionFilter`: Bộ lọc ngoại lệ toàn cục tuân thủ chuẩn quốc tế **RFC 7807 (Problem Details for HTTP APIs)**. Chuẩn hóa 100% lỗi hệ thống thành cấu trúc `{ ok: false, problem: { type, status, code, titleKey, detailKey, correlationId, ... } }`, tự động che giấu stack trace và lỗi SQL nội bộ.
   - `ResponseTransformInterceptor`: Tự động bọc mọi response JSON thành công trong `{ ok: true, data }`.
   - Decorator `@BypassEnvelope()`: Bỏ qua bọc JSON đối với các endpoint stream dữ liệu nhị phân (tải file PDF, DOCX).
3. **`platform/outbox`**:
   - Hiện thực mẫu thiết kế **Transactional Outbox Pattern**: Đảm bảo nghiệp vụ lưu database và việc bắn tin nhắn sang RabbitMQ nằm trong cùng một transaction, loại bỏ rủi ro mất tin nhắn khi hệ thống gặp sự cố mạng.
   - Quản lý Dead Letter Queue (DLQ) để tự động bắt lại các thông điệp xử lý thất bại.
4. **`platform/logging`**:
   - Sử dụng `AsyncLocalStorage` (`requestStorage.run`) để gán và duy trì `x-correlation-id` xuyên suốt vòng đời request mà không gây rò rỉ bộ nhớ.
   - `HttpLoggerMiddleware`: Ghi log chi tiết thời gian xử lý request (`+Xms`), mã trạng thái và siêu dữ liệu lỗi.
   - `FilePartitionedLogger`: Cơ chế ghi log chia tách file phục vụ vận hành.
5. **`platform/storage`**:
   - Bộ điều hợp lưu trữ file tài nguyên (Object Storage / Local Storage), đảm bảo băm SHA-256 xác thực tính toàn vẹn nội dung.
6. **`platform/mail`**:
   - Module gửi email kích hoạt tài khoản, cảnh báo bảo mật khi đăng nhập lạ, và gửi mã OTP khôi phục mật khẩu.
7. **`platform/localization`**:
   - Quản lý đa ngôn ngữ (i18n Tiếng Việt - Tiếng Anh) cho nội dung điều khoản luật và giao diện báo cáo.
8. **`platform/security`**:
   - Các thuật toán mã hóa đối xứng AES-256-GCM, hàm băm SHA-256, sinh định danh an toàn ngẫu nhiên và quản lý khóa mã hóa chính.

---

## 4. ĐÁNH GIÁ HỆ THỐNG MIDDLEWARE & PIPELINE (SO VỚI BEST PRACTICES)

### A. Những điểm đạt chuẩn xuất sắc (Strengths)
1. **Dynamic Body Parser Middleware (`httpBodyParser`)**:
   - Không áp dụng mức giới hạn dung lượng cứng ngắc. Tùy biến giới hạn payload thông minh theo đúng từng route:
     - Route Webhook SePay: `raw 256KB` (giữ nguyên raw bytes phục vụ kiểm tra chữ ký HMAC).
     - Route Upload văn bản pháp lý: `raw 26MB` (nhận trực tiếp stream file nén).
     - Route Ingestion callback & Final Report: `50MB JSON`.
     - Toàn bộ các route JSON còn lại: Giới hạn nghiêm ngặt `1MB`.
   - $\rightarrow$ *Ngăn chặn tấn công DoS tràn bộ nhớ RAM (Payload Too Large) hiệu quả.*
2. **Context Tracing an toàn bằng `AsyncLocalStorage`**:
   - Truyền `correlationId` mượt mà qua các tầng service mà không cần truyền tham số thủ công qua từng hàm.
3. **Mặt bằng chuẩn hóa dữ liệu Response Envelope**:
   - Thành công: `{ ok: true, data }`.
   - Lỗi: `{ ok: false, problem: { ... } }` (HTTP status code trên header luôn khớp chính xác với `problem.status`).
4. **Kiểm tra dữ liệu đầu vào bằng `ZodValidationPipe`**:
   - Sử dụng trực tiếp schema Zod từ `@lcsp/contracts` để validate request payload với HTTP 422 Unprocessable Entity, ngăn chặn triệt để lỗ hổng Mass Assignment.

### B. Những thiếu sót cần bổ sung theo chuẩn Enterprise (Gaps & Action Items)
1. **Chưa cài đặt Middleware bảo mật Header (`helmet`)**:
   - File [main.ts](file:///Users/nguyenanh/Documents/Capstone/LCSP/apps/api/src/main.ts) chưa sử dụng thư viện `helmet`.
   - *Rủi ro*: Thiếu các HTTP header phòng vệ cơ bản của trình duyệt như `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Strict-Transport-Security` (HSTS).
2. **Chưa cấu hình kiểm soát truy cập nguồn gốc (`CORS`)**:
   - `main.ts` hiện tại chưa gọi `app.enableCors()`. Mặc dù hệ thống có Next.js BFF trung gian, việc thiếu cấu hình CORS whitelist tường minh ở backend là điểm trừ về tính hoàn chỉnh bảo mật.
3. **Chưa có Middleware giới hạn tần suất ở tầng HTTP (Rate-Limiting / Throttler)**:
   - Hệ thống mới chỉ có rate-limit ở tầng database cho phần OTP MFA, nhưng chưa có rate-limit ở tầng mạng HTTP cho các route nhạy cảm (như `/auth/login`, `/auth/sign-up`, `/auth/recovery`) để chống tấn công dò mật khẩu (Brute Force) và từ chối dịch vụ (DDoS).
   - *Khuyến cáo*: Tích hợp `@nestjs/throttler`.
4. **Chưa có Middleware nén dữ liệu (`compression`)**:
   - Các API trả về nội dung lớn (như cây danh mục điều khoản luật, báo cáo kiểm toán) chưa được nén Gzip/Brotli, gây lãng phí băng thông và tăng độ trễ mạng.

---

## 5. CHI TIẾT MÁY CHỦ HTTP API TRONG MÃ NGUỒN PYTHON (`deepagents`)

Trái với suy nghĩ thông thường rằng Python chỉ chạy worker ngầm, dự án LCSP xây dựng một **máy chủ HTTP API nội bộ độc lập** sử dụng **Starlette & Uvicorn** chạy tại cổng mặc định `8000` (định nghĩa tại [local_server.py](file:///Users/nguyenanh/Documents/Capstone/LCSP/deepagents/tools/common/capabilities/agent_runtime/local_server.py)).

### Danh mục các API Endpoints trong Python:

#### 1. Nhóm API điều phối vòng đời AI Agent (Tương thích LangGraph SDK):
* `POST /threads`: Tạo phiên làm việc mới (Thread) cho một lượt đánh giá.
* `GET /threads/{thread_id}`: Lấy thông tin ngữ cảnh của thread.
* `POST /threads/{thread_id}/runs`: **Kích hoạt đồ thị AI (Start Agent Run)** để bắt đầu phân tích mã nguồn và đối chiếu văn bản luật.
* `GET /threads/{thread_id}/runs`: Xem danh sách các lần chạy của thread.
* `GET /threads/{thread_id}/runs/{run_id}`: Theo dõi trạng thái tiến trình AI (`pending`, `running`, `success`, `failed`).
* `POST /threads/{thread_id}/runs/{run_id}/cancel`: **Hủy khẩn cấp lượt chạy (Graceful Cancellation)** — dừng an toàn các container Docker sandbox, hủy tiến trình suy luận và giải phóng bộ nhớ.
* `GET /threads/{thread_id}/state`: Đọc ảnh chụp trạng thái (State Checkpoint) của cây suy luận AI.

#### 2. Nhóm API điều khiển hệ thống nội bộ (Internal Control Endpoints):
* `GET /health` & `GET /ok`: Health-check kiểm tra tính sẵn sàng của server AI.
* `POST /internal/assessment-erasure`: Xóa sạch dữ liệu tạm, sandbox repository và state checkpoint của một assessment khi có yêu cầu tuân thủ quyền riêng tư (Right to be Forgotten).
* `POST /internal/execution-capacity`: Kiểm tra hoặc điều tiết số lượng luồng tính toán đồng thời (Concurrency Slots).
* `POST /internal/authored-translation`: Dịch thuật có kiểm soát nội dung pháp lý.
* `POST /internal/project-locale`: Trích xuất và chuẩn hóa ngôn ngữ giao tiếp của dự án được đánh giá.

---

## 6. KẾ HOẠCH HÀNH ĐỘNG TIẾP THEO

Báo cáo này làm cơ sở để chúng ta lần lượt đi sâu vào từng phần:
1. **Kiểm tra và vá các thiếu sót tầng Middleware của NestJS** (`helmet`, `cors`, `compression`, `@nestjs/throttler`).
2. **Rà soát kiến trúc tầng dữ liệu & BOLA** của từng Controller/Service trong 11 Module.
3. **Đánh giá tính an toàn và độ tin cậy của máy chủ Starlette HTTP API & Worker RabbitMQ trong Python**.
