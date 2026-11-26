import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { RequestDetail } from "../src/components/molecules/request-detail";
import { RequestStatusBadge } from "../src/components/molecules/request-status-badge";
import { ResponseForm } from "../src/components/molecules/response-form";
import { RequestCard } from "../src/features/tracking/components/molecules/request-card";
import {
  InformationRequestList,
  REQUEST_STATUS_FILTERS,
} from "../src/features/tracking/components/organisms/information-request-list";
import { setAppLocale } from "../src/lib/locale";

describe("Information requests dashboard & shared request components", () => {
  beforeEach(() => {
    setAppLocale("en");
  });

  afterEach(() => {
    setAppLocale("en");
  });

  it("renders RequestStatusBadge for open and resolved states in EN and VI", () => {
    const openEn = renderToStaticMarkup(<RequestStatusBadge open />);
    assert.match(openEn, /Needs information/);

    const resolvedEn = renderToStaticMarkup(<RequestStatusBadge open={false} />);
    assert.match(resolvedEn, /Completed/);

    setAppLocale("vi");
    const openVi = renderToStaticMarkup(<RequestStatusBadge open />);
    assert.match(openVi, /Cần thông tin/);
  });

  it("renders RequestDetail with question, legal context, and assessment deep-link", () => {
    const html = renderToStaticMarkup(
      <RequestDetail
        question="Where is account information stored?"
        open
        assessmentName="Social network"
        assessmentHref="/assessments/assess-1?requestId=req-1"
        unresolvedFact="Data storage location"
        decisionImpact={["Determines data residency obligation"]}
        resolutionAttempts={["Checked config/storage.ts"]}
        defaultExpanded
      />,
    );

    assert.match(html, /Where is account information stored\?/);
    assert.match(html, /Needs information/);
    assert.match(html, /Data storage location/);
    assert.match(html, /Determines data residency obligation/);
    assert.match(html, /Checked config\/storage\.ts/);
    assert.match(html, /\/assessments\/assess-1\?requestId=req-1/);
  });

  it("renders ResponseForm error, stale conflict, and saved states", () => {
    const failedHtml = renderToStaticMarkup(
      <ResponseForm failed>
        <button type="button">Submit</button>
      </ResponseForm>,
    );
    assert.match(failedHtml, /role="alert"/);

    const conflictHtml = renderToStaticMarkup(
      <ResponseForm staleConflict>
        <button type="button">Submit</button>
      </ResponseForm>,
    );
    assert.match(conflictHtml, /role="alert"/);

    const savedHtml = renderToStaticMarkup(
      <ResponseForm submitted>
        <button type="button">Submit</button>
      </ResponseForm>,
    );
    assert.match(savedHtml, /Response saved/);
  });

  it("renders RequestCard spotlight banner for top open request", () => {
    const html = renderToStaticMarkup(
      <RequestCard
        title="Where is account information stored?"
        subtitle="Social network · Data storage location"
        onAnswer={() => {}}
      />,
    );

    assert.match(html, /Next action/);
    assert.match(html, /Where is account information stored\?/);
    assert.match(html, /Answer request/);
  });

  it("renders InformationRequestList populated rows and empty state", () => {
    const populatedHtml = renderToStaticMarkup(
      <InformationRequestList
        rows={[
          {
            requestId: "req-1",
            assessmentId: "assess-1",
            assessmentName: "Social network",
            assessmentRuleId: "rule-1",
            question: "Where is account information stored?",
            unresolvedFact: "Data storage location",
            createdAt: "2026-11-26T14:10:00.000Z",
            open: true,
            destinationUrl: "/assessments/assess-1?requestId=req-1",
          },
          {
            requestId: "req-2",
            assessmentId: "assess-2",
            assessmentName: "Checkout & payment",
            assessmentRuleId: "rule-2",
            question: "Identity verification method?",
            unresolvedFact: "Identity verification",
            createdAt: "2026-11-23T10:00:00.000Z",
            open: false,
            destinationUrl: "/assessments/assess-2?requestId=req-2",
          },
        ]}
        totalCount={2}
        search=""
        onSearchChange={() => {}}
        statusFilter={REQUEST_STATUS_FILTERS.all}
        onStatusFilterChange={() => {}}
        onViewAll={() => {}}
        offset={0}
        limit={10}
        onPageChange={() => {}}
        onSelectRequest={() => {}}
      />,
    );

    assert.match(populatedHtml, /Request history/);
    assert.match(populatedHtml, /Data storage location/);
    assert.match(populatedHtml, /Social network/);
    assert.match(populatedHtml, /Needs information/);
    assert.match(populatedHtml, /Completed/);
    assert.match(populatedHtml, /Answer/);
    assert.match(populatedHtml, /View answer/);
    assert.match(populatedHtml, /Showing 2 of 2 records/);

    const emptyHtml = renderToStaticMarkup(
      <InformationRequestList
        rows={[]}
        totalCount={0}
        search="missing"
        onSearchChange={() => {}}
        statusFilter={REQUEST_STATUS_FILTERS.all}
        onStatusFilterChange={() => {}}
        onViewAll={() => {}}
        offset={0}
        limit={10}
        onPageChange={() => {}}
        onSelectRequest={() => {}}
      />,
    );
    assert.match(emptyHtml, /No matching information requests/);
  });
});
