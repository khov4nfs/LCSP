import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setAppLocale } from "../src/lib/locale.ts";
import { AssessmentReportActions } from "../src/features/assessment-runtime/components/molecules/assessment-report-actions.tsx";
import { AssessmentProvenanceView } from "../src/features/assessment-runtime/components/organisms/assessment-provenance-view.tsx";
import { assessmentDomainKeys } from "../src/lib/api/assessment-domain-queries.ts";
import {
  ASSESSMENT_PROVENANCE_SCHEMA_VERSION,
  type AssessmentProvenanceArtifact,
} from "@lcsp/contracts/assessment-domain";

setAppLocale("en");

const assessmentId = "11111111-1111-4111-8111-111111111111";

const mockProvenance: AssessmentProvenanceArtifact = {
  schemaVersion: ASSESSMENT_PROVENANCE_SCHEMA_VERSION,
  assessmentId,
  name: "SOC 2 Type II Assessment",
  ownerId: "user-1",
  generatedAt: "2026-10-17T12:00:00.000Z",
  checksumSha256: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
  correlationId: "corr-test-123",
  lifecycle: {
    state: "ACTIVE",
    assessmentRevision: 2,
  },
  pins: {
    ruleSet: {
      ruleSetVersionId: "77777777-7777-4777-8777-777777777777",
      version: "2.1.0",
      legalSourceVersion: "2.1.0",
      legalRequirementCount: 15,
      assessmentRuleCount: 8,
    },
    repositorySnapshotId: "snap-123",
    repositoryScanJobId: "job-123",
    repositoryCommit: "0123456789abcdef0123456789abcdef01234567",
    pinnedAt: "2026-10-17T11:00:00.000Z",
  },
  runtime: {
    threadId: assessmentId,
    rootAgentVersion: "1.0.0",
    checkpointNamespace: assessmentId,
    checkpointId: null,
    currentExecutionId: null,
    executionState: "RUNNING",
    eventSequence: 5,
    startedAt: "2026-10-17T11:00:00.000Z",
    lastResumedAt: null,
    updatedAt: "2026-10-17T12:00:00.000Z",
  },
  acceptedFacts: [
    {
      factId: "22222222-2222-4222-8222-222222222222",
      assessmentId,
      caseRevision: 1,
      kind: "FACT",
      authority: "EVIDENCE_CITED",
      state: "ACCEPTED",
      statement: "TLS 1.3 enforced on all external endpoints.",
      evidenceIds: ["33333333-3333-4333-8333-333333333333"],
      createdAt: "2026-10-17T11:30:00.000Z",
    },
  ],
  acceptedEvidence: [
    {
      evidenceId: "33333333-3333-4333-8333-333333333333",
      assessmentId,
      type: "REPOSITORY_SOURCE",
      state: "ACCEPTED",
      repositoryCommit: "0123456789abcdef0123456789abcdef01234567",
      contentSha256: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      payload: { path: "server.conf" },
      createdAt: "2026-10-17T11:25:00.000Z",
    },
  ],
  humanResolutions: [
    {
      requestId: "55555555-5555-4555-8555-555555555555",
      requestRevision: 1,
      openedCaseRevision: 1,
      status: "RESOLVED",
      assessmentRuleId: "tls-enforcement",
      criterionIds: ["crit-1"],
      question: "Is TLS termination performed at the load balancer?",
      unresolvedFact: "TLS termination point",
      decisionImpact: ["Applies to external traffic rules"],
      resolutionAttempts: ["Scanned ingress configs"],
      controlType: "FREE_TEXT",
      choices: [],
      checkpointId: null,
      resolvedFactId: "22222222-2222-4222-8222-222222222222",
      answers: [
        {
          idempotencyKey: "ans-key-1",
          requestDigest: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          actorId: "user-1",
          caseRevision: 1,
          requestRevision: 1,
          doesNotKnow: false,
          answer: "Yes, AWS ALB terminates TLS with ACM certificates.",
          answeredAt: "2026-10-17T11:45:00.000Z",
        },
      ],
    },
  ],
  decisions: [
    {
      decisionId: "44444444-4444-4444-8444-444444444444",
      assessmentId,
      assessmentRuleId: "tls-enforcement",
      scopeId: "global",
      decisionRevision: 1,
      state: "ACCEPTED",
      decision: {
        scopeId: "global",
        assessmentRuleId: "tls-enforcement",
        assessmentRuleVersion: "1.0.0",
        ruleSetVersionId: "77777777-7777-4777-8777-777777777777",
        repositorySnapshotId: "snap-123",
        repositoryCommit: "0123456789abcdef0123456789abcdef01234567",
        caseRevision: 1,
        applicability: "APPLICABLE",
        rationale: "Endpoints verified compliant.",
        legalContextRefs: [{ legalContextId: "lc-1" }],
        references: [
          {
            type: "ASSESSMENT_EVIDENCE",
            evidenceId: "33333333-3333-4333-8333-333333333333",
          },
        ],
        criteria: [
          {
            criterionId: "crit-1",
            outcome: "MET",
            rationale: "TLS 1.3 enforced",
            references: [
              {
                type: "ASSESSMENT_EVIDENCE",
                evidenceId: "33333333-3333-4333-8333-333333333333",
              },
            ],
          },
        ],
        compliance: "COMPLIANT",
      },
      createdAt: "2026-10-17T11:50:00.000Z",
    },
  ],
  coverage: [
    {
      assessmentRuleId: "tls-enforcement",
      assessmentRuleVersion: "1.0.0",
      resolutionState: "RESOLVED",
      currentDecisionId: "44444444-4444-4444-8444-444444444444",
      decisionRevision: 1,
      concept: "TLS_CONFIGURATION",
    },
  ],
  events: [
    {
      eventId: "88888888-8888-4888-8888-888888888888",
      assessmentId,
      threadId: assessmentId,
      sequence: 1,
      timestamp: "2026-10-17T11:00:00.000Z",
      eventType: "EVIDENCE_ACCEPTED",
      actorType: "API",
      payload: {
        evidenceId: "33333333-3333-4333-8333-333333333333",
        caseRevision: 1,
      },
    },
  ],
  artifacts: [
    {
      artifactId: "66666666-6666-4666-8666-666666666666",
      kind: "FINAL_REPORT",
      lifecycleState: "ACTIVE",
      ruleSetVersionId: "77777777-7777-4777-8777-777777777777",
      repositorySnapshotId: "snap-123",
      repositoryCommit: "0123456789abcdef0123456789abcdef01234567",
      caseRevision: 1,
      contentSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      sizeBytes: 1024,
      createdAt: "2026-10-17T11:55:00.000Z",
    },
  ],
};

test("AssessmentReportActions renders View provenance action link", () => {
  const html = renderToStaticMarkup(
    React.createElement(AssessmentReportActions, {
      assessmentId: "a-123",
      artifactId: "art-123",
    }),
  );
  assert.ok(html.includes('href="/assessments/a-123/provenance"'));
  assert.ok(html.includes('data-report-action="provenance"'));
  assert.ok(html.includes("View provenance"));
});

test("AssessmentProvenanceView renders loading state", () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const html = renderToStaticMarkup(
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(AssessmentProvenanceView, { assessmentId }),
    ),
  );
  assert.match(html, /Loading provenance trail/);
});

test("AssessmentProvenanceView renders populated provenance with cryptographic checksum and pins", () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(
    assessmentDomainKeys.provenance(assessmentId),
    mockProvenance,
  );

  const html = renderToStaticMarkup(
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(AssessmentProvenanceView, { assessmentId }),
    ),
  );

  // Name & title
  assert.match(html, /SOC 2 Type II Assessment/);
  assert.match(html, /Assessment provenance/);

  // Cryptographic integrity verification & checksum
  assert.match(html, /Provenance integrity cryptographically verified/);
  assert.match(html, /abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789/);

  // Download provenance button
  assert.match(
    html,
    /<a [^>]*href="\/api\/assessments\/11111111-1111-4111-8111-111111111111\/provenance\/download"[^>]*data-slot="export-provenance-button"/,
  );

  // Pinned foundations
  assert.match(html, /0123456789abcdef0123456789abcdef01234567/);
  assert.match(html, /2\.1\.0/);

  // Human Resolution verbatim answers
  assert.match(html, /Is TLS termination performed at the load balancer\?/);
  assert.match(html, /Yes, AWS ALB terminates TLS with ACM certificates\./);

  // Facts & Evidence
  assert.match(html, /TLS 1\.3 enforced on all external endpoints\./);
  assert.match(html, /EVIDENCE_CITED/);
});
