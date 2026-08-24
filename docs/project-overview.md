# LCSP - Project Overview

**Ngày quét:** 2026-06-26T11:32:20+07:00
**Loại dự án:** Documentation-first brownfield workspace
**Kiến trúc:** Authority documents + planning artifacts + BMAD/WDS automation support

## Tóm tắt điều hành

LCSP trong repository này là một workspace tập trung vào tài liệu authoritative và planning artifacts cho Legal Compliance Support Platform. Repo mô tả sản phẩm, kiến trúc hệ thống mục tiêu, quyết định thiết kế, implementation plan và hướng dẫn readiness; nó chưa phải monorepo ứng dụng đã triển khai đầy đủ các runtime được mô tả trong tài liệu.

## Phân loại dự án

- **Repository type:** Monolith
- **Project type thực tế:** Workspace tài liệu và automation support
- **Project type gần đúng theo scan guide:** gần với `library` hơn `web/backend`, nhưng được điều chỉnh bằng phán đoán vì không có runtime source app hiện hữu
- **Ngôn ngữ chính:** Markdown, Python 3, JavaScript chạy bằng Node.js stdlib, YAML, TOML, JSON
- **Kiểu kiến trúc:** Documentation-first, authority-driven, planning-before-implementation

## Phần chính của repo

### Workspace hiện hữu

- **`docs/`**
  Chứa active authority cho product context, business rules, FR/NFR, domain specs, architecture, implementation planning và test artifacts.
- **`docs-vn/`**
  Chứa bản tóm lược tiếng Việt theo chủ đề để onboarding, review và tạo shared understanding nhanh.
- **`_bmad/`**
  Chứa cấu hình BMAD, module config, script resolve customization/config và WDS support scripts.
- **`.github/`**
  Chứa instruction hỗ trợ Copilot.
- **`demo /`**
  Chứa khung `rag/` và `scanner/`, nhưng hiện chưa có source runtime có ý nghĩa để tài liệu hóa như một application part.

## Tóm tắt stack công nghệ

| Nhóm | Công nghệ | Phiên bản | Bằng chứng |
|---|---|---|---|
| Documentation | Markdown | N/A | `docs/`, `docs-vn/` là nguồn chính của repo |
| Config | YAML, TOML, JSON | N/A | `_bmad/*/config.yaml`, `_bmad/config.toml`, `.mcp.json` |
| Automation scripts | Python | 3.11+ | `_bmad/scripts/resolve_customization.py` và `_bmad/scripts/resolve_config.py` dùng `tomllib` |
| UX scaffolding scripts | Node.js stdlib JavaScript | Không pin trong repo | `_bmad/wds/scripts/*.js` chỉ dùng `node:fs`, `node:path` |
| Context tooling | RTK, BMAD/WDS | Theo workspace tooling | `RTK.md`, `.github/copilot-instructions.md`, `_bmad/` |

## Đặc điểm kiến trúc nổi bật

- Repo ưu tiên authority documents hơn source implementation.
- Hành vi sản phẩm LCSP được đóng đinh bằng tài liệu trong `docs/`, đặc biệt `product/`, `specs/`, `architecture/` và `implementation/`.
- Automation code trong repo phục vụ việc resolve config, scaffold tài liệu và giữ kỷ luật cấu trúc, không phải runtime của sản phẩm LCSP.
- `demo /` hiện chỉ là placeholder cho các hướng prototype, chưa đủ điều kiện để tạo architecture/api/data-model docs riêng cho code.

## Khả năng hiện có

- Cung cấp bộ source of truth đủ dày cho brownfield planning và AI-assisted analysis.
- Cung cấp các script Python để merge/resolve cấu hình BMAD theo nhiều lớp override.
- Cung cấp các script Node.js để scaffold và validate WDS page specs có cấu trúc.
- Cung cấp inventory planning, implementation task, handoff và readiness artifacts cho giai đoạn trước coding.

## Điều repo chưa cung cấp

- Không có bootstrap source cho `apps/web`, `apps/api`, `deepagents`.
- Không có manifest package/runtime chuẩn như `package.json`, `pyproject.toml`, `requirements.txt` ở root application parts.
- Không có database schema thực thi, HTTP controllers, UI components hay deployment config để quét như một codebase production.
- Không có bằng chứng code implementation cho các lệnh phát triển được mô tả trong implementation docs.

## Tổng quan phát triển

### Điều kiện tiên quyết

- `python3` 3.11+ để chạy script resolve dùng `tomllib`
- `node` để chạy WDS scaffold scripts trong `_bmad/wds/scripts/`
- `rtk` để tương tác shell theo rule của workspace

### Cách bắt đầu

1. Đọc [README.md](./README.md).
2. Xác định mình đang sửa authority docs hay automation support.
3. Nếu sửa authority docs, đi từ `product/` và `specs/`.
4. Nếu sửa automation support, đọc `_bmad/scripts/` hoặc `_bmad/wds/scripts/`.

### Các lệnh chính

- **Resolve customization:** `rtk python3 _bmad/scripts/resolve_customization.py --skill <skill-path>`
- **Resolve config:** `rtk python3 _bmad/scripts/resolve_config.py --project-root /home/khovan/Workplaces/LCSP`
- **Đọc script guide:** `rtk sed -n '1,220p' _bmad/wds/scripts/README.md`

## Tóm tắt cấu trúc repo

Repo tách rõ ba lớp:

1. **Authority layer** trong `docs/`
2. **Reader/onboarding layer** trong `docs-vn/`
3. **Automation/tooling layer** trong `_bmad/`, `.github/` và rule files ở root

## Bản đồ tài liệu

- [index.md](./index.md) - Mục lục chính cho lần scan hiện tại
- [architecture.md](./architecture.md) - Kiến trúc của workspace tài liệu và automation
- [source-tree-analysis.md](./source-tree-analysis.md) - Phân tích thư mục và entry points
- [development-guide.md](./development-guide.md) - Hướng dẫn làm việc với repo

---

_Tạo bởi workflow `bmad-document-project` cho mục đích brownfield AI context._
