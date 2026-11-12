import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildDevelopmentReviewView } from "./preparation-development-review-view.mjs";

const triage = JSON.parse(
  readFileSync(
    new URL(
      "../docs/RULE_SET_PREPARATION_DEVELOPMENT_SCOPE_TRIAGE_VI.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

test("development view suppresses deployment law units and unrelated context", () => {
  const view = buildDevelopmentReviewView(triage);
  assert.equal(view.activationEligible, false);
  assert.equal(view.status, "REVIEW_ONLY_NOT_ACTIVATABLE");
  assert.deepEqual(view.counts, {
    totalSourceUnitsInSeparateFullSourceLedger: 171,
    developmentCandidates: 5,
    mixedNeedsAtomization: 15,
    nonDevelopmentUnitsSuppressed: 99,
    unrelatedContextSuppressed: 31,
    unresolvedUnitsSuppressed: 21,
    approvedMaterialContext: 0,
  });
  const serialized = JSON.stringify(view);
  assert.ok(!serialized.includes("sourceText"));
  assert.ok(!serialized.includes("Bên triển khai được kế thừa"));
  assert.ok(!serialized.includes("Mục 6"));
  assert.equal(view.retainedMaterialContext.length, 0);
});

test("unapproved or unverified deployment context cannot enter review projection", () => {
  const context = triage.rows.find(
    (row) => row.stageTriage === "CONTEXT_ONLY_IF_LINKED",
  );
  const target = triage.rows.find(
    (row) => row.stageTriage === "DEVELOPMENT_CANDIDATE",
  );
  const common = {
    contextLegalUnitId: context.legalUnitId,
    targetLegalUnitId: target.legalUnitId,
  };
  assert.equal(
    buildDevelopmentReviewView(triage, {
      materialLinks: [{ ...common, reviewerStatus: "PENDING" }],
    }).retainedMaterialContext.length,
    0,
  );
  assert.throws(
    () =>
      buildDevelopmentReviewView(triage, {
        materialLinks: [
          {
            ...common,
            reviewerStatus: "APPROVED",
            reviewerId: "human",
            relationKind: "CONDITION_OF",
            sourceNodeId: "a".repeat(64),
            targetSourceNodeId: "b".repeat(64),
            pinnedLegalSourceVersionId: "law-v1",
            materialPredicate: context.sourceText.slice(0, 80),
          },
        ],
      }),
    /verified pinned nodes/,
  );
});

test("a source-pinned reviewed context adds only the verified minimal predicate", () => {
  const sample = structuredClone(triage);
  const context = sample.rows.find(
    (row) => row.stageTriage === "CONTEXT_ONLY_IF_LINKED",
  );
  const target = sample.rows.find(
    (row) => row.stageTriage === "DEVELOPMENT_CANDIDATE",
  );
  context.sourceNodeId = "a".repeat(64);
  target.sourceNodeId = "b".repeat(64);
  context.pinnedLegalSourceVersionId = "law-v1";
  target.pinnedLegalSourceVersionId = "law-v1";
  const materialPredicate = context.sourceText.slice(0, 80);
  const view = buildDevelopmentReviewView(sample, {
    materialLinks: [
      {
        contextLegalUnitId: context.legalUnitId,
        targetLegalUnitId: target.legalUnitId,
        reviewerStatus: "APPROVED",
        reviewerId: "human",
        relationKind: "CONDITION_OF",
        sourceNodeId: context.sourceNodeId,
        targetSourceNodeId: target.sourceNodeId,
        pinnedLegalSourceVersionId: "law-v1",
        materialPredicate,
      },
    ],
  });
  assert.equal(view.retainedMaterialContext.length, 1);
  assert.equal(
    view.retainedMaterialContext[0].materialPredicate,
    materialPredicate,
  );
  assert.ok(!Object.hasOwn(view.retainedMaterialContext[0], "sourceText"));
});

test("unknown or duplicate units fail closed", () => {
  const unknown = structuredClone(triage);
  unknown.rows[0].stageTriage = "DEPLOYMENT_ONLY_FAKE";
  assert.throws(
    () => buildDevelopmentReviewView(unknown),
    /Invalid, duplicated/,
  );
  const duplicate = structuredClone(triage);
  duplicate.rows[1].legalUnitId = duplicate.rows[0].legalUnitId;
  assert.throws(
    () => buildDevelopmentReviewView(duplicate),
    /Invalid, duplicated/,
  );
});
