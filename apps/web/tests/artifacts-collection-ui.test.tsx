import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { DOCUMENT_VIEW_MODES } from "../src/components/molecules/gallery-list-toggle";
import { ArtifactList } from "../src/features/artifacts/components/artifact-list";
import { ArtifactsPage } from "../src/features/artifacts/components/artifacts-page";
import {
  ARTIFACT_STATUSES,
  ARTIFACT_TYPES,
  type ArtifactGroup,
} from "../src/features/artifacts/types/artifact.types";
import { setAppLocale } from "../src/lib/locale";

const SAMPLE_GROUPS: ArtifactGroup[] = [
  {
    assessmentId: "assess-1",
    title: "Social network",
    context: "acme/notice-service",
    updatedAt: "Nov 27, 2026",
    artifacts: [
      {
        title: "Compliance report",
        context: "Pinned revision abc1234",
        status: ARTIFACT_STATUSES.ready,
        ref: {
          type: ARTIFACT_TYPES.finalReport,
          assessmentId: "assess-1",
          resourceId: "rep-1",
        },
      },
      {
        title: "Evidence bundle",
        context: "Generating",
        status: ARTIFACT_STATUSES.waiting,
        ref: {
          type: ARTIFACT_TYPES.finalReport,
          assessmentId: "assess-1",
          resourceId: "bundle-1",
        },
      },
    ],
  },
];

describe("Artifacts Library UI (Frame 28)", () => {
  beforeEach(() => {
    setAppLocale("en");
  });

  afterEach(() => {
    setAppLocale("en");
  });

  it("renders ArtifactsPage with metrics, tabs, Gallery/List toggle, and empty state", () => {
    const populatedHtml = renderToStaticMarkup(
      <ArtifactsPage groups={SAMPLE_GROUPS} />,
    );
    assert.match(populatedHtml, /Social network/);
    assert.match(populatedHtml, /Compliance report/);
    assert.match(populatedHtml, /Gallery/);
    assert.match(populatedHtml, /List/);

    const emptyHtml = renderToStaticMarkup(<ArtifactsPage groups={[]} />);
    assert.match(emptyHtml, /0/);
  });

  it("renders ArtifactList in both gallery and list modes", () => {
    const galleryHtml = renderToStaticMarkup(
      <ArtifactList groups={SAMPLE_GROUPS} mode={DOCUMENT_VIEW_MODES.gallery} />,
    );
    assert.match(galleryHtml, /Compliance report/);
    assert.match(galleryHtml, /acme\/notice-service/);

    const listHtml = renderToStaticMarkup(
      <ArtifactList groups={SAMPLE_GROUPS} mode={DOCUMENT_VIEW_MODES.list} />,
    );
    assert.match(listHtml, /Compliance report/);
    assert.match(listHtml, /Evidence bundle/);
  });
});
