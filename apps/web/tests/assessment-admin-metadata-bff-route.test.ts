import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import { GET as listAssessments } from "../src/app/api/assessments/route";
import { GET as getAssessment } from "../src/app/api/assessments/[id]/route";

const assessmentId = "11111111-1111-4111-8111-111111111111";
const metadata = {
  assessment_id: assessmentId,
  owner_id: "customer-1",
  name: "Metadata only",
  lifecycle_state: "ACTIVE",
  execution_state: "RUNNING",
  created_at: "2026-11-23T00:00:00.000Z",
  updated_at: "2026-11-23T01:00:00.000Z",
};

function request(path: string) {
  return new NextRequest(`http://localhost${path}`, {
    headers: { cookie: "lcsp_session=session-token" },
  });
}

test("assessment BFF executes both strict CUSTOMER and ADMIN read contracts", async () => {
  const original = globalThis.fetch;
  let payload: unknown = { ...metadata, correlationId: "admin-detail" };
  globalThis.fetch = () =>
    Promise.resolve(Response.json({ ok: true, data: payload }));
  try {
    const adminDetail = await getAssessment(
      request(`/api/assessments/${assessmentId}`),
      { params: Promise.resolve({ id: assessmentId }) },
    );
    assert.equal(adminDetail.status, 200);
    assert.deepEqual((await adminDetail.json()).data, payload);

    payload = {
      assessment_id: assessmentId,
      owner_id: "customer-1",
      name: "Customer detail",
      lifecycle: null,
      runtime: null,
      case: null,
      created_at: metadata.created_at,
      updated_at: metadata.updated_at,
      correlationId: "customer-detail",
    };
    const customerDetail = await getAssessment(
      request(`/api/assessments/${assessmentId}`),
      { params: Promise.resolve({ id: assessmentId }) },
    );
    assert.equal(customerDetail.status, 200);
    assert.deepEqual((await customerDetail.json()).data, payload);

    payload = {
      assessments: [metadata],
      total: 1,
      page: 1,
      page_size: 20,
      correlationId: "admin-list",
    };
    const adminList = await listAssessments(request("/api/assessments"));
    assert.equal(adminList.status, 200);
    assert.deepEqual((await adminList.json()).data, payload);
  } finally {
    globalThis.fetch = original;
  }
});

test("assessment BFF rejects ADMIN metadata containing customer-content fields", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(
      Response.json({
        ok: true,
        data: {
          ...metadata,
          correlationId: "admin-leak",
          case: null,
        },
      }),
    );
  try {
    const response = await getAssessment(
      request(`/api/assessments/${assessmentId}`),
      { params: Promise.resolve({ id: assessmentId }) },
    );
    assert.equal(response.status, 502);
  } finally {
    globalThis.fetch = original;
  }
});
