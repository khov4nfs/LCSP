// Isolated HTTP/UI fixture. PostgreSQL authority is verified separately by API integration tests.
import React, { useState, useEffect } from "react";
import { RuleSetPreparationList } from "../../src/features/admin/components/organisms/rule-set-preparation-list";
import preparation from "../../src/public/assets/mocks/preparation-observability.json";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RuleGroupingReview } from "../../src/features/admin/components/organisms/rule-grouping-review";
import { LocalizationOperationsQueue } from "../../src/features/admin/components/organisms/localization-operations-queue";
import { AssessmentReportView } from "../../src/features/assessment-runtime/components/organisms/assessment-report-view";
import { RuleAuditPicker } from "../../src/features/assessment-runtime/components/organisms/rule-audit-picker";
import { LocaleProvider } from "../../src/components/providers/locale-provider";
import { setAppLocale } from "../../src/lib/locale";
import pagination from "../../src/public/assets/mocks/localization-pagination.json";
import grouping from "../../src/public/assets/mocks/rule-grouping-review.json";
import details from "../../src/public/assets/mocks/localized-assessment-detail.json";
import reports from "../../src/public/assets/mocks/localized-assessment-wire.json";
import artifact from "../../src/public/assets/mocks/reviewed-report-browser.json";
import { problemEnvelope } from "../../src/lib/api/problem-envelope";
import { AUTHORED_LOCALIZATION_CODES } from "@lcsp/contracts/assessment-domain";
import { COMPLIANCE_RULE_SET_ERROR_CODES } from "@lcsp/contracts/compliance-rule-set";
const id = grouping.proposal.ruleSetVersionId;
const client = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: Infinity } },
});
let ledger = grouping.ledger;
const state = {
  submissions: [],
  localizationSubmissions: [],
  delay: false,
  release: null,
  mode: "READY",
};
Object.assign(window, {
  __fixture: state,
  __locale: setAppLocale,
  __clear: () => client.clear(),
});
if (location.pathname === "/preparation") {
  globalThis.EventSource = class {
    constructor() {
      window.__preparationStream = this;
      setTimeout(() => this.onopen?.(new Event("open")), 0);
    }
    addEventListener() {}
    removeEventListener() {}
    close() {}
  };
}
function PreparationFixture() {
  const [run, setRun] = useState(preparation.run);
  useEffect(() => {
    window.__preparationState = (state) =>
      setRun((current) => ({
        ...current,
        executionState: state,
        resumable: state === "PAUSED",
        failureReason: state === "PAUSED" ? "AGENT_BUDGET_REACHED" : null,
      }));
    return () => {
      delete window.__preparationState;
    };
  }, []);
  return (
    <RuleSetPreparationList
      preparations={[run]}
      availability={preparation.availability}
      ruleSets={[]}
    />
  );
}
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (location.pathname === "/preparation" && url.includes("/activity"))
    return Response.json({
      ok: true,
      data: url.includes("cursor=") ? preparation.older : preparation.page,
    });

  if (
    location.pathname === "/pagination" &&
    url.includes("/api/admin/localization")
  ) {
    const parsed = new URL(url, location.origin);
    if (parsed.pathname === "/api/admin/localization") {
      const after = parsed.searchParams.get("afterScopeId");
      const scopes = pagination.backlog.scopes
        .filter((scope) => !after || scope.scopeId > after)
        .slice(0, 25);
      const hasMore =
        scopes.at(-1)?.scopeId !== pagination.backlog.scopes.at(-1)?.scopeId;
      return Response.json({
        ok: true,
        data: {
          ...pagination.backlog,
          scopes,
          hasMore,
          nextAfterScopeId: hasMore ? scopes.at(-1).scopeId : null,
        },
      });
    }
    const after = parsed.searchParams.get("after");
    const items = parsed.pathname.endsWith("pagination-scope-30")
      ? pagination.jobs.filter((job) => !after || job.id > after).slice(0, 100)
      : [];
    const hasMore =
      items.length > 0 && items.at(-1).id !== pagination.jobs.at(-1).id;
    return Response.json({
      ok: true,
      data: { items, hasMore, nextAfter: hasMore ? items.at(-1).id : null },
    });
  }
  if (url.includes("/api/admin/localization")) {
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      state.localizationSubmissions.push({ url, body });
      if (url.endsWith("/batch-output-review")) {
        return Response.json({
          ok: true,
          data: {
            scopeId: id,
            acceptedCount: 1,
            rejectedCount: 0,
            results: [
              {
                requestId: grouping.localizationQueue.items[0].id,
                accepted: true,
                errorCode: null,
              },
            ],
          },
        });
      }
      return Response.json({
        ok: true,
        data: {
          id: grouping.localizationQueue.items[0].id,
          state: "READY",
          reviewed: 1,
          translationRevision: 1,
        },
      });
    }
    return Response.json({
      ok: true,
      data: url.includes(id)
        ? grouping.localizationQueue
        : grouping.localizationBacklog,
    });
  }
  if (url.includes("/groups")) {
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      state.submissions.push(body);
      if (url.endsWith("/approval"))
        return Response.json(
          problemEnvelope(
            COMPLIANCE_RULE_SET_ERROR_CODES.submitRequestInvalid,
            409,
          ),
          { status: 409 },
        );
      ledger = {
        memberships: body.memberships.map((row) => ({
          ...row,
          state: "DRAFT",
          submittedBy: "isolated-admin",
          approvedBy: null,
        })),
        membershipDigest: "c".repeat(64),
      };
    }
    return Response.json({
      ok: true,
      data: url.endsWith("/proposal") ? grouping.proposal : ledger,
    });
  }
  const locale = new Headers(init?.headers).get("x-lcsp-locale") ?? "en";
  if (state.delay && locale === "vi")
    await new Promise((resolve) => (state.release = resolve));
  if (state.mode !== "READY")
    return Response.json(
      {
        ...problemEnvelope(AUTHORED_LOCALIZATION_CODES.INCOMPLETE, 409),
        problem: {
          ...problemEnvelope(AUTHORED_LOCALIZATION_CODES.INCOMPLETE, 409)
            .problem,
          meta: { locale, state: state.mode },
        },
      },
      { status: 409 },
    );
  if (url.includes("/rules")) {
    return Response.json({
      ok: true,
      data: grouping.ruleCatalog[locale],
    });
  }
  if (url.endsWith("/report"))
    return Response.json({
      ok: true,
      data: reports.reports[`ASSESSMENT_FINAL_REPORT_V2:${locale}`],
    });
  const detail = structuredClone(details[locale]);
  detail.case.artifacts = [artifact];
  return Response.json({ ok: true, data: detail });
};
const pathname = location.pathname;
createRoot(document.getElementById("root")).render(
  <LocaleProvider initialLocale="en">
    <QueryClientProvider client={client}>
      {pathname === "/preparation" ? (
        <PreparationFixture />
      ) : pathname === "/report" ? (
        <AssessmentReportView assessmentId={id} />
      ) : pathname === "/localization" || pathname === "/pagination" ? (
        <LocalizationOperationsQueue />
      ) : pathname === "/catalog" ? (
        <RuleAuditPicker assessmentId={id} />
      ) : (
        <RuleGroupingReview ruleSetVersionId={id} />
      )}
    </QueryClientProvider>
  </LocaleProvider>,
);
