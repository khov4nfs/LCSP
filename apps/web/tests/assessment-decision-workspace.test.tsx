import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  EvidenceCard,
  EvidenceInspector,
} from "../src/features/assessment-runtime/components/molecules/evidence-inspector";
import { SourceVersionSummary } from "../src/features/assessment-runtime/components/molecules/source-version-summary";
import { AssessmentOutcomeSummary } from "../src/features/assessment-runtime/components/organisms/assessment-outcome-summary";
import {
  ASSESSMENT_WORKSPACE_TABS,
  AssessmentWorkspaceLayout,
} from "../src/features/assessment-runtime/components/organisms/assessment-workspace-layout";
import { FindingList } from "../src/features/assessment-runtime/components/organisms/finding-list";
import { setAppLocale } from "../src/lib/locale";

describe("Assessment decision workspace components (Frames 20-22, 40-41, 82-84, 106)", () => {
  beforeEach(() => {
    setAppLocale("en");
  });

  afterEach(() => {
    setAppLocale("en");
  });

  it("renders AssessmentWorkspaceLayout with 4 tabs, request count, and EN/VI support", () => {
    const htmlEn = renderToStaticMarkup(
      <AssessmentWorkspaceLayout
        title="acme/notice-service"
        statusLabel="Running"
        activeTab={ASSESSMENT_WORKSPACE_TABS.overview}
        onTabChange={() => {}}
        openRequestsCount={2}
        onAuditSelectedRules={() => {}}
      >
        <div>Body</div>
      </AssessmentWorkspaceLayout>,
    );

    assert.match(htmlEn, /acme\/notice-service/);
    assert.match(htmlEn, /Overview/);
    assert.match(htmlEn, /Findings/);
    assert.match(htmlEn, /Information requests \(2\)/);
    assert.match(htmlEn, /Source &amp; evidence/);
    assert.match(htmlEn, /aria-selected="true"/);

    setAppLocale("vi");
    const htmlVi = renderToStaticMarkup(
      <AssessmentWorkspaceLayout
        title="acme/notice-service"
        statusLabel="Đang chạy"
        activeTab={ASSESSMENT_WORKSPACE_TABS.findings}
        onTabChange={() => {}}
        openRequestsCount={0}
      >
        <div>Body</div>
      </AssessmentWorkspaceLayout>,
    );

    assert.match(htmlVi, /Tổng quan/);
    assert.match(htmlVi, /Kết quả đánh giá/);
    assert.match(htmlVi, /Yêu cầu thông tin/);
    assert.match(htmlVi, /Mã nguồn &amp; bằng chứng/);
  });

  it("renders AssessmentOutcomeSummary with donut counts, attention card, and scope", () => {
    const html = renderToStaticMarkup(
      <AssessmentOutcomeSummary
        assessmentId="assess-1"
        counts={{
          compliant: 4,
          nonCompliant: 2,
          needsInfo: 1,
          notRequested: 1,
        }}
        openRequestQuestion="Where is account information stored?"
        repositoryName="acme/notice-service"
        commitSha="abc1234567890def"
        legalSourceVersion="2024.Q4-VN"
        onReviewFindings={() => {}}
        onAnswerRequest={() => {}}
        onViewSourceEvidence={() => {}}
        onAuditSelectedRules={() => {}}
      />,
    );

    assert.match(html, /Assessment results/);
    assert.match(html, /6 \/ 8/);
    assert.match(html, /6 of 8 rules have a compliance result/);
    assert.match(html, /4 compliant · 2 non-compliant/);
    assert.match(html, /Attention required/);
    assert.match(html, /Where is account information stored\?/);
    assert.match(html, /acme\/notice-service/);
    assert.match(html, /abc123456789/);
    assert.match(html, /2024\.Q4-VN/);
  });

  it("renders EvidenceCard, EvidenceInspector, SourceVersionSummary, and empty FindingList", () => {
    const missingHtml = renderToStaticMarkup(
      <EvidenceInspector evidenceList={[]} hasEvidenceGap />,
    );
    assert.match(missingHtml, /Missing evidence/);

    const populatedCard = renderToStaticMarkup(
      <EvidenceCard evidenceCount={3} hasEvidenceGap={false} />,
    );
    assert.match(populatedCard, /3 items/);

    const sourceHtml = renderToStaticMarkup(
      <SourceVersionSummary
        assessmentId="assess-1"
        repositoryName="acme/notice-service"
        commitSha="1234567890abcdef"
        legalSourceVersion="2024.Q4-VN"
        showArtifactLinks
      />,
    );
    assert.match(sourceHtml, /\/assessments\/assess-1\/provenance/);
    assert.match(sourceHtml, /\/assessments\/assess-1\/report/);

    const emptyFindings = renderToStaticMarkup(<FindingList turns={[]} />);
    assert.match(emptyFindings, /No rule evaluations yet/);
  });
});
