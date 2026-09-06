import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ARTIFACT_TYPES } from "../src/features/artifacts/types/artifact.types";
import { buildArtifactOpenTarget } from "../src/features/artifacts/utils/artifact-routes";
import { ProgramEvidenceSummary } from "../src/features/workspace/components/molecules/program-evidence-summary";
import { InvestigationTrace } from "../src/features/workspace/components/molecules/investigation-trace";
import { EngineeringRuleFindingsTable } from "../src/features/workspace/components/molecules/engineering-rule-findings-table";
import {
  FINDING_PRIORITIES,
  INVESTIGATION_TRACE_STATUSES,
  PROGRAM_EVIDENCE_METRIC_FORMATS,
  type ProgramEvidenceSummary as ProgramEvidenceSummaryData,
} from "../src/features/workspace/types/structured-results.types";
import {
  toEngineeringRuleFindingViewModel,
  toEngineeringRuleFindingsViewModel,
  toInvestigationTraceViewModel,
} from "../src/features/workspace/utils/structured-result-adapters";
import { setAppLocale } from "../src/lib/locale";
import type { EngineeringRuleEvaluationViewModel } from "../src/lib/api/classification-client";

const pgeSummaryPath = new URL(
  "../src/features/workspace/components/molecules/program-evidence-summary.tsx",
  import.meta.url,
);
const legacyPgeSummaryPath = new URL(
  "../src/features/assessment-flow/components/molecules/program-evidence-graph-summary.tsx",
  import.meta.url,
);
const scannerStepPath = new URL(
  "../src/features/assessment-flow/components/organisms/scanner-step.tsx",
  import.meta.url,
);

test("single PGE implementation: legacy component is a thin compatibility wrapper", async () => {
  const [sharedPge, legacyPge, scannerStep] = await Promise.all([
    readFile(pgeSummaryPath, "utf8"),
    readFile(legacyPgeSummaryPath, "utf8"),
    readFile(scannerStepPath, "utf8"),
  ]);

  // Shared implementation uses ChatResultContainer
  assert.match(sharedPge, /ChatResultContainer/);
  assert.match(sharedPge, /export function ProgramEvidenceSummary/);

  // Legacy file delegates without duplicating markup
  assert.match(legacyPge, /ProgramEvidenceSummary/);
  assert.doesNotMatch(legacyPge, /<article/);
  assert.doesNotMatch(legacyPge, /<dl/);

  // ScannerStep uses shared ProgramEvidenceSummary
  assert.match(scannerStep, /import { ProgramEvidenceSummary }/);
  assert.doesNotMatch(scannerStep, /ProgramEvidenceGraphSummary/);
});

test("ProgramEvidenceSummary renders 4 explicit semantic metrics with canonical values in EN and VI", () => {
  setAppLocale("en");
  const summaryFixture: ProgramEvidenceSummaryData = {
    servicesScanned: { value: 12, format: PROGRAM_EVIDENCE_METRIC_FORMATS.count },
    codeSymbolsIndexed: { value: 93, format: PROGRAM_EVIDENCE_METRIC_FORMATS.count },
    aiProviderCallPaths: { value: 5, format: PROGRAM_EVIDENCE_METRIC_FORMATS.count },
    evidenceMappedScope: { value: 71, format: PROGRAM_EVIDENCE_METRIC_FORMATS.percent },
  };

  const htmlEn = renderToStaticMarkup(
    React.createElement(ProgramEvidenceSummary, {
      commitSha: "9f31ca234567890abcdef",
      summary: summaryFixture,
      assessmentId: "asmt-101",
    }),
  );

  // Assert ChatResultContainer primitive is used
  assert.match(htmlEn, /data-slot="chat-result-container"/);

  // Assert 4 semantic labels exist in EN
  assert.match(htmlEn, /Services scanned/);
  assert.match(htmlEn, /Code symbols indexed/);
  assert.match(htmlEn, /AI\/provider call paths/);
  assert.match(htmlEn, /Evidence-mapped scope/);

  // Invariant: No ambiguous standalone coverage label exists
  assert.doesNotMatch(htmlEn, />71% coverage</);
  assert.doesNotMatch(htmlEn, />Coverage 71%</);

  // Assert metric values render
  assert.match(htmlEn, />12</);
  assert.match(htmlEn, />93</);
  assert.match(htmlEn, />5</);
  assert.match(htmlEn, />71%</);

  // Assert short SHA and ready status
  assert.match(htmlEn, /9f31ca2/);
  assert.match(htmlEn, /Ready/);

  // Assert LCSP-270 CTA
  assert.match(htmlEn, /View evidence graph/);
  assert.match(htmlEn, /href="\/assessments\/asmt-101"/);
  assert.match(htmlEn, /Artifact · repository evidence/);

  // Assert Vietnamese locale
  setAppLocale("vi");
  const htmlVi = renderToStaticMarkup(
    React.createElement(ProgramEvidenceSummary, {
      commitSha: "9f31ca234567890abcdef",
      summary: summaryFixture,
      assessmentId: "asmt-101",
    }),
  );
  assert.match(htmlVi, /Services đã quét/);
  assert.match(htmlVi, /Phạm vi đã map evidence/);
  assert.match(htmlVi, /Sẵn sàng/);
});

test("ProgramEvidenceSummary handles unavailable metrics with unavailable format and never with zero", () => {
  const partialSummary: ProgramEvidenceSummaryData = {
    servicesScanned: { value: 0, format: PROGRAM_EVIDENCE_METRIC_FORMATS.count }, // Authoritative 0
    codeSymbolsIndexed: { value: null, format: PROGRAM_EVIDENCE_METRIC_FORMATS.count }, // Unavailable
    aiProviderCallPaths: { value: null, format: PROGRAM_EVIDENCE_METRIC_FORMATS.count }, // Unavailable
    evidenceMappedScope: { value: null, format: PROGRAM_EVIDENCE_METRIC_FORMATS.percent }, // Unavailable
  };

  const html = renderToStaticMarkup(
    React.createElement(ProgramEvidenceSummary, {
      commitSha: "abc1234567890",
      summary: partialSummary,
      assessmentId: "asmt-102",
    }),
  );

  // Authoritative zero renders as 0
  assert.match(html, />0</);

  // Unavailable values render placeholder '--', not '0' or '0%'
  assert.match(html, />--</);
  assert.doesNotMatch(html, />0%</);
});

test("InvestigationTrace renders ordered path steps, status, and canonical claim count in EN and VI", () => {
  setAppLocale("en");
  const htmlEn = renderToStaticMarkup(
    React.createElement(InvestigationTrace, {
      status: INVESTIGATION_TRACE_STATUSES.inProgress,
      steps: [
        { id: "step-1", label: "Alpha Step" },
        { id: "step-2", label: "Beta Gateway" },
        { id: "step-3", label: "Gamma Verify" },
      ],
      evidenceClaimCount: 7,
    }),
  );

  // Uses ChatResultContainer
  assert.match(htmlEn, /data-slot="chat-result-container"/);
  assert.match(htmlEn, /Investigation trace/);

  // Status rendering
  assert.match(htmlEn, /In progress/);

  // Path rendering in order
  assert.match(htmlEn, /Alpha Step/);
  assert.match(htmlEn, /Beta Gateway/);
  assert.match(htmlEn, /Gamma Verify/);

  // Assert steps appear in sequential order
  const alphaIndex = htmlEn.indexOf("Alpha Step");
  const betaIndex = htmlEn.indexOf("Beta Gateway");
  const gammaIndex = htmlEn.indexOf("Gamma Verify");
  assert.ok(alphaIndex < betaIndex);
  assert.ok(betaIndex < gammaIndex);

  // Evidence claims count
  assert.match(htmlEn, /7 evidence claims collected/);
  assert.match(htmlEn, /linked to this traced path/);

  // Vietnamese locale
  setAppLocale("vi");
  const htmlVi = renderToStaticMarkup(
    React.createElement(InvestigationTrace, {
      status: INVESTIGATION_TRACE_STATUSES.inProgress,
      steps: [{ id: "step-1", label: "Alpha Step" }],
      evidenceClaimCount: 7,
    }),
  );
  assert.match(htmlVi, /Trace điều tra/);
  assert.match(htmlVi, /Đang tiến hành/);
  assert.match(htmlVi, /7 evidence claims đã thu thập/);
});

test("InvestigationTrace adapter does NOT parse chat prose and handles missing data", () => {
  setAppLocale("en");
  const viewModel = toInvestigationTraceViewModel({
    assessmentId: "asmt-200",
    status: "running",
    steps: null,
    evidenceClaimCount: null,
  });

  assert.equal(viewModel.status, INVESTIGATION_TRACE_STATUSES.inProgress);
  assert.deepEqual(viewModel.steps, []);
  assert.equal(viewModel.evidenceClaimCount, null);
  assert.equal(viewModel.artifactRef?.type, ARTIFACT_TYPES.investigationNotes);

  const html = renderToStaticMarkup(
    React.createElement(InvestigationTrace, viewModel),
  );

  assert.match(html, /No trace path recorded/);
});

test("EngineeringRuleFindingsTable renders customer-readable columns and secondary metadata in EN and VI", () => {
  setAppLocale("en");
  const findings = [
    {
      id: "ER-01",
      priority: FINDING_PRIORITIES.high,
      status: "NON_COMPLIANT" as const,
      issue: "Payment bypasses required human approval",
      whyItMatters: "High risk financial decisions require human verification under policy.",
      source: {
        filePath: "src/payments/risk-engine.ts",
        startLine: 142,
        endLine: 150,
        ruleId: "ER-01",
      },
    },
    {
      id: "ER-02",
      priority: FINDING_PRIORITIES.medium,
      status: "UNKNOWN" as const,
      issue: "Model decision audit log missing identifier",
      whyItMatters: "Audit records must identify the model version used for downstream trace.",
      source: {
        filePath: "src/services/audit.ts",
        startLine: 88,
        ruleId: "ER-02",
      },
    },
  ];

  const htmlEn = renderToStaticMarkup(
    React.createElement(EngineeringRuleFindingsTable, {
      findings,
      assessmentId: "asmt-301",
    }),
  );

  // Assert ChatResultContainer primitive
  assert.match(htmlEn, /data-slot="chat-result-container"/);

  // Assert column headers
  assert.match(htmlEn, /PRIORITY/);
  assert.match(htmlEn, /ISSUE/);
  assert.match(htmlEn, /WHY IT MATTERS/);
  assert.match(htmlEn, /FOUND IN/);

  // Assert priority badges
  assert.match(htmlEn, /data-slot="priority-badge-high"/);
  assert.match(htmlEn, /High priority/);
  assert.match(htmlEn, /data-slot="priority-badge-medium"/);
  assert.match(htmlEn, /Medium/);

  // Assert primary customer-readable content
  assert.match(htmlEn, /Payment bypasses required human approval/);
  assert.match(htmlEn, /High risk financial decisions require human verification under policy\./);
  assert.match(htmlEn, /Model decision audit log missing identifier/);

  // Assert secondary metadata
  assert.match(htmlEn, /src\/payments\/risk-engine\.ts/);
  assert.match(htmlEn, /line 142 · ER-01/);
  assert.match(htmlEn, /src\/services\/audit\.ts/);
  assert.match(htmlEn, /line 88 · ER-02/);

  // Assert technical details CTA
  assert.match(htmlEn, /View technical details/);
  assert.match(htmlEn, /href="\/assessments\/asmt-301"/);

  // Assert Vietnamese locale
  setAppLocale("vi");
  const htmlVi = renderToStaticMarkup(
    React.createElement(EngineeringRuleFindingsTable, {
      findings,
      assessmentId: "asmt-301",
    }),
  );
  assert.match(htmlVi, /ĐỘ ƯU TIÊN/);
  assert.match(htmlVi, /Độ ưu tiên cao/);
  assert.match(htmlVi, /dòng 142 · ER-01/);
  assert.match(htmlVi, /Xem chi tiết kỹ thuật/);
});

test("Priority authority invariant: production adapter does NOT fabricate High/Medium from status", () => {
  const sampleEvaluation: EngineeringRuleEvaluationViewModel = {
    engineeringRuleId: "ER-42",
    concept: "Decision engine skips validation",
    status: "NON_COMPLIANT",
    reason: "Validation check was bypassed.",
    technicalEvidenceCount: 1,
    technicalEvidence: [
      {
        kind: "AST_CALL",
        label: "Direct call",
        filePath: "src/engine.ts",
        symbolRef: "evaluate",
        startLine: 10,
        endLine: 20,
      },
    ],
    legalProvisions: [],
    confidence: 0.95,
    limitations: [],
  };

  // When no canonical priority is provided
  const finding = toEngineeringRuleFindingViewModel(sampleEvaluation, {
    assessmentId: "asmt-400",
  });

  // Priority must remain null/unspecified, NOT fabricated as HIGH because of NON_COMPLIANT
  assert.equal(finding.priority, null);
  assert.equal(finding.status, "NON_COMPLIANT");
  assert.equal(finding.issue, "Decision engine skips validation");
  assert.equal(finding.whyItMatters, "Validation check was bypassed.");
  assert.equal(finding.source.filePath, "src/engine.ts");
  assert.equal(finding.source.startLine, 10);
  assert.equal(finding.source.ruleId, "ER-42");

  // When explicit priority map is provided (e.g. from authoritative backend policy)
  const findingsModel = toEngineeringRuleFindingsViewModel([sampleEvaluation], {
    assessmentId: "asmt-400",
    prioritiesMap: { "ER-42": FINDING_PRIORITIES.high },
  });

  assert.equal(findingsModel.findings[0]?.priority, FINDING_PRIORITIES.high);
});

test("Finding status authority: deterministic evaluation statuses are preserved", () => {
  const evaluations: EngineeringRuleEvaluationViewModel[] = [
    {
      engineeringRuleId: "ER-1",
      concept: "C1",
      status: "COMPLIANT",
      reason: "R1",
      technicalEvidenceCount: 0,
      technicalEvidence: [],
      legalProvisions: [],
      confidence: 1,
      limitations: [],
    },
    {
      engineeringRuleId: "ER-2",
      concept: "C2",
      status: "NON_COMPLIANT",
      reason: "R2",
      technicalEvidenceCount: 0,
      technicalEvidence: [],
      legalProvisions: [],
      confidence: 1,
      limitations: [],
    },
    {
      engineeringRuleId: "ER-3",
      concept: "C3",
      status: "UNKNOWN",
      reason: "R3",
      technicalEvidenceCount: 0,
      technicalEvidence: [],
      legalProvisions: [],
      confidence: 0,
      limitations: [],
    },
  ];

  const model = toEngineeringRuleFindingsViewModel(evaluations, {
    assessmentId: "asmt-500",
    filterFindingsOnly: false,
  });

  assert.equal(model.findings[0]?.status, "COMPLIANT");
  assert.equal(model.findings[1]?.status, "NON_COMPLIANT");
  assert.equal(model.findings[2]?.status, "UNKNOWN");
});

test("artifact navigation: CTAs resolve via LCSP-270 artifact routes", () => {
  setAppLocale("en");
  const pgeTarget = buildArtifactOpenTarget({
    assessmentId: "asmt-1",
    type: ARTIFACT_TYPES.programEvidenceGraph,
  });
  assert.equal(pgeTarget.kind, "INTERNAL");
  assert.equal(pgeTarget.href, "/assessments/asmt-1");

  const findingsTarget = buildArtifactOpenTarget({
    assessmentId: "asmt-1",
    type: ARTIFACT_TYPES.findingsReport,
  });
  assert.equal(findingsTarget.kind, "INTERNAL");
  assert.equal(findingsTarget.href, "/assessments/asmt-1");

  const traceTarget = buildArtifactOpenTarget({
    assessmentId: "asmt-1",
    type: ARTIFACT_TYPES.investigationNotes,
  });
  assert.equal(traceTarget.kind, "INTERNAL");
  assert.equal(traceTarget.href, "/assessments/asmt-1");

  // Verify InvestigationTrace renders the LCSP-270 artifact CTA link
  const traceHtml = renderToStaticMarkup(
    React.createElement(InvestigationTrace, {
      assessmentId: "asmt-trace-1",
      steps: [{ id: "s1", label: "Check API Gateway" }],
      evidenceClaimCount: 3,
    }),
  );
  assert.match(traceHtml, /href="\/assessments\/asmt-trace-1"/);
  assert.match(traceHtml, /View investigation details/);
  assert.match(traceHtml, /3 evidence claims collected/);

  // Verify adapter creates investigationNotes artifactRef
  const traceViewModel = toInvestigationTraceViewModel({
    assessmentId: "asmt-trace-2",
    steps: [{ id: "s1", label: "Check policy gate" }],
  });
  assert.deepEqual(traceViewModel.artifactRef, {
    assessmentId: "asmt-trace-2",
    type: ARTIFACT_TYPES.investigationNotes,
  });
});

test("AgentTurn composition: structured results can be followed by Agent message in the same turn", async () => {
  const agentTurnModule = await import(
    "../src/features/workspace/components/molecules/agent-turn"
  );
  const turnFooterModule = await import(
    "../src/features/workspace/components/molecules/turn-footer"
  );

  const AgentTurn = agentTurnModule.AgentTurn;
  const AgentMessage = agentTurnModule.AgentMessage;
  const TurnFooter = turnFooterModule.TurnFooter;

  const html = renderToStaticMarkup(
    React.createElement(
      AgentTurn,
      {
        content: React.createElement(
          AgentMessage,
          null,
          "I completed the payment decision flow check and found 2 problems that need review.",
        ),
        footer: React.createElement(TurnFooter, { timestamp: "10:45 AM" }),
      },
      React.createElement(EngineeringRuleFindingsTable, {
        findings: [
          {
            id: "ER-1",
            status: "NON_COMPLIANT",
            issue: "Issue 1",
            whyItMatters: "Why 1",
            source: { filePath: "test.ts", ruleId: "ER-1" },
          },
        ],
        assessmentId: "asmt-turn",
      }),
      React.createElement(
        AgentMessage,
        { className: "mt-3" },
        "Next, we can review the remediation plan or adjust policy gate conditions.",
      ),
    ),
  );

  assert.match(html, /data-slot="agent-turn"/);
  assert.match(html, /I completed the payment decision flow check/);
  assert.match(html, /data-slot="findings-table"/);
  assert.match(html, /Next, we can review the remediation plan/);
  assert.match(html, /data-slot="turn-footer"/);
  assert.match(html, /10:45 AM/);
});

test("chat rail contract: structured results enforce max-w-170 (680px) and flexible layout", () => {
  const pgeHtml = renderToStaticMarkup(
    React.createElement(ProgramEvidenceSummary, {
      commitSha: "1234567",
      summary: {
        servicesScanned: { value: 1, format: "count" },
        codeSymbolsIndexed: { value: 2, format: "count" },
        aiProviderCallPaths: { value: 3, format: "count" },
        evidenceMappedScope: { value: 50, format: "percent" },
      },
    }),
  );
  assert.match(pgeHtml, /max-w-170/);
  assert.match(pgeHtml, /w-full/);
  assert.match(pgeHtml, /min-w-0/);

  const traceHtml = renderToStaticMarkup(
    React.createElement(InvestigationTrace, {
      steps: [{ id: "1", label: "Step 1" }],
    }),
  );
  assert.match(traceHtml, /max-w-170/);
  assert.match(traceHtml, /w-full/);
  assert.match(traceHtml, /min-w-0/);

  const findingsHtml = renderToStaticMarkup(
    React.createElement(EngineeringRuleFindingsTable, {
      findings: [
        {
          id: "ER-1",
          status: "COMPLIANT",
          issue: "I1",
          whyItMatters: "W1",
          source: {},
        },
      ],
    }),
  );
  assert.match(findingsHtml, /max-w-170/);
  assert.match(findingsHtml, /w-full/);
  assert.match(findingsHtml, /min-w-0/);
  // Assert both desktop table and stacked narrow view are present in markup
  assert.match(findingsHtml, /data-slot="findings-table"/);
  assert.match(findingsHtml, /data-slot="findings-stacked"/);
});
