# LCSP Documentation Index

**Loại kho mã:** Monolith documentation-first workspace
**Ngôn ngữ chính:** Markdown, Python, JavaScript, YAML, TOML, JSON
**Kiến trúc workspace:** Tài liệu authority + automation hỗ trợ BMAD/WDS
**Cập nhật lần cuối:** 2026-06-26T11:32:20+07:00

## Tổng quan

Repository này hiện là workspace tài liệu brownfield cho LCSP, không phải codebase ứng dụng đã bootstrap hoàn chỉnh. Phần có authority nghiệp vụ và kiến trúc nằm trong `docs/`; phần tóm lược tiếng Việt nằm trong `docs-vn/`; phần automation hỗ trợ tạo context, resolve config và scaffold WDS nằm trong `_bmad/` và `.github/`. Runtime sản phẩm được mô tả chi tiết trong tài liệu, nhưng mã nguồn thực thi cho `apps/web`, `apps/api`, `deepagents` và `tools/ts-js-analyzer` chưa hiện diện trong repo này.

## Quick Reference

- **Mục tiêu repo:** Duy trì source of truth cho product, specs, architecture và implementation planning của LCSP.
- **Entry point cho người đọc:** [README.md](./README.md)
- **Entry point cho AI/brownfield planning:** [project-overview.md](./project-overview.md)
- **Authority kiến trúc hệ thống LCSP:** [architecture/architecture.md](./architecture/architecture.md)
- **Authority implementation planning:** [implementation/README.md](./implementation/README.md)
- **Tóm lược tiếng Việt:** [../docs-vn/README.md](../docs-vn/README.md)

## Tài liệu được tạo/cập nhật từ lần quét này

### Tài liệu brownfield cho workspace

- [Project Overview](./project-overview.md) - Tóm tắt phạm vi, phân loại repo và stack thực có trong workspace
- [Architecture](./architecture.md) - Kiến trúc của chính workspace tài liệu và automation support
- [Source Tree Analysis](./source-tree-analysis.md) - Phân tích cây thư mục và vai trò từng vùng
- [Development Guide](./development-guide.md) - Cách làm việc với repo, script và boundary hiện tại

### Tài liệu authority hiện có

- [README.md](./README.md) - Cửa vào chuẩn cho toàn bộ tài liệu active
- [product/system-context.md](./product/system-context.md) - Actor, boundary và golden path
- [product/product-brief.md](./product/product-brief.md) - Mục tiêu sản phẩm và scope active MVP
- [product/prd.md](./product/prd.md) - Yêu cầu sản phẩm authoritative
- [product/business-rules.md](./product/business-rules.md) - Business rules authoritative
- [specs/functional-requirements.md](./specs/functional-requirements.md) - FR canonical
- [specs/non-functional-requirements.md](./specs/non-functional-requirements.md) - NFR canonical
- [specs/use-cases.md](./specs/use-cases.md) - Use cases active
- [specs/domain-model.md](./specs/domain-model.md) - Domain model
- [specs/domain-state-machines.md](./specs/domain-state-machines.md) - State machine và gates
- [specs/event-catalog.md](./specs/event-catalog.md) - Event contracts
- [architecture/architecture.md](./architecture/architecture.md) - Kiến trúc hệ thống LCSP
- [architecture/adr/architecture-decision-records.md](./architecture/adr/architecture-decision-records.md) - Catalog ADR active
- [implementation/README.md](./implementation/README.md) - Hub implementation planning

## Cấu trúc repo

### Workspace sections

- **`docs/`**: Bộ tài liệu authority active cho product, specs, architecture, implementation và test artifacts
- **`docs-vn/`**: Bộ tóm lược tiếng Việt để onboarding/review nhanh
- **`_bmad/`**: Config, manifest, script resolver và WDS scaffold support
- **`.github/`**: Copilot instruction layer
- **`demo /`**: Khung prototype rỗng cho `rag/` và `scanner/`; chưa chứa runtime source đáng kể
- **`design-artifacts/`**: Nơi dự kiến chứa thiết kế WDS; hiện chưa có inventory active đáng kể

## Hướng đọc nhanh

1. Đọc [README.md](./README.md) để nắm authority chain.
2. Đọc [project-overview.md](./project-overview.md) để hiểu repo thực sự chứa gì và chưa chứa gì.
3. Đọc [architecture.md](./architecture.md) nếu cần sửa chính workspace tài liệu/automation.
4. Đọc [architecture/architecture.md](./architecture/architecture.md) nếu cần hiểu hệ thống LCSP được thiết kế như thế nào.
5. Đọc [implementation/README.md](./implementation/README.md) khi chuẩn bị planning hoặc readiness work.

## Gợi ý cho AI-assisted development

- **Khi sửa tài liệu authority:** bắt đầu từ `docs/README.md`, rồi đi vào `product/`, `specs/`, `architecture/`, `implementation/`.
- **Khi sửa automation BMAD/WDS:** tham chiếu [architecture.md](./architecture.md), [source-tree-analysis.md](./source-tree-analysis.md) và [development-guide.md](./development-guide.md), sau đó đọc trực tiếp `_bmad/scripts/` hoặc `_bmad/wds/scripts/`.
- **Khi planning feature cho sản phẩm LCSP:** dùng `docs/index.md` này làm entry point, nhưng authority hành vi hệ thống vẫn nằm ở `docs/architecture/architecture.md`, `docs/specs/`, và `docs/implementation/`.

## Khoảng trống hiện tại

- Repo chưa chứa bootstrap code cho `apps/web`, `apps/api`, `deepagents`, hoặc `tools/ts-js-analyzer`.
- Không có API contracts, data models, component inventory hay deployment guide ở mức codebase thực thi, vì implementation chưa hiện diện trong workspace này.
- Mọi lệnh phát triển trong tài liệu implementation hiện là planned contracts, không phải bằng chứng runtime đã tồn tại.
