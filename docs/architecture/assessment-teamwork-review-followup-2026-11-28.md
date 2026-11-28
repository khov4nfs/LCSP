# Đối chiếu review Teamwork và xử lý tiếp Assessment — 28/11/2026

## Kết luận

Teamwork review đã phát hiện thêm lỗi thật ngoài báo cáo qua đêm. Các lỗi tài chính và test E2E được xử lý theo RED → GREEN trên PostgreSQL test chuyên dụng `127.0.0.1:55434/lcsp_api_e2e`. Không dùng `lcsp_local` để ghi test. `MODEL_USAGE_DEBIT=OFF` và `PROVIDER_RECONCILIATION_AUTOMATED_RELEASE=OFF` vẫn là ranh giới vận hành; G-01..G-07 chưa GREEN. Không commit/push/PR.

## Finding được xác minh và xử lý

| Finding | Root cause | Fix | Bằng chứng |
| --- | --- | --- | --- |
| Customer usage có bucket giá `UNSUPPORTED` trả HTTP 500 | Chỉ nhánh platform được chặn; calculator ném typed incomplete-rate error ở customer. | Đưa cả hai funding principal vào đường fail-closed và bắt riêng lỗi pricing thiếu rate; ghi `OUTCOME_UNKNOWN` + `INTEGRITY_REVIEW`, giữ slot/exposure, không tạo receipt/debit. | Phase C E2E RED 500 → GREEN; suite 14/14. |
| Token `0` được lưu thành `null` | Receipt dùng truthy check. | Kiểm tra `undefined` thay vì truthiness. | E2E RED `null` → GREEN `0n`. |
| Cache write 5 phút/1 giờ bị mất | Request schema không khai báo hai bucket dù calculator và DB có hỗ trợ. | Thêm vào contract, fingerprint, calculator input và receipt. | Contract RED → GREEN 2/2; E2E RED 500 → GREEN. |
| Pricing E2E không khởi tạo được fixture | Bảng reconciliation mới giữ foreign key tới admission; test reset chưa dọn bảng này. | Dọn rõ bảng liên quan theo thứ tự, không dùng `CASCADE` tràn phạm vi. | E2E RED PostgreSQL `0A000` → GREEN. |
| Assessment list/get E2E Admin kỳ vọng cũ | Test còn kỳ vọng `[]`/404, trái thiết kế Admin metadata-only đã duyệt. | Kiểm tra chính xác metadata allowlist; giữ BOLA và cấm trường dữ liệu khách hàng. | Ba suite pricing/list/get 19/19 GREEN. |
| Route Admin no-usage cũ thiếu action guard và ghi `resolvedBy: "admin"` | Route mới có quyền quyết định đối soát, route cũ chỉ có role Admin; handler không nhận principal. | Gắn `reconciliationDecision`, truyền user ID đã xác thực vào command/transaction; bảo toàn request correlation ID và validate case ID ở route đọc/quyết định. | Controller test RED → GREEN 3/3; focused legacy 3C E2E xác nhận `resolvedBy` là user ID. |

## Finding chưa thể đóng bằng một bản vá ngắn

- **81 test Python legacy ban đầu:** Phần lớn fixture giả định local admission và thiếu `runId`/lease/server request, nên fail-closed `MISSING_EXECUTION_CONTEXT` là hành vi production đúng. Không nới guard để làm test xanh. Đã chuyển ba test `test_usage_metering.py` tiêu biểu (còn 26 lỗi) và cả năm test gãy của `test_physical_admission_wiring.py` sang fixture server-issued admission (suite này 18/18 GREEN). Còn **73 lỗi** từ `test_usage_metering.py` (26), `test_paid_admission.py` (46) và `test_durable_physical_admission.py` (1) cần migration theo chức năng hoặc chứng minh parity trước khi retire. Test server admission 19/19 và runner 6/6 vẫn GREEN.
- **Provider reconciliation key authority:** Public key nằm trong Map của process; `generateAndRegisterProviderKeyPair` vẫn hiện diện ở runtime service. Đây là khoảng trống vận hành/kiến trúc, không phải bằng chứng có exploit từ HTTP hiện tại. Giữ automated release OFF cho đến khi có kho khóa được kiểm toán và kiểm chứng khởi động lại/rotation.
- **ModelOutputEvaluation:** Chưa có writer mang `invocationId` vật lý xuyên qua retry/fallback. Đề xuất callback của Teamwork là một phương án, chưa phải quyết định đã được chấp thuận; không tự triển khai khi chưa chốt nguồn phán quyết và quy tắc replay.
- **Admin UI:** Mới có queue/detail chỉ đọc. Chưa có mutation UI và chưa nghiệm thu trình duyệt thực. Browser host hiện vẫn unavailable; không ghi nhận frontend gate GREEN.
- **G-01..G-07:** Vẫn cần bằng chứng pricing được duyệt, security signoff, rehearsal cutover/rollback, telemetry thực tế, full Root trace, key/recovery operations và nghiệm thu UI; test xanh cục bộ không thay thế các điều kiện đó.

## Lưu ý về chất lượng

Teamwork phát hiện **254** lỗi lint ở settlement handler và E2E, gồm **206** lỗi định dạng và **48** lỗi kiểu/biến. Sau khi xử lý riêng từng file, scoped ESLint của cả hai đạt **0 lỗi**. API typecheck và Phase C E2E chạy lại đạt **14/14**. Một lần chạy trước đó đạt 12/14 vì Supertest nhận HTML Antigravity và `ECONNRESET`; các lỗi này không phải assertion settlement và đã không lặp lại. Formatter làm diff của handler rộng hơn bản vá logic (320 dòng thêm/83 dòng xóa so với HEAD vốn đã dirty); cần review diff khi chọn file để commit sau này.
