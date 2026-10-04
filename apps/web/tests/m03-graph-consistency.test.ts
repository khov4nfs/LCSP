import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { apiQueryKeys } from "../src/lib/api/query-keys";
import {
  getProgramEvidenceGraphDetailState,
  PROGRAM_EVIDENCE_GRAPH_DETAIL_LOAD_STATES,
  type ProgramEvidenceGraphDetail,
} from "../src/lib/api/evidence-graph-detail-client";
import { getProgramEvidenceGraphOverview, isGraphOverviewReadyFor } from "../src/lib/api/evidence-graph-overview-client";

const fixture = JSON.parse(await readFile(new URL("../src/public/assets/mocks/m03-graph-consistency.json", import.meta.url), "utf8")) as ProgramEvidenceGraphDetail;
const filters = { snapshotId: fixture.provenance.snapshot_id, scanJobId: fixture.provenance.scan_job_id };

async function withResponse(payload: unknown, run: (requests: string[]) => Promise<void>) {
  const original = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (input) => {
    requests.push(String(input));
    return new Response(JSON.stringify({ ok: true, data: payload }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try { await run(requests); } finally { globalThis.fetch = original; }
}

test("SSE Graph prefix invalidates all filtered versions, not other Assessments", async () => {
  const client = new QueryClient();
  const selected = apiQueryKeys.assessment.evidenceGraphOverview("assessment", filters);
  const historical = apiQueryKeys.assessment.evidenceGraphOverview("assessment", { snapshotId: "old-snapshot", scanJobId: "old-job" });
  const other = apiQueryKeys.assessment.evidenceGraphOverview("other", filters);
  try {
    for (const key of [selected, historical, other]) client.setQueryData(key, fixture.overview);
    await client.invalidateQueries({ queryKey: apiQueryKeys.assessment.evidenceGraphOverviewRoot("assessment"), refetchType: "none" });
    assert.equal(client.getQueryState(selected)?.isInvalidated, true);
    assert.equal(client.getQueryState(historical)?.isInvalidated, true);
    assert.equal(client.getQueryState(other)?.isInvalidated, false);
  } finally { client.clear(); }
});

test("SSE invalidation refetches an active filtered Overview after report arrival", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  let available = false;
  let reads = 0;
  const observer = new QueryObserver(client, {
    queryKey: apiQueryKeys.assessment.evidenceGraphOverview("assessment", filters),
    queryFn: async () => { reads += 1; return available ? fixture.overview : null; },
  });
  const unsubscribe = observer.subscribe(() => undefined);
  try {
    await observer.refetch();
    assert.equal(observer.getCurrentResult().data, null);
    const before = reads;
    available = true;
    await client.invalidateQueries({ queryKey: apiQueryKeys.assessment.evidenceGraphOverviewRoot("assessment") });
    assert.ok(reads > before);
    assert.equal(observer.getCurrentResult().data?.report_id, fixture.overview.report_id);
  } finally { unsubscribe(); client.clear(); }
});

test("Graph Detail sends selected snapshot/job and accepts their matching provenance", async () => {
  await withResponse(fixture, async (requests) => {
    const result = await getProgramEvidenceGraphDetailState("assessment", filters);
    assert.equal(result.state, PROGRAM_EVIDENCE_GRAPH_DETAIL_LOAD_STATES.ready);
    const url = new URL(requests[0], "http://localhost");
    assert.equal(url.searchParams.get("snapshotId"), filters.snapshotId);
    assert.equal(url.searchParams.get("scanJobId"), filters.scanJobId);
  });
});

test("Graph Detail refuses a successful response for a different run", async () => {
  await withResponse(fixture, async () => {
    const result = await getProgramEvidenceGraphDetailState("assessment", { ...filters, scanJobId: "different-run" });
    assert.equal(result.state, PROGRAM_EVIDENCE_GRAPH_DETAIL_LOAD_STATES.unavailable);
    assert.equal(result.detail, null);
  });
});

test("Overview retains checked readiness and provenance while rejecting mismatched responses", async () => {
  await withResponse(fixture.overview, async () => {
    const result = await getProgramEvidenceGraphOverview("assessment", filters);
    assert.equal(result?.graph_ready, true);
    assert.equal(result?.modules_analyzed, 0);
    assert.equal(result?.report_id, fixture.overview.report_id);
    assert.equal(await getProgramEvidenceGraphOverview("assessment", { ...filters, snapshotId: "different-snapshot" }), null);
  });
});

test("IDs and metrics alone are not proof of Graph readiness", () => {
  const { graph_ready: ignored, ...metricsOnly } = fixture.overview;
  void ignored;
  assert.equal(isGraphOverviewReadyFor(metricsOnly, filters), false);
  assert.equal(isGraphOverviewReadyFor({ ...fixture.overview, graph_ready: false }, filters), false);
  assert.equal(isGraphOverviewReadyFor(fixture.overview, filters, "wrong-report"), false);
  assert.equal(isGraphOverviewReadyFor(fixture.overview, filters, fixture.provenance.evidence_report_id), true);
});
