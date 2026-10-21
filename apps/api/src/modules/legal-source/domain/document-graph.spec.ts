import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import {
  LEGAL_DOCUMENT_NODE_TYPES as N,
  LEGAL_REFERENCE_RESOLUTION_STATES as R,
} from "@lcsp/contracts/legal-source";
import {
  buildLegalDocumentGraph,
  buildLegalRetrievalUnits,
  type StructuralSourceDocument,
} from "./document-graph.js";

const version = "00000000-0000-4000-8000-000000000001";
function document(
  pages: string[],
  documentId = "synthetic",
): StructuralSourceDocument {
  return {
    documentId,
    title: "Synthetic structural fixture",
    sourceSha256: "synthetic-original-hash",
    snapshotPath: "synthetic.txt",
    extraction: { pages, pageCount: pages.length },
    chunks: [],
  };
}
const vn =
  "Chương I\nQuy định chung\nMục 1. Phạm vi\nĐiều 1. Định nghĩa\n1. Nội dung thứ nhất.\na) Nội dung điểm a.\nb) Xem khoản 1 Điều 2.\nĐiều 2. Nghĩa vụ\n1. Nội dung thứ hai.";
const eu =
  "Title I\nChapter I\nSection 1\nArticle 1 — Definitions\nParagraph 1. Text.\nPoint (a) Text.\nArticle 2 — Duty\nParagraph 1. See Article 1(1)(a).";
describe("Legal Document AST: structural interpretation only", () => {
  it("materializes the final eight-Article fixture with real cross-page hierarchy and resolved references before model calls", () => {
    const fixture = JSON.parse(
      readFileSync(
        new URL(
          "../../../../../../tests/fixtures/legal-graph/extraction.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as { extraction: { pages: string[] } };
    const input = document(fixture.extraction.pages);
    input.provenance = {
      legalEffectMetadata: {
        status: "EFFECTIVE",
        sourceRef: "synthetic-fixture",
      },
    };
    const graph = buildLegalDocumentGraph(version, [input]);
    expect(graph.nodes.filter((n) => n.nodeType === N.ARTICLE)).toHaveLength(8);
    expect(graph.nodes.filter((n) => n.nodeType === N.CHAPTER)).toHaveLength(2);
    expect(graph.references.length).toBeGreaterThan(10);
    expect(
      graph.references.every((r) => r.resolutionState === R.RESOLVED),
    ).toBe(true);
    expect(
      graph.nodes.find((n) => n.nodeType === N.ARTICLE && n.label === "2"),
    ).toMatchObject({ pageStart: 1, pageEnd: 2 });
    expect(
      graph.nodes.find((n) => n.nodeType === N.ARTICLE && n.label === "4"),
    ).toMatchObject({ pageStart: 2, pageEnd: 3 });
  });
  it("preserves detected extraction gaps as immutable graph limitations, not missing legal claims", () => {
    const input = document(
      ["Article 1. An extracted legal sentence.", ""],
      "partially-extracted-source",
    );
    input.extraction = {
      pages: ["Article 1. An extracted legal sentence.", ""],
      pageCount: 2,
      gaps: [{ kind: "NO_TEXT_LAYER", page: 2 }],
    };
    const partial = buildLegalDocumentGraph(version, [input]);
    expect(partial.extractionGaps).toEqual([
      {
        documentId: "partially-extracted-source",
        kind: "NO_TEXT_LAYER",
        page: 2,
      },
    ]);
    input.extraction = {
      pages: ["Article 1. An extracted legal sentence.", ""],
      pageCount: 2,
      gaps: [],
    };
    const complete = buildLegalDocumentGraph(version, [input]);
    expect(complete.extractionGaps).toEqual([]);
    expect(complete.nodes.map((node) => node.nodeId)).toEqual(
      partial.nodes.map((node) => node.nodeId),
    );
    expect(complete.materializationId).not.toBe(partial.materializationId);
    expect(complete.graphDigest).not.toBe(partial.graphDigest);
  });
  it("propagates recorded effect without interpreting source wording and preserves status on point children", () => {
    const input = document([
      "Preface. A keeper must keep a ledger.\nArticle 1. Text\n1. A duty.\na) Detail.",
    ]);
    input.provenance = {
      legalEffectMetadata: {
        status: "EFFECTIVE",
        sourceRef: "source:synthetic-effect",
      },
    };
    const graph = buildLegalDocumentGraph(version, [input]);
    expect(
      graph.nodes.every(
        (n) =>
          n.legalEffectStatus === "EFFECTIVE" &&
          n.legalStatusSourceRefs[0] === "source:synthetic-effect",
      ),
    ).toBe(true);
    input.provenance = null;
    expect(
      buildLegalDocumentGraph(version, [input]).nodes.every(
        (n) => n.legalEffectStatus === "UNKNOWN",
      ),
    ).toBe(true);
  });
  it("retains Vietnam-like chapter/section/article/clause/point hierarchy and resolves intra-document references", () => {
    const g = buildLegalDocumentGraph(version, [document([vn])]);
    const point = g.nodes.find(
      (n) => n.nodeType === N.POINT && n.label === "b",
    )!;
    expect(g.nodes.find((n) => n.nodeId === point.parentNodeId)?.nodeType).toBe(
      N.CLAUSE,
    );
    expect(point.structuralPath).toContain(
      "/chapter/i/section/1/article/1/clause/1/point/b",
    );
    const ref = g.references.find((r) => r.text === "khoản 1 Điều 2")!;
    expect(ref.resolutionState).toBe(R.RESOLVED);
    expect(
      g.nodes.find((n) => n.nodeId === ref.toNodeId)?.structuralPath,
    ).toContain("/article/2/clause/1");
  });
  it("supports EU hierarchy, explicit paragraph/point and cross Article references", () => {
    const g = buildLegalDocumentGraph(version, [document([eu])]);
    const r = g.references.find((r) => r.text === "Article 1(1)(a)")!;
    expect(r.resolutionState).toBe(R.RESOLVED);
    expect(g.nodes.find((n) => n.nodeId === r.toNodeId)?.nodeType).toBe(
      N.POINT,
    );
    expect(g.nodes.some((n) => n.nodeType === N.TITLE)).toBe(true);
  });
  it("supports US title/chapter/subchapter/section/subsection/paragraph", () => {
    const g = buildLegalDocumentGraph(version, [
      document([
        "Title 1\nChapter 2\nSubchapter A\nSection 5. Records\n(a) Keep records.\n(1) First paragraph.\n(2) Second paragraph.",
      ]),
    ]);
    expect(
      g.nodes.find((n) => n.nodeType === N.PARAGRAPH)?.structuralPath,
    ).toContain(
      "/title/1/chapter/2/subchapter/a/section/5/subsection/a/paragraph/1",
    );
  });
  it("preserves identity across page boundaries and propagates article physical spans", () => {
    const text =
      "Article 1. Long article\n1. First paragraph.\nMore text here.\n2. Second paragraph.";
    const one = buildLegalDocumentGraph(version, [document([text])]);
    const split = buildLegalDocumentGraph(version, [
      document(
        text
          .split("\nMore text here.\n")
          .map((s, i) => (i === 0 ? s + "\nMore text here." : s)),
      ),
    ]);
    expect(split.nodes.map((n) => n.nodeId)).toEqual(
      one.nodes.map((n) => n.nodeId),
    );
    expect(split.nodes.find((n) => n.nodeType === N.ARTICLE)).toMatchObject({
      pageStart: 1,
      pageEnd: 2,
    });
    expect(one.nodes.filter((n) => n.nodeType === N.PARAGRAPH)).toHaveLength(2);
  });
  it("does not use page identity for multiple provisions on one page", () => {
    const g = buildLegalDocumentGraph(version, [
      document(["Article 1. One\nText one.\nArticle 2. Two\nText two."]),
    ]);
    const articles = g.nodes.filter((n) => n.nodeType === N.ARTICLE);
    expect(new Set(articles.map((n) => n.nodeId)).size).toBe(2);
    expect(articles.every((n) => n.pageStart === 1)).toBe(true);
  });
  it("retains unresolved and ambiguous references without classifying their semantic role", () => {
    const g = buildLegalDocumentGraph(version, [
      document([
        "Article 1. Duplicate\nFirst.\nArticle 1. Duplicate again\nSecond.\nArticle 2. Refs\nSubject to Article 1 and Article 99.",
      ]),
    ]);
    expect(
      g.references.find((r) => r.text === "Article 99")?.resolutionState,
    ).toBe(R.UNRESOLVED);
    expect(
      g.references.find(
        (r) => r.text === "Article 1" && r.resolutionState === R.AMBIGUOUS,
      )?.candidateNodeIds,
    ).toHaveLength(2);
    expect(g.references.every((r) => !("kind" in r))).toBe(true);
  });
  it("keeps annex/schedule/table material navigable and source versions isolated", () => {
    const input = [
      document([
        "Article 1. Text\nBody.\nAnnex I\nTable 1. Records\nCell text.\nSchedule 2\nItem 1. More.",
      ]),
    ];
    const first = buildLegalDocumentGraph(version, input);
    expect(
      first.nodes.filter((n) =>
        [N.ANNEX, N.SCHEDULE, N.TABLE].includes(n.nodeType as typeof N.ANNEX),
      ),
    ).toHaveLength(3);
    expect(buildLegalDocumentGraph(version, input)).toEqual(first);
    expect(
      buildLegalDocumentGraph("00000000-0000-4000-8000-000000000002", input)
        .nodes[0].nodeId,
    ).not.toBe(first.nodes[0].nodeId);
  });
  it("maps extracted chunks to the narrowest source node even when locator names differ from document structure", () => {
    const input = document([
      "Section 1. Identity\nThe first section keeps a ledger.\nSection 2. Processing\nThe second section checks the ledger.",
    ]);
    input.chunks = [
      {
        id: "chunk-one",
        locator: "art-1",
        content: "Section 1. Identity\nThe first section keeps a ledger.",
        contentSha256: "source-owned-one",
        hierarchy: {},
        pageStart: 1,
        pageEnd: 1,
      },
      {
        id: "chunk-two",
        locator: "art-2",
        content: "Section 2. Processing\nThe second section checks the ledger.",
        contentSha256: "source-owned-two",
        hierarchy: {},
        pageStart: 1,
        pageEnd: 1,
      },
    ];
    const graph = buildLegalDocumentGraph(version, [input]);
    const owners = graph.chunkMappings.map((mapping) =>
      graph.nodes.find((node) => node.nodeId === mapping.legalDocumentNodeId),
    );
    expect(owners.map((node) => [node?.nodeType, node?.label])).toEqual([
      [N.SECTION, "1"],
      [N.SECTION, "2"],
    ]);
    // A repeated retrieval locator must not override exact source position.
    input.chunks[1].locator = "art-1";
    const repeatedLocator = buildLegalDocumentGraph(version, [input]);
    expect(repeatedLocator.chunkMappings[1].legalDocumentNodeId).toBe(
      repeatedLocator.nodes.find(
        (node) => node.nodeType === N.SECTION && node.label === "2",
      )!.nodeId,
    );
  });
  it("maps legacy retrieval parts to the same stable clause, ignoring semantic metadata", () => {
    const input = document([]);
    input.extraction = null;
    const chunk = {
      id: "retrieval-1",
      locator: "art-2::cl-1",
      content: "1. First.\na) Second.",
      contentSha256: "hash",
      hierarchy: { chapterNumber: "I", normativeClass: "UNTRUSTED_SEMANTICS" },
      pageStart: null,
      pageEnd: null,
    };
    input.chunks = [chunk];
    const first = buildLegalDocumentGraph(version, [input]);
    input.chunks = [
      { ...chunk, locator: "art-2::cl-1::part-1", content: "1. First." },
      {
        ...chunk,
        id: "retrieval-2",
        locator: "art-2::cl-1::part-2",
        content: "a) Second.",
      },
    ];
    const second = buildLegalDocumentGraph(version, [input]);
    expect(second.chunkMappings.map((m) => m.legalDocumentNodeId)).toEqual([
      first.chunkMappings[0].legalDocumentNodeId,
      first.chunkMappings[0].legalDocumentNodeId,
    ]);
    expect(
      second.nodes.every((n) => n.pageStart === null && n.charStart === null),
    ).toBe(true);
    expect(JSON.stringify(second.nodes)).not.toContain("UNTRUSTED_SEMANTICS");
  });
  it("regenerates retrieval windows without changing any document-node identity", () => {
    const graph = buildLegalDocumentGraph(version, [
      document(["Article 1. Long\n1. " + "word ".repeat(4000)]),
    ]);
    const identities = graph.nodes.map((n) => n.nodeId);
    const windows = buildLegalRetrievalUnits(graph.nodes, 1000);
    expect(windows.length).toBeGreaterThan(graph.retrievalUnits.length);
    expect(
      windows.every(
        (w) =>
          identities.includes(w.legalDocumentNodeId) &&
          w.content.length <= 1000,
      ),
    ).toBe(true);
    expect(graph.nodes.map((n) => n.nodeId)).toEqual(identities);
    expect(() => buildLegalRetrievalUnits(graph.nodes, 0)).toThrow();
  });
  it("resolves relative point references inside the current paragraph and retains foreign-instrument references unresolved", () => {
    const graph = buildLegalDocumentGraph(version, [
      document([
        "Article 1. Test\n1. First\na) One.\nb) See point (a).\n2. Second\na) Other point.\nb) See Article 1 of the Other Act.",
      ]),
    ]);
    const relative = graph.references.find((r) => r.text === "point (a)")!;
    expect(relative.resolutionState).toBe(R.RESOLVED);
    expect(
      graph.nodes.find((n) => n.nodeId === relative.toNodeId)?.structuralPath,
    ).toContain("/paragraph/1/point/a");
    expect(
      graph.references.find(
        (r) => r.text === "Article 1" && r.resolutionState === R.UNRESOLVED,
      ),
    ).toBeDefined();
  });
  it("handles thousands of nodes/references deterministically without whole-source prompt expansion", () => {
    const text = Array.from(
      { length: 1500 },
      (_, i) => `Article ${i + 1}. Title\n1. See Article ${i || 1}.`,
    ).join("\n");
    const start = performance.now();
    const g = buildLegalDocumentGraph(version, [document([text])]);
    expect(g.nodes).toHaveLength(3001);
    expect(g.references.length).toBeGreaterThanOrEqual(1500);
    expect(performance.now() - start).toBeLessThan(5000);
  });
});
