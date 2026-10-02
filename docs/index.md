# LCSP Documentation Index

LCSP is an implemented monorepo with a Next.js web application, NestJS API, shared packages, and a self-hosted Deep Agents / LangGraph runtime. Product and architecture authority lives under `docs/`; `docs-vn/` provides the Vietnamese summary layer.

## Primary entry points

- [README.md](./README.md) — documentation authority and reading order.
- [product/system-context.md](./product/system-context.md) — actors, system boundary, and golden path.
- [product/prd.md](./product/prd.md) — product requirements.
- [specs/](./specs/) — canonical functional, non-functional, domain, event, and evidence contracts.
- [architecture/architecture.md](./architecture/architecture.md) — system architecture.
- [architecture/repository-deep-agent-analysis.md](./architecture/repository-deep-agent-analysis.md) — self-hosted Repository Deep Agent analysis architecture.
- [implementation/README.md](./implementation/README.md) — implementation guidance and operational boundaries.
- [../docs-vn/README.md](../docs-vn/README.md) — Vietnamese overview.

## Runtime map

- `apps/web` — Next.js Manager-facing application.
- `apps/api` — NestJS synchronous control plane and persistence boundary.
- `deepagents` — native Deep Agents / LangGraph runtime, repository analysis, assessment reasoning, legal/recovery/reporting workloads, and Docker sandbox integration.
- `packages` — shared contracts, i18n, and supporting packages.
- `likec4` — architecture model and generated-view source.
- `scripts` — repository development/release/validation utilities.

Repository analysis is performed by the Repository Deep Agent on the assessment-scoped managed repository workspace. The retired language-specific scanner/toolchain is not part of the active runtime. Codebase Memory MCP is an optional structural index and relationship aid; inspected repository source remains the evidence authority.
