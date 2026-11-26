import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { RULE_AUDIT_PROGRESS_STATES } from "@lcsp/contracts/assessment-domain";
import { renderToStaticMarkup } from "react-dom/server";

import { AuditProgressPanel } from "../src/features/assessment-runtime/components/molecules/audit-progress-panel";
import {
  RULE_RESULT_VARIANTS,
  RuleResultCard,
} from "../src/features/assessment-runtime/components/molecules/rule-result-card";
import { RuleSelectionToolbar } from "../src/features/assessment-runtime/components/molecules/rule-selection-toolbar";
import { SelectableRuleList } from "../src/features/assessment-runtime/components/organisms/selectable-rule-list";
import {
  ACTIVITY_STAGE_STATES,
  StreamingOutputMessage,
} from "../src/features/assessment-runtime/components/organisms/streaming-output-message";
import { setAppLocale } from "../src/lib/locale";

describe("Selected-rule audit and streaming output components (Frames 76-78, 95)", () => {
  beforeEach(() => {
    setAppLocale("en");
  });

  afterEach(() => {
    setAppLocale("en");
  });

  it("renders RuleSelectionToolbar for empty selection, populated selection, and EN/VI", () => {
    const emptyHtml = renderToStaticMarkup(
      <RuleSelectionToolbar
        selectedCount={0}
        totalCount={8}
        search=""
        allMatchingSelected={false}
        onSearchChange={() => {}}
        onToggleSelectAll={() => {}}
        onRunSelected={() => {}}
        onClearSelection={() => {}}
      />,
    );
    assert.match(emptyHtml, /0 of 8 selected/);
    assert.match(emptyHtml, /No rules selected yet/);
    assert.match(emptyHtml, /disabled=""/);

    const activeHtml = renderToStaticMarkup(
      <RuleSelectionToolbar
        selectedCount={2}
        totalCount={8}
        search="retention"
        allMatchingSelected
        onSearchChange={() => {}}
        onToggleSelectAll={() => {}}
        onRunSelected={() => {}}
        onClearSelection={() => {}}
      />,
    );
    assert.match(activeHtml, /2 of 8 selected/);
    assert.match(activeHtml, /Run selected rules/);
    assert.match(activeHtml, /Clear selection/);

    setAppLocale("vi");
    const viHtml = renderToStaticMarkup(
      <RuleSelectionToolbar
        selectedCount={2}
        totalCount={8}
        search=""
        allMatchingSelected={false}
        onSearchChange={() => {}}
        onToggleSelectAll={() => {}}
        onRunSelected={() => {}}
        onClearSelection={() => {}}
      />,
    );
    assert.match(viHtml, /Đã chọn 2 trên 8/);
    assert.match(viHtml, /Chạy các quy tắc đã chọn/);
  });

  it("renders SelectableRuleList rows, selection state, and missing evidence badge", () => {
    const html = renderToStaticMarkup(
      <SelectableRuleList
        rules={[
          {
            assessmentRuleId: "rule-1",
            concept: "Account-log retention",
            legalReference: "Decree 147 · Art. 27(2)(b)",
            progress: RULE_AUDIT_PROGRESS_STATES.NOT_SELECTED,
            evidenceCount: 2,
          },
          {
            assessmentRuleId: "rule-2",
            concept: "Account verification",
            legalReference: "Decree 147 · Art. 27(3)(b)",
            progress: RULE_AUDIT_PROGRESS_STATES.RESULT_READY,
            evidenceCount: 0,
            decisionId: "dec-2",
          },
        ]}
        selectedIds={["rule-1"]}
        onToggleRule={() => {}}
        onViewResult={() => {}}
      />,
    );

    assert.match(html, /Account-log retention/);
    assert.match(html, /data-selected="true"/);
    assert.match(html, /2 items/);
    assert.match(html, /Missing evidence/);
    assert.match(html, /View result/);
  });

  it("renders AuditProgressPanel with partial completion, independent View result, and Retry", () => {
    const html = renderToStaticMarkup(
      <AuditProgressPanel
        items={[
          {
            assessmentRuleId: "rule-1",
            concept: "Account-log retention",
            progress: RULE_AUDIT_PROGRESS_STATES.RESULT_READY,
            decisionId: "dec-1",
          },
          {
            assessmentRuleId: "rule-2",
            concept: "Removal requests",
            progress: RULE_AUDIT_PROGRESS_STATES.INVESTIGATING,
          },
          {
            assessmentRuleId: "rule-3",
            concept: "User consent",
            progress: RULE_AUDIT_PROGRESS_STATES.FAILED,
          },
        ]}
        onViewResult={() => {}}
        onRetryRule={() => {}}
      />,
    );

    assert.match(html, /1 of 3 results ready/);
    assert.match(html, /View result/);
    assert.match(html, /Retry/);
    assert.match(html, /motion-reduce:animate-none/);
  });

  it("renders RuleResultCard consistently for prior and current comparison", () => {
    const priorHtml = renderToStaticMarkup(
      <RuleResultCard
        variant={RULE_RESULT_VARIANTS.prior}
        title="Account-log retention"
        statusLabel="Non-compliant"
        outcomeTone="danger"
        rationale="Retention window was missing."
        evidenceCount={1}
      />,
    );
    const currentHtml = renderToStaticMarkup(
      <RuleResultCard
        variant={RULE_RESULT_VARIANTS.current}
        title="Account-log retention"
        statusLabel="Compliant"
        outcomeTone="success"
        rationale="24-month retention verified."
        evidenceCount={2}
      />,
    );

    assert.match(priorHtml, /Previous result/);
    assert.match(priorHtml, /Non-compliant/);
    assert.match(currentHtml, /Current result/);
    assert.match(currentHtml, /Compliant/);
  });

  it("renders StreamingOutputMessage with simulated disclaimer vs real output and ActivityTimeline", () => {
    const simHtml = renderToStaticMarkup(
      <StreamingOutputMessage
        heading="Reading legal context"
        ruleContext="Account-log retention · illustrative assessment"
        streamedText="Checking the legal basis before evaluating compliance…"
        isSimulated
        timeline={{
          activeRuleTitle: "Account-log retention",
          readyCount: 0,
          totalCount: 2,
          stages: [
            {
              id: "s1",
              label: "Read original legal requirement",
              state: ACTIVITY_STAGE_STATES.inProgress,
            },
            {
              id: "s2",
              label: "Assess applicability and evidence",
              state: ACTIVITY_STAGE_STATES.pending,
            },
          ],
        }}
        onViewCurrentFindings={() => {}}
      />,
    );

    assert.match(simHtml, /Simulated output · No live model or repository call/);
    assert.match(simHtml, /Run activity/);
    assert.match(simHtml, /0 of 2 results ready/);
    assert.match(simHtml, /In progress/);
    assert.match(simHtml, /View current findings/);

    const liveHtml = renderToStaticMarkup(
      <StreamingOutputMessage
        heading="Account-log retention"
        ruleContext="Live run"
        streamedText="Evaluating repository retention configuration."
        isSimulated={false}
      />,
    );
    assert.doesNotMatch(
      liveHtml,
      /Simulated output · No live model or repository call/,
    );
  });
});
