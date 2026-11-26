import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { DocumentGalleryCard } from "../src/components/molecules/document-gallery-card";
import {
  DOCUMENT_VIEW_MODES,
  GalleryListToggle,
} from "../src/components/molecules/gallery-list-toggle";
import { DocumentCollection } from "../src/components/organisms/document-collection";
import { setAppLocale } from "../src/lib/locale";

describe("Reports & shared DocumentCollection components (Frames 23, 27, 87)", () => {
  beforeEach(() => {
    setAppLocale("en");
  });

  afterEach(() => {
    setAppLocale("en");
  });

  it("renders GalleryListToggle with aria-pressed and EN/VI labels", () => {
    const htmlEn = renderToStaticMarkup(
      <GalleryListToggle
        mode={DOCUMENT_VIEW_MODES.gallery}
        onModeChange={() => {}}
      />,
    );
    assert.match(htmlEn, /Gallery/);
    assert.match(htmlEn, /List/);
    assert.match(htmlEn, /aria-pressed="true"/);

    setAppLocale("vi");
    const htmlVi = renderToStaticMarkup(
      <GalleryListToggle
        mode={DOCUMENT_VIEW_MODES.list}
        onModeChange={() => {}}
      />,
    );
    assert.match(htmlVi, /Thẻ/);
    assert.match(htmlVi, /Danh sách/);
  });

  it("renders DocumentGalleryCard with status, title, source, date, and action link", () => {
    const html = renderToStaticMarkup(
      <DocumentGalleryCard
        title="Social network final report"
        status="Current"
        source="acme/notice-service"
        date="Nov 27, 2026"
        actionLabel="Open report"
        actionHref="/assessments/assess-1/report"
      />,
    );

    assert.match(html, /Social network final report/);
    assert.match(html, /Current/);
    assert.match(html, /acme\/notice-service/);
    assert.match(html, /Nov 27, 2026/);
    assert.match(html, /Open report/);
    assert.match(html, /\/assessments\/assess-1\/report/);
  });

  it("renders DocumentCollection gallery, list, empty, and error states", () => {
    const galleryHtml = renderToStaticMarkup(
      <DocumentCollection
        mode={DOCUMENT_VIEW_MODES.gallery}
        onModeChange={() => {}}
        search=""
        onSearchChange={() => {}}
        searchPlaceholder="Search reports…"
        galleryView={<div>GalleryGrid</div>}
        listView={<div>ListTable</div>}
      />,
    );
    assert.match(galleryHtml, /GalleryGrid/);
    assert.doesNotMatch(galleryHtml, /ListTable/);

    const listHtml = renderToStaticMarkup(
      <DocumentCollection
        mode={DOCUMENT_VIEW_MODES.list}
        onModeChange={() => {}}
        galleryView={<div>GalleryGrid</div>}
        listView={<div>ListTable</div>}
      />,
    );
    assert.match(listHtml, /ListTable/);
    assert.doesNotMatch(listHtml, /GalleryGrid/);

    const emptyHtml = renderToStaticMarkup(
      <DocumentCollection
        mode={DOCUMENT_VIEW_MODES.gallery}
        onModeChange={() => {}}
        isEmpty
        emptySlot={<div>No reports</div>}
        galleryView={<div>GalleryGrid</div>}
        listView={<div>ListTable</div>}
      />,
    );
    assert.match(emptyHtml, /No reports/);

    const errorHtml = renderToStaticMarkup(
      <DocumentCollection
        mode={DOCUMENT_VIEW_MODES.gallery}
        onModeChange={() => {}}
        isError
        errorSlot={<div>Failed to load</div>}
        galleryView={<div>GalleryGrid</div>}
        listView={<div>ListTable</div>}
      />,
    );
    assert.match(errorHtml, /Failed to load/);
  });
});
