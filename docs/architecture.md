# LCSP Workspace Architecture

**Ngày quét:** 2026-06-26T11:32:20+07:00
**Phạm vi:** Kiến trúc của repository hiện tại, không thay thế `docs/architecture/architecture.md`

## Tóm tắt

## Web state management

- TanStack Query quản lý server state: workspace, assessments, documents và readiness; mutation phải invalidate query liên quan.
- Zustand chỉ quản lý shared UI state: assessment được chọn, sidebar, filter/sort và Wizard draft chưa gửi.
- React Hook Form + Zod quản lý validation cho sign-up, sign-in, create assessment và Wizard.

Repository này được tổ chức như một workspace quản trị tri thức và automation support cho LCSP. Nó có ba lớp rõ ràng: tài liệu authority, tài liệu tóm lược/onboarding, và script/config hỗ trợ BMAD/WDS. Kiến trúc này tối ưu cho planning, review và AI context injection trước khi implementation runtime tồn tại.

## Boundary kiến trúc

- **Tài liệu sản phẩm LCSP mục tiêu**
  Được mô tả trong `docs/product/`, `docs/specs/`, `docs/architecture/`, `docs/implementation/`.
- **Kiến trúc của chính workspace**
  Được mô tả trong file này.
- **Runtime sản phẩm thật**
  Hiện chưa bootstrap trong repo; chỉ xuất hiện dưới dạng tài liệu và planned commands.

## Các thành phần chính

| Thành phần                        | Vai trò                                                                             | Giao tiếp với                          |
| --------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------- |
| `docs/`                           | Active authority cho behavior, constraints, architecture và implementation planning | Con người, AI agents, review workflows |
| `docs-vn/`                        | Tóm lược tiếng Việt để onboarding/review nhanh                                      | Người đọc, nhóm triển khai             |
| `_bmad/scripts/`                  | Resolve config và customization theo nhiều lớp override                             | BMAD skills/workflows, shell users     |
| `_bmad/wds/scripts/`              | Scaffold/validate tài liệu WDS theo cấu trúc cố định                                | WDS agents, designers                  |
| `.github/copilot-instructions.md` | Instruction note cho tooling hỗ trợ                                                 | Copilot/Context-aware tooling          |
| `RTK.md` + `AGENTS.md`            | Điều khiển hành vi agent và shell conventions                                       | AI coding agents                       |
| `demo /`                          | Placeholder cho prototype hoặc future code areas                                    | Chưa có integration thực chất          |

## Pattern kiến trúc

### 1. Authority-first documentation

- `docs/README.md` định nghĩa read order và single sources of truth.
- Active docs trong `docs/` thắng mọi material lịch sử trong `docs/archive/`.
- `docs-vn/` chỉ là summary layer, không phải authority layer.

### 2. Planning-before-implementation

- Implementation details được mô tả trong `docs/implementation/`.
- Các câu lệnh dev/test/build trong docs là planned contracts.
- Repo nhấn mạnh `IMPLEMENTATION_NOT_AUTHORIZED` khi readiness chưa hoàn tất.

### 3. Automation as structure enforcement

- Python scripts trong `_bmad/scripts/` đảm bảo merge config/customization có thể lặp lại và không phụ thuộc package ngoài.
- Node scripts trong `_bmad/wds/scripts/` đảm bảo agent không tự viết markdown WDS tùy tiện mà đi qua scaffold chuẩn hóa.

## Dữ liệu và artifact flow trong workspace

```text
Authoritative intent
-> docs/product + docs/specs
-> docs/architecture + docs/implementation
-> docs-vn summaries / planning artifacts / test artifacts
-> BMAD/WDS config + scripts use those docs as context
-> AI agents and humans consume the same source-of-truth chain
```

## Entry points của workspace

- **Người đọc mới:** `docs/README.md`
- **Người đọc tiếng Việt:** `docs-vn/README.md`
- **Người sửa config BMAD:** `_bmad/scripts/resolve_config.py`
- **Người sửa skill customization:** `_bmad/scripts/resolve_customization.py`
- **Người làm WDS scaffolding:** `_bmad/wds/scripts/README.md`

## Thành phần kỹ thuật hiện có

### Python utility layer

- `resolve_customization.py`
  Merge ba lớp TOML cho từng skill.
- `resolve_config.py`
  Merge bốn lớp cấu hình BMAD.
- `tests/test_resolve_customization.py`
  Bằng chứng tối thiểu cho logic merge customization.

### Node.js utility layer

- `wds-init-scenario.js`
- `wds-init-page.js`
- `wds-nav.js`
- `wds-add-object.js`
- `wds-add-spacing.js`
- `wds-validate.js`

Các script này dùng Node.js stdlib, không có dependency manifest đi kèm trong repo hiện tại.

## Rủi ro và giới hạn

- Không có application runtime để xác minh rằng planned architecture trong `docs/architecture/architecture.md` đã được hiện thực hóa.
- `demo /` có thư mục nhưng chưa có code đủ nghĩa để xem như execution boundary.
- Thiếu package manifests làm cho reproducible local setup cho phần utility scripts dựa trên giả định môi trường có sẵn.

## Tác động cho brownfield planning

- Mọi đề xuất implementation phải bắt đầu từ authority docs, không phải từ source code hiện có.
- Nếu bắt đầu bootstrap code, cần tài liệu hóa rõ khoảng cách giữa “planned runtime” và “actual repo state”.
- Các AI agents nên dùng file này để hiểu repo hiện tại, rồi chuyển sang `docs/architecture/architecture.md` để hiểu hệ thống LCSP mục tiêu.

## Testing và validation hiện có

- Có test Python ở `_bmad/scripts/tests/test_resolve_customization.py`.
- Có script `wds-validate.js` để kiểm tra tính đúng cấu trúc của WDS page specs.
- Không có suite test tổng thể cho runtime sản phẩm vì runtime đó chưa có trong repo.

---

_File này mô tả kiến trúc của workspace hiện hữu. Kiến trúc hệ thống LCSP mục tiêu vẫn nằm ở `docs/architecture/architecture.md`._
