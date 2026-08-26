# LCSP Dev Story Guide

## Mục tiêu

Bộ `story-handbook/` là implementation packet developer-facing cho từng story trong `docs/planning-artifacts/epics.md`. Nó giúp dev hoặc AI coding agent vào đúng runtime, đúng authority docs và đúng verification focus trước khi động vào code.

## Ba lớp authority cần phân biệt

- `docs/implementation-artifacts/`: execution authority hiện tại của sprint. Story nào đã có file ở đây mới là story đã được kéo vào workflow create-story/dev-story chính thức.
- `docs/developer/story-handbook/`: packet tham chiếu dành cho dev, phủ kín toàn bộ backlog để giảm thời gian setup context.
- `docs/implementation/`, `docs/specs/`, `docs/product/`, `docs/architecture/`: technical authority gốc. Khi có mâu thuẫn, lớp này thắng handbook.

## Cách dùng một story packet

1. Mở file tương ứng trong `docs/developer/story-handbook/`.
2. Xem `Sprint status`, `Official execution artifact`, và `Runtime ownership` để biết story đang ở trạng thái nào và thuộc runtime nào.
3. Đọc `Primary authority docs` trước khi viết code.
4. Nếu story có related implementation units, mở task tương ứng trong `docs/implementation/tasks/modules/**`.
5. Chỉ coi story là ready để build khi sprint workflow hoặc project direction đã authorize; handbook này không tự thay đổi sprint state.

## Quy ước packet

- `Official execution artifact`: link sang `docs/implementation-artifacts/*.md` nếu story đã có story file chính thức.
- `Planning-derived packet`: story chưa có execution artifact, packet được tổng hợp từ epic + implementation authority để dev chuẩn bị đúng hướng.
- `Catalog-only tasks`: task đã có ID trong task catalog nhưng chưa có brief chi tiết; dev phải quay lại `docs/implementation/tasks/README.md` và source authority gốc.

## Guardrails cố định

- Chỉ dùng active docs; không dùng `docs/archive/**`.
- RBAC là source of truth cho authorization; UI capability không phải authority.
- Manager golden path luôn phải giữ được, Developer là optional scoped collaborator nếu docs không nói khác.
- OAuth/OIDC login và GitHub repository authorization là hai boundary riêng.
- Audit, privacy, immutability và fail-closed behavior là non-negotiable.

## Điểm bắt đầu khuyến nghị

- Story đang thực thi: `1-1-approved-account-entry-and-workspace-access`.
- Bootstrap/task catalog nền: `docs/implementation/tasks/modules/README.md`.
- Authorization foundation: `docs/implementation/tasks/modules/platform/rbac/02-evaluator-service.md`.
- Runtime summary: `docs/developer/developer-implementation-guide.md`.
