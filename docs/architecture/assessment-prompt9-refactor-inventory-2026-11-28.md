# Prompt 9 — inventory và điều kiện mở refactor

Ngày đối chiếu: 28/11/2026. Đây là inventory chuẩn bị; chưa thực hiện refactor.

## Điều kiện mở

`assessment-antigravity-work-package-prompts.md` yêu cầu chỉ chạy Prompt 9 khi Work Package 1–8 hoàn tất và GREEN. WP8/A3 còn thiếu khôi phục response đã thanh toán xuyên qua crash/checkpoint và causation có bằng chứng cho `ModelOutputEvaluation`; G-01..G-07 cũng chưa GREEN về vận hành. Vì thế chưa sửa production cho ASM-10/20/21/22 trong lát cắt này. Khi A3 và A4 đạt GREEN kỹ thuật, mở từng lát cắt Prompt 9 bằng characterization test hiện hữu, giữ nguyên behavior/API, rồi chạy lại test và import/architecture checks.

## Candidate đầu tiên: ASM-21 runtime authority

- `apps/api/src/modules/assessment/application/services/assessment-runtime-authority.service.ts`: 1.561 dòng, đang có test `assessment-runtime-authority.service.spec.ts` đạt **7/7** với Jest scoped và `NODE_OPTIONS=--experimental-vm-modules` (28/11). Đây là ứng viên refactor tách các phép kiểm tra thuần khỏi orchestration giao dịch; cần thêm characterization cho nhánh được chọn trước khi đổi code.
- Không sửa cấu trúc transaction, thứ tự khóa hoặc lỗi nghiệp vụ nếu chưa có assertion bảo toàn tương ứng. File này hiện cũng dirty; diff hiện hữu phải được bảo toàn.

## Các candidate tiếp theo

- **ASM-10:** Tìm literal audit/error/event cụ thể rồi đối chiếu canonical constants trong `packages/contracts` trước khi thay từng nhóm. Không thay chuỗi persistence hay wire value chỉ vì giống tên.
- **ASM-20:** Có 42 file `.ts` production trong `application/` của Assessment import `@prisma/client` hoặc `PrismaService`. Chọn một query/handler độc lập, tạo port hoặc UoW nhỏ và test boundary trước; không chuyển toàn bộ module cùng lúc.
- **ASM-21 PDF:** `assessment-pdf-renderer.service.ts` có 500 dòng và suite 21 test. Trong sandbox hiện tại 4 pass, 17 fail do Chromium không khởi chạy được; đây là giới hạn môi trường, chưa chứng minh regression. Cần baseline chạy browser ở môi trường có quyền trước khi refactor PDF.
- **ASM-22:** Chỉ xóa API/DI sau khi xác minh call sites và runtime registration; các mục root-capacity/browser coverage là QA/tooling riêng, không suy ra dead code từ static search đơn lẻ.

## Bằng chứng và giới hạn

Graphify query chỉ trả candidate relationships, không chứng minh runtime behavior. Các số file và dòng trên được kiểm tra trực tiếp ở source. Không có production file nào được sửa trong inventory này; không commit/push/PR.
