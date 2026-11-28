import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { BillingReconciliationCaseDetailResponse } from "@lcsp/contracts/billing";
import { AdminModelReconciliationDecisionForm } from "../src/features/admin/components/molecules/admin-model-reconciliation-decision-form.tsx";

const detail = {
  caseId: "case-1",
  state: "OPEN",
  evidenceArtifact: null,
} as BillingReconciliationCaseDetailResponse;

test("Admin decision form keeps no-usage action unavailable without verified provider evidence", () => {
  const html = renderToStaticMarkup(
    <AdminModelReconciliationDecisionForm
      detail={detail}
      onSubmit={async () => {}}
      isSubmitting={false}
    />,
  );
  assert.match(html, /CONFIRM_NO_USAGE/);
  assert.match(html, /value="CONFIRM_NO_USAGE"[^>]*disabled/);
  assert.match(html, /name="auditRationale"/);
});

test("Admin decision form enables no-usage only for a verified provider artifact", () => {
  const verified = {
    ...detail,
    evidenceArtifact: {
      artifactId: "artifact-1",
      provider: "anthropic",
      sha256: "a".repeat(64),
      coverageStart: "2026-11-28T00:00:00.000Z",
      coverageEnd: "2026-11-28T00:05:00.000Z",
      verified: true,
      ingestedAt: "2026-11-28T00:06:00.000Z",
    },
  } as BillingReconciliationCaseDetailResponse;
  const html = renderToStaticMarkup(
    <AdminModelReconciliationDecisionForm
      detail={verified}
      onSubmit={async () => {}}
      isSubmitting={false}
    />,
  );
  assert.match(html, /value="CONFIRM_NO_USAGE"/);
  assert.doesNotMatch(html, /value="CONFIRM_NO_USAGE"[^>]*disabled/);
  assert.match(html, /value="artifact-1"/);
});
