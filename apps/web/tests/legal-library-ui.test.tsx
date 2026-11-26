import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { LegalDocumentCard } from "../src/features/legal-library/components/molecules/legal-document-card";
import {
  CitationLink,
  ProvisionSearch,
} from "../src/features/legal-library/components/molecules/provision-search";
import { setAppLocale } from "../src/lib/locale";

describe("Legal Library UI components (Frames 25-26)", () => {
  beforeEach(() => {
    setAppLocale("en");
  });

  afterEach(() => {
    setAppLocale("en");
  });

  it("renders LegalDocumentCard with section badge, metadata, and safe HTTPS link", () => {
    const html = renderToStaticMarkup(
      <LegalDocumentCard
        document={{
          id: "doc-1",
          documentId: "doc-1",
          title: "Decree 147/2024/ND-CP",
          sourceUrl: "https://example.gov.vn/decree-147",
          sourceEffectStatus: "EFFECTIVE",
          effectiveDate: "2024-12-25",
          chunkCount: 42,
          mediaType: "application/pdf",
          hasOriginal: true,
        }}
      />,
    );

    assert.match(html, /Decree 147\/2024\/ND-CP/);
    assert.match(html, /EFFECTIVE/);
    assert.match(html, /2024-12-25/);
    assert.match(html, /42/);
    assert.match(html, /\/laws\/doc-1/);
    assert.match(html, /https:\/\/example\.gov\.vn\/decree-147/);
    assert.match(html, /Read document/);

    const unsafeHtml = renderToStaticMarkup(
      <LegalDocumentCard
        document={{
          id: "doc-2",
          documentId: "doc-2",
          title: "Local doc",
          sourceUrl: "javascript:alert(1)",
          sourceEffectStatus: "EFFECTIVE",
          effectiveDate: null,
          chunkCount: 1,
          mediaType: null,
          hasOriginal: false,
        }}
      />,
    );
    assert.doesNotMatch(unsafeHtml, /javascript:/);
    assert.doesNotMatch(unsafeHtml, /Open official source/);
  });

  it("renders ProvisionSearch and CitationLink in EN and VI", () => {
    const htmlEn = renderToStaticMarkup(
      <ProvisionSearch
        query=""
        onQueryChange={() => {}}
        items={[
          {
            id: "chunk-1",
            locator: "Art. 27(2)(b)",
            hierarchyPath: "Chapter III > Section 2",
          },
        ]}
      />,
    );
    assert.match(htmlEn, /Provisions \(1\)/);
    assert.match(htmlEn, /#chunk-chunk-1/);
    assert.match(htmlEn, /Art\. 27\(2\)\(b\)/);

    setAppLocale("vi");
    const htmlVi = renderToStaticMarkup(
      <ProvisionSearch query="missing" onQueryChange={() => {}} items={[]} />,
    );
    assert.match(htmlVi, /Điều khoản \(0\)/);
    assert.match(htmlVi, /Tài liệu này chưa có điều khoản/);

    const linkHtml = renderToStaticMarkup(
      <CitationLink item={{ id: "c-9", locator: "Art. 10" }} />,
    );
    assert.match(linkHtml, /#chunk-c-9/);
  });
});
