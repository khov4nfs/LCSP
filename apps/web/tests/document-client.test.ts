import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
import { DOCUMENT_ERROR_CODES } from "@lcsp/contracts/document";
import * as assert from "node:assert/strict";
import { test } from "node:test";

import {
  sanitizeDocumentRequestPayload,
  toDocumentRequestOutcome,
} from "../src/lib/api/document-client.ts";

function problem(code: string, status: number) {
  return {
    ok: false,
    problem: {
      type: `test/${code.toLowerCase().replaceAll("_", "-")}`,
      status,
      code,
      titleKey: "auth.errors.validationFailed.title",
      detailKey: "auth.errors.validationFailed.detail",
      requiredAction: "none",
      correlationId: "test-correlation",
    },
  };
}

test("document request outcome maps requested response correctly", () => {
  const outcome = toDocumentRequestOutcome(
    {
      document_request_id: "req-123",
      status: "queued",
      document_type: "final_report",
      correlationId: "corr-456",
    },
    true,
    200,
  );

  assert.equal(outcome.kind, "requested");
  if (outcome.kind === "requested") {
    assert.equal(outcome.data.document_request_id, "req-123");
    assert.equal(outcome.data.status, "queued");
    assert.equal(outcome.data.document_type, "final_report");
    assert.equal(outcome.data.correlationId, "corr-456");
  }
});

test("document request outcome maps auth errors to redirect", () => {
  assert.deepEqual(
    toDocumentRequestOutcome(
      problem(AUTH_ERROR_CODES.sessionInvalid, 401),
      false,
      401,
    ),
    { kind: "redirect", location: "/sign-in" },
  );
});

test("document request outcome maps classification guardrail failure to blocked", () => {
  const outcome = toDocumentRequestOutcome(
    problem(DOCUMENT_ERROR_CODES.classificationGuardrailNotPassed, 409),
    false,
    409,
  );

  assert.equal(outcome.kind, "blocked");
  if (outcome.kind === "blocked") {
    assert.equal(outcome.titleKey, "pages.classification.errorTitle");
    assert.equal(
      outcome.detailKey,
      "pages.classification.documentGuardrailBlocked",
    );
  }
});

test("document request outcome maps invalid payload to generic error", () => {
  const outcome = toDocumentRequestOutcome(null, true, 200);

  assert.equal(outcome.kind, "error");
  if (outcome.kind === "error") {
    assert.equal(outcome.titleKey, "pages.classification.errorTitle");
    assert.equal(outcome.detailKey, "pages.classification.errorDetail");
  }
});

test("sanitizeDocumentRequestPayload accepts valid payloads", () => {
  assert.deepEqual(
    sanitizeDocumentRequestPayload({
      document_request_id: "req-321",
      status: "queued",
      document_type: "FinalReport",
      correlationId: "corr-654",
    }),
    {
      document_request_id: "req-321",
      status: "queued",
      document_type: "FinalReport",
      correlationId: "corr-654",
    },
  );
});

test("sanitizeDocumentRequestPayload rejects invalid payloads", () => {
  assert.equal(
    sanitizeDocumentRequestPayload({
      document_request_id: 123,
      status: "queued",
      document_type: "FinalReport",
      correlationId: "corr-654",
    }),
    null,
  );
});
