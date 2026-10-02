import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ARTIFACT_TYPES } from "../src/features/artifacts/types/artifact.types";
import { buildArtifactOpenTarget } from "../src/features/artifacts/utils/artifact-routes";
import { ProgramEvidenceSummary } from "../src/features/workspace/components/molecules/program-evidence-summary";
import {
  PROGRAM_EVIDENCE_METRIC_FORMATS,
  type ProgramEvidenceSummary as ProgramEvidenceSummaryData,
} from "../src/features/assessment-flow/types/assessment-flow.types";
import { setAppLocale } from "../src/lib/locale";

const pgeSummaryPath = new URL(
  "../src/features/workspace/components/molecules/program-evidence-summary.tsx",
  import.meta.url,
);
const scannerStepPath = new URL(
  "../src/features/assessment-flow/components/organisms/scanner-step.tsx",
  import.meta.url,
);

test("single PGE implementation: ScannerStep uses the canonical ProgramEvidenceSummary", async () => {
  const [sharedPge, scannerStep] = await Promise.all([
    readFile(pgeSummaryPath, "utf8"),
    readFile(scannerStepPath, "utf8"),
  ]);

  assert.match(sharedPge, /ChatResultContainer/);
  assert.match(sharedPge, /export function ProgramEvidenceSummary/);
  assert.match(scannerStep, /import { ProgramEvidenceSummary }/);
  assert.doesNotMatch(scannerStep, /ProgramEvidenceGraphSummary/);
});

test("ProgramEvidenceSummary renders 4 explicit semantic metrics with canonical values in EN and VI", () => {
  setAppLocale("en");
  const summaryFixture: ProgramEvidenceSummaryData = {
    modulesAnalyzed: { value: 12, format: PROGRAM_EVIDENCE_METRIC_FORMATS.count },
    codeSymbolsIndexed: { value: 93, format: PROGRAM_EVIDENCE_METRIC_FORMATS.count },
    aiModelInvocations: { value: 5, format: PROGRAM_EVIDENCE_METRIC_FORMATS.count },
    evidenceMappedScope: { value: 71, format: PROGRAM_EVIDENCE_METRIC_FORMATS.percent },
  };

  const htmlEn = renderToStaticMarkup(
    React.createElement(ProgramEvidenceSummary, {
      commitSha: "9f31ca234567890abcdef",
      summary: summaryFixture,
      canonicalOverview: {
        modules_analyzed: 12,
        code_symbols_indexed: 93,
        ai_model_invocations: 5,
        evidence_mapped_scope: 71,
      },
      assessmentId: "asmt-101",
    }),
  );

  // Assert ChatResultContainer primitive is used
  assert.match(htmlEn, /data-slot="chat-result-container"/);

  // Assert 4 semantic labels exist in EN
  assert.match(htmlEn, /Modules analyzed/);
  assert.match(htmlEn, /Code symbols indexed/);
  assert.match(htmlEn, /AI model invocations/);
  assert.match(htmlEn, /Mapped scope/);

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
  assert.match(htmlEn, /data-slot="button"/);
  assert.doesNotMatch(htmlEn, /href="\/assessments\/asmt-101"/);
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
  assert.match(htmlVi, /Mô-đun đã phân tích/);
  assert.match(htmlVi, /Độ phủ bằng chứng kỹ thuật/);
  assert.match(htmlVi, /Sẵn sàng/);
});

test("ProgramEvidenceSummary handles unavailable metrics with unavailable format and never with zero", () => {
  const partialSummary: ProgramEvidenceSummaryData = {
    modulesAnalyzed: { value: 0, format: PROGRAM_EVIDENCE_METRIC_FORMATS.count }, // Authoritative 0
    codeSymbolsIndexed: { value: null, format: PROGRAM_EVIDENCE_METRIC_FORMATS.count }, // Unavailable
    aiModelInvocations: { value: null, format: PROGRAM_EVIDENCE_METRIC_FORMATS.count }, // Unavailable
    evidenceMappedScope: { value: null, format: PROGRAM_EVIDENCE_METRIC_FORMATS.percent }, // Unavailable
  };

  const html = renderToStaticMarkup(
    React.createElement(ProgramEvidenceSummary, {
      commitSha: "abc1234567890",
      summary: partialSummary,
      canonicalOverview: {
        modules_analyzed: 0,
        code_symbols_indexed: null,
        ai_model_invocations: null,
        evidence_mapped_scope: null,
      },
      assessmentId: "asmt-102",
    }),
  );

  // Authoritative zero renders as 0
  assert.match(html, />0</);

  // Unavailable values render placeholder '--', not '0' or '0%'
  assert.match(html, />--</);
  assert.doesNotMatch(html, />0%</);
});

test("artifact navigation resolves the canonical PGE route", () => {
  const target = buildArtifactOpenTarget({
    assessmentId: "asmt-1",
    type: ARTIFACT_TYPES.programEvidenceGraph,
  });
  assert.equal(target.kind, "INTERNAL");
  assert.equal(target.href, "/assessments/asmt-1");
});

test("AgentTurn composes the active ProgramEvidenceSummary with agent prose", async () => {
  const agentTurnModule = await import(
    "../src/features/workspace/components/molecules/agent-turn"
  );
  const turnFooterModule = await import(
    "../src/features/workspace/components/molecules/turn-footer"
  );
  const html = renderToStaticMarkup(
    React.createElement(
      agentTurnModule.AgentTurn,
      {
        content: React.createElement(
          agentTurnModule.AgentMessage,
          null,
          "Repository analysis completed.",
        ),
        footer: React.createElement(turnFooterModule.TurnFooter, {
          timestamp: "10:45 AM",
        }),
      },
      React.createElement(ProgramEvidenceSummary, {
        commitSha: "1234567",
        summary: {
          modulesAnalyzed: { value: 1, format: "count" },
          codeSymbolsIndexed: { value: 2, format: "count" },
          aiModelInvocations: { value: 3, format: "count" },
          evidenceMappedScope: { value: 50, format: "percent" },
        },
        canonicalOverview: null,
      }),
    ),
  );
  assert.match(html, /data-slot="agent-turn"/);
  assert.match(html, /Repository analysis completed/);
  assert.match(html, /data-slot="chat-result-container"/);
  assert.match(html, /10:45 AM/);
});

test("chat rail contract keeps the active PGE result flexible and bounded", () => {
  const html = renderToStaticMarkup(
    React.createElement(ProgramEvidenceSummary, {
      commitSha: "1234567",
      summary: {
        modulesAnalyzed: { value: 1, format: "count" },
        codeSymbolsIndexed: { value: 2, format: "count" },
        aiModelInvocations: { value: 3, format: "count" },
        evidenceMappedScope: { value: 50, format: "percent" },
      },
      canonicalOverview: null,
    }),
  );
  assert.match(html, /max-w-170/);
  assert.match(html, /w-full/);
  assert.match(html, /min-w-0/);
});
