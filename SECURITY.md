# Security Policy

LCSP is a compliance-assessment platform that processes repository evidence, legal-source material, model output, authentication state, and administrative workflows. Security reports are handled as engineering incidents and should be disclosed privately.

## Supported versions

Security fixes are applied to the actively maintained `develop` branch and to the currently supported release/deployment line derived from reviewed commits. Historical commits, abandoned branches, and old local builds are not supported product versions.

## Reporting a vulnerability

**Do not open a public GitHub issue, discussion, pull request, or commit containing vulnerability details, exploit steps, credentials, customer data, or other sensitive evidence.**

Use GitHub's private security reporting flow:

- Security Advisories: https://github.com/khov4nfs/LCSP/security/advisories
- New private report/advisory: https://github.com/khov4nfs/LCSP/security/advisories/new

If the private report control is unavailable to you, contact a repository maintainer through an existing private channel and ask for a private security-reporting path before sharing technical details.

A useful report includes:

- affected component, endpoint, workflow, or commit;
- impact and realistic attack preconditions;
- the smallest safe reproduction or proof of concept;
- whether secrets, personal data, tenant data, legal-source data, or repository content may be exposed;
- affected versions/SHAs when known;
- suggested remediation or compensating controls, if available.

Do not include real third-party credentials or customer data in a proof of concept. Redact secrets and use synthetic fixtures whenever possible.

## Response targets

These are service targets, not guarantees:

| Stage | Target |
| --- | --- |
| Acknowledge private report | within 3 business days |
| Initial severity/ownership triage | within 7 business days |
| Status update after triage | at least every 14 days while open |
| Coordinated disclosure | after a fix or adequate mitigation is available |

Critical issues may be handled out of sequence when containment is more urgent than normal release flow.

## Security advisory lifecycle

Maintainers should use a **draft GitHub Security Advisory** for confirmed vulnerabilities that require coordinated remediation.

1. Keep exploit details and affected code paths private during triage.
2. Confirm scope, severity, affected versions/SHAs, and exploitability.
3. Prepare and review the fix without exposing the vulnerability publicly.
4. Add regression tests or deterministic security checks where practical.
5. Rotate or revoke exposed credentials before disclosure when applicable.
6. Request a CVE through GitHub when the issue warrants one.
7. Publish the advisory only after remediation/mitigation and release guidance are ready.
8. Link the public advisory to the fixing commit/release without publishing secrets or customer data.

Public issues may be created after disclosure for non-sensitive follow-up work, but the private advisory remains the source of truth for the vulnerability record.

## Safe-harbor expectations

Good-faith research that avoids privacy violations, service disruption, persistence, destructive actions, social engineering, and unnecessary data access is welcome. Stop testing and report privately if you encounter credentials, personal data, cross-tenant data, or production-only evidence.

This policy does not authorize testing against infrastructure or accounts that the reporter does not own or have permission to test.

## In scope

Security reports may concern, among other areas:

- authentication, sessions, OAuth, authorization, PBAC/RBAC boundaries, and Admin operations;
- tenant isolation and cross-assessment/cross-customer access;
- repository connections, tokens, snapshots, evidence handling, and commit pinning;
- legal-source and Compliance Rule Set provenance/integrity;
- provider credentials, model routing, usage attribution, and fallback behavior;
- prompt injection, tool misuse, RAG/vector-store isolation, MCP/agent boundaries, and unsafe model-output handling;
- the internal Agent Runtime, checkpoints, cancellation, activity/event transport, and human approval boundaries;
- API, database, migrations, queues, logging, observability, and production configuration;
- dependency, container, CI/CD, and software-supply-chain weaknesses in LCSP-owned code/configuration.

## Out of scope

Third-party model providers, identity providers, repository hosts, payment services, package registries, and hosting platforms are outside LCSP's control unless the report demonstrates a vulnerability in LCSP's integration or configuration.

Do not perform denial-of-service testing, destructive data modification, credential stuffing, phishing/social engineering, or broad automated scanning against systems you do not own.

## Secret management

Provider keys and deployment credentials are environment-managed secrets and must never be committed or copied into issues, PRs, logs, activity streams, screenshots, test artifacts, or reports.

Sensitive values include, but are not limited to:

- `APX_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `GEMINI_API_KEY`, and `INCEPTION_API_KEY`;
- repository/OAuth tokens and client secrets;
- encryption/signing keys and webhook secrets;
- database URLs and passwords;
- worker/runtime credentials and deployment keys.

A comma-separated `APX_API_KEY` pool is entirely secret material; every slot and the complete value must be protected.

## Application trust boundaries

### Model routing

Canonical provider identity and transport protocol are separate. Trusted, source-controlled model-route configuration determines provider identity, protocol, model, and allowed options. User input and model output are not trusted routing configuration and must not provide credentials, endpoints, or privileged headers.

### Agent Runtime

Agents and models perform semantic reasoning. The API/domain layer owns persisted lifecycle state, authorization, validation, privileged transitions, and human-approval requirements. Model output is not authoritative merely because it was produced by an approved model.

### Repository and evidence inputs

Fetched repository content, legal-source material, uploaded evidence, external web content, and model/tool output are untrusted inputs. They must not gain execution or authorization authority simply by being included in agent context.

### Tenant and assessment isolation

Assessment, repository, vector/RAG, evidence, checkpoint, and report access must remain bound to server-owned tenant/user/assessment identity. Client-supplied identifiers are selectors, not authorization grants.

## Database and migrations

Prisma migrations are source-controlled. Do not rewrite historical applied migrations or place secrets in migration files. Production schema/data changes must use reviewed, auditable workflows with explicit destructive-change and rollback consideration.

## Logging and observability

Logs may contain non-secret technical metadata, correlation identifiers, provider/model/protocol identity, and safe fingerprints. Raw credentials, tokens, sensitive prompt payloads, private repository data, and customer evidence must not be emitted unnecessarily.

## Dependency and CI security

`pnpm-lock.yaml` and `deepagents/uv.lock` are dependency authorities. Dependency and CI changes must remain reviewable and reproducible.

The repository security baseline includes:

- Dependabot for npm/pnpm, Python, GitHub Actions, and Docker dependency updates;
- Dependency Review on pull requests to prevent newly introduced high/critical vulnerable dependencies;
- CodeQL for JavaScript/TypeScript and Python semantic analysis;
- Trivy repository/dependency/config/secret scanning;
- SecureAI-Scan for AI/LLM/MCP/RAG-specific risks;
- Trustabl for agent-framework reliability findings;
- SonarQube analysis when repository Sonar variables/secrets are configured;
- Codecov coverage reporting for generated test coverage.

Security scanners supplement LCSP's domain-specific release gates; they do not replace authorization, legal-source integrity, lifecycle, tenant-isolation, or human-in-the-loop tests.

## Production deployment

Deploy only reviewed source and verify the exact target SHA. Keep secrets outside Git, scope service restarts to the intended release, and do not mutate unrelated/shared infrastructure as part of an LCSP deployment.

## Security limitations

LCSP assists compliance assessment; it is not a legal authority, certification service, or proof that a target system is secure. Model output can be incorrect and requires application validation and human review. External provider availability, security, and quota remain external dependencies.
