# Kế hoạch chi tiết tái cấu trúc & khắc phục Module `legal-rule-catalog`

> **Trạng thái**: Giai đoạn 1–2 hoàn thành; Giai đoạn 3 đang chờ thực hiện.
> **Nguyên tắc**: Thực hiện từng tác vụ đơn lẻ, chạy kiểm thử xác nhận (TDD / Regression tests) trước khi đánh dấu hoàn thành và chuyển sang việc tiếp theo. Không thực hiện dồn một lần.

---

## BẢNG THEO DÕI TIẾN ĐỘ TỔNG QUAN

- [x] **Giai đoạn 1: Ổn định Runtime & Khắc phục nguy cơ lỗi cấp cao** (3/3 hoàn thành)
  - [x] **Task 1.1**: Khắc phục nguy cơ Deadlock khi khóa dòng `PreparationRule` (Vấn đề C-02)
  - [x] **Task 1.2**: Cách ly namespace phân vùng cho `pg_advisory_xact_lock` (Vấn đề A-02)
  - [x] **Task 1.3**: Chuẩn hóa ký tự xuống dòng (CRLF/LF) khi đối chiếu `contentSha256` (Vấn đề C-01)
- [x] **Giai đoạn 2: Tái cấu trúc Module & Phân tách trách nhiệm Clean Architecture** (3/3 hoàn thành)
  - [x] **Task 2.1**: Trích xuất Domain logic phân tích quy phạm văn bản pháp lý ra file riêng (Vấn đề R-02)
  - [x] **Task 2.2**: Gỡ bỏ Circular Dependency và gom helpers/types dùng chung (Vấn đề R-03)
  - [x] **Task 2.3**: Tách các Use-case Handlers từ 2 God Services >1500 dòng (Vấn đề R-01)
- [ ] **Giai đoạn 3: Tối ưu tải 10.000 Rules & Tăng cường Bảo mật Production** (0/3 hoàn thành)
  - [ ] **Task 3.1**: Tối ưu hóa phân trang danh sách 10.000 Rules (Vấn đề A-01)
  - [ ] **Task 3.2**: Giới hạn batch size và chống giữ transaction connection DB 60s (Vấn đề A-03)
  - [ ] **Task 3.3**: Chuẩn hóa mã lỗi và bảo vệ schema nội bộ trong response 422 (Vấn đề S-02)

---

## CHI TIẾT TỪNG CÔNG VIỆC

---

### GIAI ĐOẠN 1: ỔN ĐỊNH RUNTIME & KHẮC PHỤC NGUY CƠ LỖI CẤP CAO

#### Task 1.1: Khắc phục nguy cơ Deadlock khi khóa dòng `PreparationRule` (C-02)
- **Mục tiêu**: Loại bỏ việc gọi `SELECT ... FOR UPDATE` tuần tự trong vòng lặp `for (const input of inputs)` theo thứ tự ngẫu nhiên do client gửi lên.
- **File tác động**: `apps/api/src/modules/legal-rule-catalog/application/services/preparation-rule.service.ts` (dòng 189 & dòng 691).
- **Các bước thực hiện**:
  1. Viết test case mô phỏng deadlock: 2 transaction lock chéo danh sách ID `[A, B]` và `[B, A]`.
  2. Tập hợp toàn bộ danh sách `artifact.id` cần khóa, loại bỏ trùng lặp và sắp xếp theo thứ tự bảng chữ cái: `const sortedIds = [...new Set(artifacts)].sort()`.
  3. Thực hiện câu query batch lock một lần duy nhất trước vòng lặp:
     ```sql
     SELECT "id" FROM "PreparationRule" WHERE "id" IN (...) ORDER BY "id" FOR UPDATE
     ```
  4. Xóa bỏ câu lệnh lock đơn lẻ trong vòng lặp.
- **Tiêu chí nghiệm thu**: Test mô phỏng deadlock chạy thành công không bị treo/fail; toàn bộ test suite của `legal-rule-catalog` vượt qua (100% GREEN).
- **Trạng thái**: [x] DONE

---

#### Task 1.2: Cách ly namespace phân vùng cho `pg_advisory_xact_lock` (A-02)
- **Mục tiêu**: Ngăn ngừa rủi ro va chạm hash 64-bit giữa advisory lock của module này với các module khác trong hệ thống.
- **File tác động**: `apps/api/src/modules/legal-rule-catalog/application/services/preparation-rule.service.ts` (dòng 128).
- **Các bước thực hiện**:
  1. Định nghĩa hằng số namespace `ADVISORY_NAMESPACE_LEGAL_RULE_PREPARATION = 0x4c435350` (`LCSP`).
  2. Cập nhật câu lệnh gọi khóa 2 tham số (32-bit namespace + 32-bit hashtext):
     ```sql
     SELECT pg_advisory_xact_lock(${ADVISORY_NAMESPACE_LEGAL_RULE_PREPARATION}, hashtext(${actor}:${request.idempotencyKey}))
     ```
  3. Viết unit test xác nhận tính tuần tự và giải phóng lock đúng khi transaction kết thúc.
- **Tiêu chí nghiệm thu**: Kiểm thử idempotent submit chạy thành công, không chặn nhầm các lock khác.
- **Trạng thái**: [x] DONE

---

#### Task 1.3: Chuẩn hóa ký tự xuống dòng (CRLF/LF) khi đối chiếu `contentSha256` (C-01)
- **Mục tiêu**: Đảm bảo không bị từ chối `INELIGIBLE` sai lệch khi nội dung trích dẫn văn bản chứa ký tự xuống dòng `\r\n` (CRLF).
- **File tác động**: `apps/api/src/modules/legal-rule-catalog/application/services/legal-rule-catalog.service.ts` (dòng 1487-1488).
- **Các bước thực hiện**:
  1. Viết unit test truyền chunk có `\r\n` và hash tính theo `\n` để khẳng định lỗi ban đầu (RED).
  2. Thêm logic chuẩn hóa chuỗi trước khi tính SHA256:
     ```typescript
     const normalizedContent = chunk.content.replace(/\r\n/gu, "\n");
     ```
  3. Kiểm tra lại test case để chuyển sang GREEN.
- **Tiêu chí nghiệm thu**: Test case chunk CRLF pass, các test hydration cũ không bị ảnh hưởng.
- **Trạng thái**: [x] DONE

---

### GIAI ĐOẠN 2: TÁI CẤU TRÚC MODULE & PHÂN TÁCH TRÁCH NHIỆM

#### Task 2.1: Trích xuất Domain logic phân tích quy phạm văn bản pháp lý ra file riêng (R-02)
- **Mục tiêu**: Rút ngắn `legal-rule-catalog.service.ts` bớt hơn 460 dòng phức tạp của hàm `composeLegalSourceProvisions`.
- **File tạo mới**: `apps/api/src/modules/legal-rule-catalog/domain/legal-source-provision-composer.ts`
- **Các bước thực hiện**:
  1. Di chuyển `composeLegalSourceProvisions` và các helper phân tích chuỗi (`baseLocator`, `parseProvisionLocator`, `hierarchyText`, `hasIndependentParentContent`, `contentOf`) sang file domain mới.
  2. Viết unit test chuyên biệt `legal-source-provision-composer.spec.ts` cho từng hàm con.
  3. Import và sử dụng composer trong `LegalRuleCatalogService`.
- **Tiêu chí nghiệm thu**: Toàn bộ unit test cũ và mới của `legal-rule-source-provisions.spec.ts` pass 100%.
- **Trạng thái**: [x] DONE

---

#### Task 2.2: Gỡ bỏ Circular Dependency và gom helpers/types dùng chung (R-03)
- **Mục tiêu**: Xóa bỏ sự phụ thuộc chéo giữa `legal-rule-catalog.service.ts` và `preparation-rule.service.ts`.
- **File tạo mới**: `apps/api/src/modules/legal-rule-catalog/application/services/legal-rule-catalog-shared.ts`
- **Các bước thực hiện**:
  1. Chuyển `CatalogClient`, `catalogFailure`, `preparationInputFingerprint`, `isEligibleLegalChunkStatus` sang file shared.
  2. Cập nhật các câu lệnh import ở cả 2 service và controller.
  3. Kiểm tra bằng `pnpm knip --directory apps/api` và `pnpm --filter @lcsp/api test`.
- **Tiêu chí nghiệm thu**: Không còn cycle dependency, code compile sạch sẽ không lỗi type.
- **Trạng thái**: [x] DONE

---

#### Task 2.3: Tách các Use-case Handlers từ 2 God Services >1500 dòng (R-01)
- **Mục tiêu**: Tách các use case có transaction và quy tắc nghiệp vụ riêng khỏi service điều phối; đánh giá ranh giới theo dependency, trạng thái và khả năng kiểm thử thay vì áp ngưỡng 500 dòng cho mọi file.
- **File tác động**:
  - Tách `activate` ra `application/commands/activate-prepared-rules/{activate-prepared-rules.command.ts,activate-prepared-rules.handler.ts}`
  - Tách `importAssessmentRules` ra `application/commands/import-assessment-rules/{import-assessment-rules.command.ts,import-assessment-rules.handler.ts}`
- **Các bước thực hiện**:
  1. Tạo từng handler, chuyển logic từ service sang handler tương ứng.
  2. Bổ sung JSDoc 5 mục bắt buộc cho từng execute method.
  3. Tổ chức mỗi use case theo `application/commands/<use-case>/{<use-case>.command.ts,<use-case>.handler.ts}` như module Auth; đăng ký qua `commands/index.ts` và dispatch bằng `CommandBus` từ service hiện hữu.
  4. Chuyển selected-output validation dùng chung ra module thuần để handler không phụ thuộc ngược vào service.
  5. Đánh giá các nhóm thao tác còn lại theo transaction/đọc dữ liệu trước khi tách tiếp; không chia file cơ học theo số dòng.
- **Kết luận phạm vi**: `submit/createResult`, `regenerate/retry` và `claim/instructions/validate/complete/cancel` là các vòng đời ghi khác với publication/import; `batch/history` là truy vấn đọc. Ở catalog service, source projection, catalog mutation, list/selection và hydration/audit cũng có ranh giới riêng. Chỉ tách khi xử lý từng luồng kèm test tương ứng; không gộp vào Task 2.3 để đạt chỉ tiêu dòng. Task 3.1–3.3 tiếp tục sở hữu tối ưu list, giới hạn import và chuẩn hóa lỗi.
- **Tiêu chí nghiệm thu**: Handler sở hữu trọn transaction của use case; không có import cycle; module tests, typecheck, lint và `pnpm run check:business-logic-docs` đều qua. PostgreSQL activation integration phải chạy khi có DB test.
- **Trạng thái**: [x] DONE — hai command/handler theo cấu trúc Auth, dispatch qua CQRS và dùng chung selected-output validation; 36 unit/module tests và 2 PostgreSQL activation integration tests pass trên database disposable `127.0.0.1:55448/lcsp_r2_activation`. Typecheck, lint, architecture/import policy và business-logic-docs đều pass.

---

### GIAI ĐOẠN 3: TỐI ƯU HIỆU NĂNG & HOÀN THIỆN BẢO MẬT PRODUCTION

#### Task 3.1: Tối ưu hóa phân trang danh sách 10.000 Rules (A-01)
- **Mục tiêu**: Loại bỏ việc load toàn bộ 10.000 rules vào bộ nhớ RAM mỗi khi người dùng xem một trang danh sách 20 rules.
- **File tác động**: `legal-rule-catalog.service.ts` (hàm `list`).
- **Các bước thực hiện**:
  1. Phân tích các điều kiện lọc `state`: `PREPARED`, `RUNNING`, `STALE`, `INELIGIBLE`.
  2. Xây dựng câu query đếm và phân trang trực tiếp ở database bằng Prisma hoặc Raw SQL có kết hợp subquery kiểm tra trạng thái run mới nhất.
  3. Chỉ áp dụng tính toán chi tiết cho đúng số lượng item của trang hiện tại (`pageSize = 20/50`).
- **Tiêu chí nghiệm thu**: Hàm `list` không còn gọi `take: 10000`, thời gian phản hồi API giảm mạnh, RAM duy trì ổn định.
- **Trạng thái**: [ ] Chưa bắt đầu

---

#### Task 3.2: Giới hạn batch size và chống giữ transaction connection DB 60s (A-03)
- **Mục tiêu**: Bảo vệ connection pool của cơ sở dữ liệu không bị cạn kiệt (pool starvation) khi import nhiều quy tắc.
- **File tác động**: `preparation-rule.service.ts` (hàm `importAssessmentRules`).
- **Các bước thực hiện**:
  1. Thêm validation chặn số lượng item tối đa trong một lần import (ví dụ: tối đa 100 items/request).
  2. Giảm transaction timeout xuống mức an toàn (ví dụ: 15-20s thay vì 60s).
- **Tiêu chí nghiệm thu**: Không có transaction nào giữ lock quá lâu, kiểm thử import với file lớn bị từ chối hợp lệ bằng mã lỗi 422 rõ ràng.
- **Trạng thái**: [ ] Chưa bắt đầu

---

#### Task 3.3: Chuẩn hóa mã lỗi và bảo vệ schema nội bộ trong response 422 (S-02)
- **Mục tiêu**: Tránh phơi bày cấu trúc JSON path chi tiết của các model AI ra client ngoài.
- **File tác động**: `preparation-rule.service.ts` (hàm `rejectSelectedOutput`).
- **Các bước thực hiện**:
  1. Định nghĩa bảng ánh xạ từ Zod path sang mã lỗi an toàn (ví dụ: `INVALID_REQUIREMENT_LINK`, `FOREIGN_SOURCE_REF`).
  2. Chỉ trả về mã lỗi an toàn trong `problem.meta`.
- **Tiêu chí nghiệm thu**: Response khi validation fail trả về lỗi rõ nghĩa nhưng không rò rỉ cấu trúc cây domain nội bộ.
- **Trạng thái**: [ ] Chưa bắt đầu

---

## 4. Lệnh kiểm thử & Xác minh bắt buộc cho từng Task

Mỗi khi hoàn thành một task, bắt buộc phải chạy lệnh sau và kiểm tra mã thoát là 0 trước khi chuyển việc:

```bash
# 1. Chạy unit tests của module
cd apps/api && NODE_OPTIONS=--experimental-vm-modules pnpm exec jest --config ./jest.config.ts src/modules/legal-rule-catalog

# 2. Kiểm tra tài liệu nghiệp vụ chuẩn 5 mục
pnpm run check:business-logic-docs apps/api/src/modules/legal-rule-catalog

# 3. Kiểm tra Typecheck toàn diện
pnpm --filter @lcsp/contracts build && pnpm --filter @lcsp/api exec tsc --noEmit
```
