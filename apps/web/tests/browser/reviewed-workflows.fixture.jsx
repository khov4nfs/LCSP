// Isolated HTTP/UI fixture. PostgreSQL authority is verified separately by API integration tests.
import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RuleGroupingReview } from "../../src/features/admin/components/organisms/rule-grouping-review";
import { AssessmentReportView } from "../../src/features/assessment-runtime/components/organisms/assessment-report-view";
import { LocaleProvider } from "../../src/components/providers/locale-provider";
import { setAppLocale } from "../../src/lib/locale";
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
const state = { submissions: [], delay: false, release: null, mode: "READY" };
Object.assign(window, {
  __fixture: state,
  __locale: setAppLocale,
  __clear: () => client.clear(),
});
globalThis.fetch = async (input, init) => {
  const url = String(input);
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
  if (url.endsWith("/report"))
    return Response.json({
      ok: true,
      data: reports.reports[`ASSESSMENT_FINAL_REPORT_V2:${locale}`],
    });
  const detail = structuredClone(details[locale]);
  detail.case.artifacts = [artifact];
  return Response.json({ ok: true, data: detail });
};
const isReport = location.pathname === "/report";
createRoot(document.getElementById("root")).render(
  <LocaleProvider initialLocale="en">
    <QueryClientProvider client={client}>
      {isReport ? (
        <AssessmentReportView assessmentId={id} />
      ) : (
        <RuleGroupingReview ruleSetVersionId={id} />
      )}
    </QueryClientProvider>
  </LocaleProvider>,
);
