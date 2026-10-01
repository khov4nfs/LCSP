# BÁO CÁO ĐÁNH GIÁ TÀI LIỆU USE CASE (UC)
## Module: M02 — ASSESSMENT SETUP & REPOSITORY CONNECTION
**Hệ thống:** LCSP (Legal Compliance Software Platform)  
**Tài liệu đánh giá:** [Business Use Case Specification · M02](https://docs.google.com/document/d/1B110wICqeEnBPNa6Ym-MYB1KwVSM3k8uzORoRCmM1qo/edit?tab=t.0)  
**Ngày đánh giá:** 28/09/2026  

---

## 1. TỔNG QUAN ĐÁNH GIÁ

Tài liệu đặc tả Use Case **M02 — ASSESSMENT SETUP & REPOSITORY CONNECTION** đã nắm bắt được luồng nghiệp vụ tinh gọn (Lean Flow) mới của hệ thống: loại bỏ form tạo thủ công truyền thống, tự động đặt tên Assessment từ URL repository, tự động chọn default branch/commit và kích hoạt scan ngay sau khi kết nối source code.

Tuy nhiên, khi đối chiếu tài liệu với **kiến trúc thực tế của hệ thống LCSP** (Frontend Next.js App Router, Backend NestJS CQRS, Clean Architecture, `@lcsp/contracts`, `@lcsp/i18n`, Prisma Data Layer và Security Policy), tài liệu còn tồn tại một số **lỗ hổng nghiệp vụ, xung đột kiến trúc và thiếu sót về xử lý ngoại lệ**.

---

## 2. CÁC PHẦN CHƯA THỰC HIỆN TỐT & ĐIỂM HẠN CHẾ

### 2.1. Rủi ro Dữ liệu & Trạng thái Mồ côi (Orphan / Partial Assessment State)
* **Vấn đề thực tế:** 
  - Trong luồng **UC-M02-01 (Normal Flow)**, bước 8 thực hiện tạo Assessment trước (gọi API `POST /assessments`), sau đó bước 9 mới kết nối Repository (`POST /assessments/:id/repository-connection`), bước 10 pin snapshot và bước 11 trigger scan.
  - Nếu xảy ra lỗi ở bước 9, 10, 11 hoặc người dùng đóng trình duyệt/mất mạng giữa chừng, một bản ghi Assessment rác (mồ côi, không có repo, không có snapshot, không có scan) đã tồn tại trong CSDL.
* **Hạn chế trong tài liệu:**
  - Tài liệu có ghi nhận điểm này ở **ALN-M02-07** và **Postcondition 4**, nhưng trong các Use Case lại **hoàn toàn thiếu cơ chế xử lý**: không có quy định rollback (transactional cleanup/saga), không có trạng thái vòng đời phân biệt (`DRAFT` / `PENDING_SETUP` vs `INITIALIZED`), và trong **UC-M02-02 (View Assessment)** chưa đặc tả luồng khôi phục (Resume Setup Wizard) khi mở lại một Assessment bị dang dở.

---

### 2.2. Xung đột Kiến trúc Xác thực Git Provider & Thiếu Trường Dữ liệu Đặc thù
* **Lệch pha giữa PAT và GitHub App:**
  - Mục **ALN-M02-04** và **UC-M02-03** chỉ chọn giải pháp Personal Access Token (PAT) và xem xét bỏ GitHub App. Tuy nhiên, Backend LCSP hiện tại đã hoàn thiện module GitHub App (`/github/app/start`, `/github/app/callback`) phục vụ các tổ chức doanh nghiệp yêu cầu bảo mật cao không dùng PAT cá nhân. Việc loại bỏ GitHub App khỏi tài liệu làm giảm tính đầy đủ của tài liệu kiến trúc.
* **Thiếu trường dữ liệu cho Azure DevOps:**
  - Với Azure DevOps, hệ thống yêu cầu cấu hình `Organization Name` đi kèm với PAT (đã được implement trong `provider-credential-dialog.tsx` và backend validator). Tài liệu UC-M02-03 chỉ ghi chung chung là "Customer nhập PAT" mà không đề cập đến trường Organization bắt buộc đối với Azure DevOps.
* **Xác định sai thời điểm phát hiện lỗi quyền truy cập Repository:**
  - Ngoại lệ **E2 của UC-M02-03** ghi: *"Credential không có quyền đọc repository cần dùng"*. Điều này **không khả thi về mặt kỹ thuật** tại thời điểm Connect Provider ở màn hình Settings, vì lúc này người dùng chưa nhập bất kỳ repository URL cụ thể nào (hệ thống chỉ có thể verify tính hợp lệ của token với Provider). Lỗi thiếu quyền đọc repo cụ thể phải thuộc về **E3 của UC-M02-01** khi phân tích URL repository.

---

### 2.3. Phân rã Use Case chưa chuẩn xác (Lifecycle & Action Menu)
* **Xếp sai vị trí thao tác Đổi tên (Rename):**
  - Tài liệu đưa hành động **Rename Assessment** thành Luồng thay thế **A2 trong UC-M02-01 (Create Assessment)**. Đây là phân rã sai về mặt nghiệp vụ vì Rename diễn ra sau khi Assessment đã hoàn tất khởi tạo và người dùng thao tác từ màn hình Overview/Detail hoặc danh sách Recents, không nằm trong tiến trình tạo mới.
* **Bỏ qua thao tác Xóa (Delete Assessment):**
  - Mục **ALN-M02-06** trì hoãn việc đưa Delete Assessment vào tài liệu dù giao diện (`assessment-options-dropdown`) và Backend API đã hỗ trợ đầy đủ. Việc thiếu UC Quản lý Vòng đời (Rename, Delete, Archive) tạo ra khoảng trống lớn trong tài liệu đặc tả nghiệp vụ.

---

### 2.4. Trải nghiệm Chuyển đổi Ngữ cảnh bị Đứt gãy (Context Switching & State Loss)
* **Gãy luồng giữa Wizard và Settings:**
  - Trong **UC-M02-01 (A1)**, khi chưa cấu hình Provider, hệ thống điều hướng người dùng sang `Settings > Connectors` (`/workspace/settings?section=repositories`).
  - Tài liệu chỉ ghi ngắn gọn: *"Sau khi kết nối thành công, Customer quay lại bước thiết lập và tiếp tục"*.
  - Tuy nhiên, việc chuyển trang (page navigation) sẽ làm mất state tạm thời trên client nếu không có cơ chế lưu trữ state (như query param `returnUrl`, session storage hoặc mở dưới dạng Inline Dialog Modal trực tiếp trên màn hình Setup).

---

### 2.5. Không tuân thủ Quy chuẩn Contract Codes & i18n
* **Sử dụng mã giả định `[MSG-xxx]` tự phát:**
  - Tài liệu đưa ra hàng loạt mã thông báo như `[MSG-018]`, `[MSG-019]`, `[MSG-026]`, `[MSG-029]`.
  - Điều này đi ngược lại kiến trúc chuẩn của LCSP: Các mã lỗi phải tuân thủ chuẩn **`SCREAMING_SNAKE_CASE`** định nghĩa tại `@lcsp/contracts` (ví dụ: `REQUIRED_ACTIONS.reauthenticate`, `INVALID_REPOSITORY_URL`, `CREDENTIAL_UNAUTHORIZED`), và nội dung hiển thị phải được map qua key của gói `@lcsp/i18n` (ví dụ: `pages.assessmentFlow.errors.repositoryUrl`).

---

### 2.6. Thiếu Kịch bản Xử lý Rate Limiting, Token Expiration & Re-authentication
* **Bảo mật Re-authentication:**
  - Backend LCSP áp dụng decorator `@ReAuthForSensitiveRoute` đối với các thao tác nhạy cảm liên quan đến lưu/cập nhật credential. Tài liệu UC-M02-03 có đề cập ở BR-43 và A3 nhưng chưa mô tả chi tiết quy trình Step-up Re-auth (Popup xác thực lại mật khẩu/MFA trước khi ghi nhận PAT).
* **Rate Limit từ Git Provider:**
  - Các API Git Provider (GitHub/GitLab API) áp dụng giới hạn gọi (Rate Limiting). Tài liệu chưa có Business Rule và Exception xử lý khi hệ thống bị Provider chặn do vượt ngưỡng quota request.

---

### 2.7. Khóa cứng Nhánh Mặc định (Inflexibility for Branch Selection)
* **Ràng buộc quá cứng nhắc (BR-24, BR-25):**
  - Tài liệu quy định hệ thống bắt buộc chỉ dùng `defaultBranch` cho lần đánh giá đầu tiên.
  - Mặc dù đây là thiết kế hợp lý cho MVP, nhưng việc không để mở khả năng tùy chọn branch/tag trong tương lai (khi người dùng cần audit mã nguồn trên nhánh release hoặc staging) sẽ gây khó khăn cho việc mở rộng tính năng.

---

## 3. PHƯƠNG HƯỚNG XỬ LÝ & ĐỀ XUẤT CẢI TIẾN

| STT | Vấn đề | Phương hướng xử lý đề xuất |
| :--- | :--- | :--- |
| **1** | **Xử lý Assessment dở dang (Orphan Assessment)** | • **Bổ sung trạng thái Lifecycle:** Ghi nhận Assessment mới tạo ở trạng thái `DRAFT` hoặc `PENDING_SETUP`. Chỉ chuyển sang `ACTIVE` khi đã pin Snapshot và bắt đầu Scan.<br>• **Xử lý khôi phục (Resume Flow):** Trong **UC-M02-02**, nếu phát hiện Assessment ở trạng thái `PENDING_SETUP`, hiển thị lại giao diện `RepositorySetupStep` để người dùng tiếp tục hoàn tất.<br>• **Cơ chế dọn dẹp tự động:** Bổ sung Background Job dọn dẹp các Assessment `DRAFT` không có hoạt động sau 24h. |
| **2** | **Chuẩn hóa Phân rã Use Case** | • **Tách riêng Use Case Quản lý Lifecycle:** Chuyển `Rename Assessment` và `Delete Assessment` thành một Use Case riêng (ví dụ: `UC-M02-04 — Manage Assessment Details & Lifecycle`).<br>• Giữ `UC-M02-01` tập trung duy nhất vào luồng khởi tạo và kích hoạt scan ban đầu. |
| **3** | **Cải tiến UX Kết nối Provider** | • **Sử dụng Inline Dialog:** Thay vì bắt người dùng chuyển hướng sang trang Settings khi thiếu credential, cho phép mở trực tiếp `ProviderCredentialDialog` dạng Modal ngay trong luồng tạo Assessment.<br>• Sau khi lưu credential thành công, Modal đóng lại và wizard tự động tiếp tục mà không bị reload hay mất ngữ cảnh. |
| **4** | **Bổ sung Đặc tả cho Git Providers** | • **Cập nhật trường Azure DevOps:** Thêm input bắt buộc `Organization Name` đối với Azure DevOps trong UC-M02-03.<br>• **Đính chính thời điểm kiểm tra quyền:** Tách rõ: (1) Kiểm tra tính hợp lệ của Token tại UC-M02-03; (2) Kiểm tra quyền truy cập trên Repository cụ thể tại UC-M02-01 (bước 9).<br>• **Ghi nhận lộ trình GitHub App:** Giữ GitHub App trong mục Kiến trúc mở rộng (Enterprise Mode). |
| **5** | **Đồng bộ hóa Chuẩn Lỗi với `@lcsp/contracts` và `@lcsp/i18n`** | • Thay thế toàn bộ mã `[MSG-xxx]` bằng **Problem Code** chuẩn từ `@lcsp/contracts` và **i18n Message Keys** tương ứng.<br>• Ví dụ: Map mã lỗi `E1` sang key `pages.assessmentFlow.errors.repositoryUrl`, `E3` sang `pages.assessmentFlow.errors.repositorySetup`. |
| **6** | **Chi tiết hóa Luồng Re-authentication & Rate Limit** | • **Quy trình Re-auth:** Mô tả rõ khi lưu/đổi PAT, nếu phiên làm việc yêu cầu xác thực lại, hệ thống hiển thị form xác nhận mật khẩu/MFA rồi tự động tiếp tục tiến trình lưu PAT (`retry()`).<br>• **Xử lý Rate Limit:** Bổ sung ngoại lệ khi Git Provider trả về mã 429/403 Rate Limit, hiển thị thời gian chờ (Reset Time) cho người dùng. |
| **7** | **Mở đường cho Branch Selection** | • Cập nhật Business Rule: Nêu rõ nhánh mặc định là hành vi mặc định của MVP, đồng thời kiến trúc sẵn sàng cho phép chọn branch/commit qua tham số cấu hình nâng cao trong các phiên bản tiếp theo. |

---

## 4. KẾT LUẬN

Tài liệu UC của module **M02** đã phản ánh đúng hướng đi của sản phẩm về việc tối giản hóa trải nghiệm người dùng ban đầu. Tuy nhiên, để tài liệu đạt chất lượng **Production-ready** và có thể **freeze** làm cơ sở phát triển, nhóm BA cần cập nhật lại các nội dung theo các phương hướng xử lý nêu trên, đặc biệt là:
1. Xử lý trạng thái Assessment dở dang (Orphan State).
2. Tách riêng UC Rename / Delete Assessment.
3. Chuẩn hóa luồng kết nối Provider (Inline Modal, Azure DevOps Org, tách bạch thời điểm check quyền).
4. Đồng bộ hóa với bộ mã lỗi (`contracts`) và hệ thống đa ngôn ngữ (`i18n`) của dự án.
