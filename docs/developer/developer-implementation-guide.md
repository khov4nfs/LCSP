# LCSP Developer Implementation Guide

## Mục tiêu

Tài liệu này gom entrypoint thực dụng cho developer: runtime shape, read order, task/stories crosswalk, và cách chuyển từ planning sang implementation mà không lẫn lộn authority.

## Canonical runtime shape

- `apps/web`: Next.js frontend cho Manager/Developer workspace.
- `apps/api`: NestJS synchronous control plane cho auth, PBAC, state validation, audit, durable async work creation.
- `deepagents`: mọi workload async cho scanner, profile, legal, classification, documents.
- `packages/*`: shared contracts, DTOs, helpers, policies, schema fragments.
- `RabbitMQ + outbox`: choreography async.
- `PostgreSQL`, `ChromaDB`, `S3-compatible storage`: persistence lanes chính.

## Read order ngắn nhất

1. `docs/project-context.md`
2. `docs/implementation/dev-compendium.md`
3. `docs/implementation-artifacts/sprint-status.yaml`
4. `docs/developer/dev-story-guide.md`
5. `docs/implementation/tasks/modules/**` hoặc `docs/developer/story-handbook/` theo execution unit đang làm
6. `docs/implementation-artifacts/<story-key>.md` nếu story đã có official execution artifact

## Story packet coverage

- Toàn bộ story từ Epic 1 đến Epic 8 đã có packet tại `docs/developer/story-handbook/`.
- Toàn bộ story từ Epic 1 đến Epic 8 hiện đã có official execution artifact tương ứng trong `docs/implementation-artifacts/`.
- Source of truth cho trạng thái thực thi là `docs/implementation-artifacts/sprint-status.yaml` cộng với từng file story artifact trong `docs/implementation-artifacts/`.
- `docs/developer/story-handbook/` là lớp điều hướng cho developer; nó không thay thế execution artifact chính thức.

## Task handbook coverage

- Đã tạo handbook cho các brief đã tồn tại: `module task catalog`, `MW-pbac-002`, `MW-scan-001`, `MW-pyp-001`, `MW-scan-py-001`, `MW-scan-py-004`, `MW-intel-001`, `MW-intel-002`, `MW-intel-004`.
- Các task còn lại vẫn ở mức catalog; xem `docs/implementation/tasks/README.md` để lấy dependency chain.

## Epic-to-task crosswalk

- Epic 1: `module task catalog`, `MW-pbac-002`, catalog `auth-workspace module tasks`.
- Epic 2: catalog `assessment module tasks`, `wizard module tasks`, `web module tasks`, `web/qa module tasks`.
- Epic 3: `MW-scan-001`, `MW-pyp-001`, `MW-scan-py-001`, `MW-scan-py-004`, catalog `github-integration module tasks`, `MW-scan-py-002..MW-scan-py-012`, `MW-scan-py-007`, `web module tasks`.
- Epic 4: `MW-intel-001`, `MW-intel-002`.
- Epic 5: `MW-intel-004`, catalog `auth-workspace invitation module tasks`.
- Epic 6: catalog `module task catalog range`.
- Epic 7: catalog `MW-llm-001`, `MW-cls-py-001`.
- Epic 8: catalog `module task catalog range`, `MW-qa-003`, `QA negative-path module coverage`.

## Working rules cho dev và AI agent

- Dùng handbook để định vị phạm vi, nhưng trích source authority gốc khi triển khai.
- Nếu story đụng auth/PBAC/audit/privacy/state gates, phải ưu tiên negative-path tests thay vì chỉ happy path.
- Nếu story đụng scanner/legal/LLM, phải kiểm tra rõ runtime owner trước khi viết code để tránh kéo logic async vào `apps/api`.
- Không dùng `docs/implementation/tasks/README.md` như bằng chứng sprint authorization cho story-level execution; task catalog vẫn là planning artifact.
- Trước khi bắt đầu execution thực tế, luôn đối chiếu `docs/implementation-artifacts/sprint-status.yaml` và file `docs/implementation-artifacts/<story-key>.md` của story đang làm.
