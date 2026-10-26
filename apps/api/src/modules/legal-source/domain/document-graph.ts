import { createHash } from "node:crypto";
import {
  LEGAL_DOCUMENT_GRAPH as REVISION,
  LEGAL_DOCUMENT_NODE_TYPES as N,
  LEGAL_GRAPH_INPUT_MODES as MODES,
  LEGAL_REFERENCE_RESOLUTION_STATES as R,
  LEGAL_SOURCE_CHUNK_STATUSES as EFFECT,
  legalSourceExtractionGapSchema,
  type LegalSourceChunkStatus,
  type LegalSourceDocumentCorpusRole,
  LEGAL_SOURCE_DOCUMENT_CORPUS_ROLES,
  type LegalDocumentGraph,
  type LegalDocumentNode,
  type LegalDocumentNodeType,
  type LegalDocumentReference,
} from "@lcsp/contracts/legal-source";
import {
  LEGAL_STRUCTURE_HEADINGS,
  LEGAL_STRUCTURE_REFERENCE,
  structuralWordType,
} from "./document-structure.config.js";

export interface StructuralSourceChunk {
  id: string;
  locator: string;
  content: string;
  contentSha256: string;
  hierarchy: unknown;
  pageStart: number | null;
  pageEnd: number | null;
  legalEffectStatus?: LegalSourceChunkStatus;
  legalStatusSourceRef?: string | null;
}
export interface StructuralSourceDocument {
  documentId: string;
  title: string;
  sourceSha256: string;
  corpusRole?: LegalSourceDocumentCorpusRole;
  snapshotPath: string | null;
  extraction: unknown;
  provenance?: unknown;
  chunks: StructuralSourceChunk[];
}
/** Source extraction limitations remain visible across materialization and Agent export.
 * These are extraction facts, never inferred legal propositions. */
export function extractionGapsOf(
  documents: ReadonlyArray<
    Pick<StructuralSourceDocument, "documentId" | "extraction">
  >,
) {
  return documents
    .flatMap((document) => {
      const extraction = document.extraction as { gaps?: unknown } | null;
      if (!extraction || extraction.gaps === undefined) return [];
      if (!Array.isArray(extraction.gaps))
        throw new Error("Malformed source extraction gaps");
      return extraction.gaps.map((value) => ({
        documentId: document.documentId,
        ...legalSourceExtractionGapSchema.parse(value),
      }));
    })
    .sort(
      (a, b) =>
        a.documentId.localeCompare(b.documentId) ||
        (a.page ?? 0) - (b.page ?? 0) ||
        a.kind.localeCompare(b.kind),
    );
}

interface DraftNode {
  nodeType: LegalDocumentNodeType;
  parent: DraftNode | null;
  ordinal: number;
  label: string;
  title: string;
  path: string;
  content: string;
  pageStart: number | null;
  pageEnd: number | null;
  charStart: number | null;
  charEnd: number | null;
  rank: number;
}
export function structuralHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
const normalized = (text: string) =>
  text.normalize("NFC").replace(/\s+/gu, " ").trim();
const key = (type: string, label: string) =>
  `${type}:${label.toLocaleLowerCase("en-US")}`;

function createDrafts() {
  const nodes: DraftNode[] = [];
  const repeats = new Map<string, number>();
  const childCounts = new Map<DraftNode | null, number>();
  const add = (
    type: LegalDocumentNodeType,
    label: string,
    title: string,
    parent: DraftNode | null,
    rank: number,
  ) => {
    const base = `${parent?.path ?? ""}/${type.toLowerCase()}/${label.toLowerCase()}`;
    const repeat = (repeats.get(base) ?? 0) + 1;
    repeats.set(base, repeat);
    const node: DraftNode = {
      nodeType: type,
      label,
      title,
      parent,
      rank,
      ordinal: childCounts.get(parent) ?? 0,
      path: base + (repeat > 1 ? `/occurrence/${repeat}` : ""),
      content: "",
      pageStart: null,
      pageEnd: null,
      charStart: null,
      charEnd: null,
    };
    childCounts.set(parent, node.ordinal + 1);
    nodes.push(node);
    return node;
  };
  return { nodes, add };
}

function parseText(document: StructuralSourceDocument, pages: string[]) {
  const draft = createDrafts();
  const root = draft.add(
    N.DOCUMENT,
    document.documentId,
    document.title,
    null,
    0,
  );
  const stack = [root];
  let offset = 0;
  const paged =
    (document.extraction as { pageCount?: number | null })?.pageCount != null;
  let vietnameseArticle = false;
  let precedingPhysicalLine: string | null = null;
  let genericHeadingOrdinal = 0;
  for (const [pageIndex, page] of pages.entries()) {
    for (const raw of page.split("\n")) {
      const line = raw.replace(/^\s*#{1,6}\s+/u, "").trim();
      let namedHeading = false;
      let heading: {
        type: LegalDocumentNodeType;
        rank: number;
        label: string;
        title: string;
      } | null = null;
      for (const spec of LEGAL_STRUCTURE_HEADINGS) {
        const match = spec.pattern.exec(line);
        if (match) {
          namedHeading = true;
          heading = {
            type: spec.type,
            rank: spec.rank,
            label: match[1],
            title: match[2] ?? "",
          };
          if (spec.type === N.ARTICLE)
            vietnameseArticle = /^điều\b/iu.test(line);
          break;
        }
      }
      if (
        !heading &&
        stack.some((n) =>
          [N.ARTICLE, N.SECTION, N.ANNEX, N.SCHEDULE].includes(
            n.nodeType as typeof N.ARTICLE,
          ),
        )
      ) {
        const number = /^(?:\((\d+)\)|(\d+)[.)])\s+(\S.*)$/u.exec(line);
        const letter = /^(?:\(([\p{L}])\)|([\p{L}])\))\s+(\S.*)$/u.exec(line);
        if (number)
          heading = {
            type: vietnameseArticle ? N.CLAUSE : N.PARAGRAPH,
            rank: 8,
            label: number[1] ?? number[2],
            title: "",
          };
        else if (letter)
          heading = {
            type: stack.some((n) => n.rank === 8) ? N.POINT : N.SUBSECTION,
            rank: stack.some((n) => n.rank === 8) ? 10 : 7,
            label: letter[1] ?? letter[2],
            title: "",
          };
      }
      // A line-wrapped continuation such as "referred to in\nparagraph 1."
      // must not create a duplicate structural paragraph. Only a lowercase,
      // title-less candidate directly after an unfinished physical line is
      // ambiguous; keep it as body text rather than fabricate a new node.
      if (
        namedHeading &&
        heading &&
        !heading.title &&
        precedingPhysicalLine !== null &&
        /^\p{Ll}/u.test(line) &&
        /[\p{L}\p{N}]$/u.test(precedingPhysicalLine.trim())
      )
        heading = null;
      // Markdown heading marks are generic document syntax, not legal labels.
      // Preserve unrecognized sections as independent, reviewable blocks.
      if (!heading) {
        const markdown = /^\s{0,3}(#{1,6})\s+(\S.*)$/u.exec(raw);
        if (markdown)
          heading = {
            type: N.UNSTRUCTURED_BLOCK,
            rank: 1 + markdown[1].length * 2,
            label: String(++genericHeadingOrdinal),
            title: markdown[2],
          };
      }
      if (heading) {
        while (stack.length > 1 && stack[stack.length - 1].rank >= heading.rank)
          stack.pop();
        const node = draft.add(
          heading.type,
          heading.label,
          heading.title,
          stack[stack.length - 1],
          heading.rank,
        );
        node.charStart = offset;
        stack.push(node);
      }
      const current = stack[stack.length - 1];
      current.content += (current.content ? "\n" : "") + raw;
      for (const node of stack) {
        node.charStart ??= offset;
        node.charEnd = offset + raw.length;
        if (paged) {
          node.pageStart ??= pageIndex + 1;
          node.pageEnd = pageIndex + 1;
        }
      }
      offset += raw.length + 1;
      precedingPhysicalLine = raw;
    }
  }
  return draft.nodes;
}

/** Historical content stays immutable. Only trustworthy structural metadata is read. */
function adaptLegacy(document: StructuralSourceDocument) {
  const draft = createDrafts();
  const root = draft.add(
    N.DOCUMENT,
    document.documentId,
    document.title,
    null,
    0,
  );
  const byPath = new Map<string, DraftNode>();
  const ownerByChunk = new Map<string, DraftNode>();
  const sorted = [...document.chunks].sort((a, b) =>
    a.locator.localeCompare(b.locator, "en", { numeric: true }),
  );
  for (const chunk of sorted) {
    const h = (chunk.hierarchy ?? {}) as Record<string, unknown>;
    let parent = root;
    const chapterNumber = h.chapterNumber;
    if (typeof chapterNumber === "string" && chapterNumber) {
      const p = `chapter/${chapterNumber}`;
      if (!byPath.has(p))
        byPath.set(
          p,
          draft.add(
            N.CHAPTER,
            chapterNumber,
            typeof h.chapterTitle === "string" ? h.chapterTitle : "",
            root,
            3,
          ),
        );
      parent = byPath.get(p)!;
    }
    // part-/dup- retrieval suffixes never become a legal hierarchy level.
    const parts = chunk.locator.replace(/::part-\d+$/u, "").split("::");
    for (const [index, part] of parts.entries()) {
      const match = /^(art|cl|pt|sec|annex|schedule)-(.+)$/u.exec(part);
      if (!match) continue;
      const types = {
        art: N.ARTICLE,
        cl: N.CLAUSE,
        pt: N.POINT,
        sec: N.SECTION,
        annex: N.ANNEX,
        schedule: N.SCHEDULE,
      } as const;
      const type = types[match[1] as keyof typeof types];
      const p = `${parent.path}/${parts.slice(0, index + 1).join("::")}`;
      if (!byPath.has(p))
        byPath.set(
          p,
          draft.add(
            type,
            match[2],
            type === N.ARTICLE
              ? typeof h.articleTitle === "string"
                ? h.articleTitle
                : ""
              : "",
            parent,
            index + 6,
          ),
        );
      parent = byPath.get(p)!;
    }
    if (parent === root || parent.nodeType === N.CHAPTER) {
      const p = `${parent.path}/unstructured`;
      if (!byPath.has(p))
        byPath.set(p, draft.add(N.UNSTRUCTURED_BLOCK, "body", "", parent, 12));
      parent = byPath.get(p)!;
    }
    ownerByChunk.set(chunk.id, parent);
    parent.content += (parent.content ? "\n" : "") + chunk.content;
    if (chunk.pageStart !== null)
      parent.pageStart = Math.min(
        parent.pageStart ?? chunk.pageStart,
        chunk.pageStart,
      );
    if (chunk.pageEnd !== null)
      parent.pageEnd = Math.max(parent.pageEnd ?? chunk.pageEnd, chunk.pageEnd);
  }
  // Points inside a historical clause get source identities while the chunk retains its clause owner.
  for (const parent of [...draft.nodes]) {
    if (
      ![N.CLAUSE, N.ARTICLE, N.PARAGRAPH].includes(
        parent.nodeType as typeof N.CLAUSE,
      )
    )
      continue;
    let current = parent;
    const content = parent.content;
    parent.content = "";
    let char = 0;
    for (const line of content.split("\n")) {
      const match = /^([\p{L}])\)\s+/u.exec(line);
      if (match) {
        current = draft.add(N.POINT, match[1], "", parent, 10);
        current.charStart = char;
      }
      current.content += (current.content ? "\n" : "") + line;
      char += line.length + 1;
      // Legacy offsets are absent: never label chunk-relative offsets as document character spans.
    }
  }
  for (const node of [...draft.nodes].reverse()) {
    node.charStart = null;
    node.charEnd = null;
    if (node.parent && node.pageStart !== null)
      node.parent.pageStart = Math.min(
        node.parent.pageStart ?? node.pageStart,
        node.pageStart,
      );
    if (node.parent && node.pageEnd !== null)
      node.parent.pageEnd = Math.max(
        node.parent.pageEnd ?? node.pageEnd,
        node.pageEnd,
      );
  }
  return { nodes: draft.nodes, ownerByChunk };
}

/** Printed instrument numbers are identity, never evidence of legal effect. */
export function legalDocumentIdentifiers(value: string): string[] {
  return [
    ...value.matchAll(
      /(?<![\p{L}\p{N}])\d+\s*\/\s*(?:\d{4}\s*\/\s*)?[\p{L}][\p{L}\d]*(?:[-–][\p{L}\d]+)*/gu,
    ),
  ].map((m) => m[0].replace(/\s/gu, "").toLocaleUpperCase("vi"));
}

/** A locator is a structural address; an ambiguous address returns all candidates. */
export function legalLocatorSuffix(locator: string): string | null {
  const aliases: Record<string, string> = {
    art: "article",
    article: "article",
    điều: "article",
    cl: "clause",
    clause: "clause",
    khoản: "clause",
    paragraph: "clause",
    pt: "point",
    point: "point",
    điểm: "point",
    chap: "chapter",
    chapter: "chapter",
    chương: "chapter",
    sec: "section",
    section: "section",
    mục: "section",
    annex: "annex",
    "phụ lục": "annex",
    part: "part",
    phần: "part",
    table: "table",
    bảng: "table",
  };
  const parts = locator
    .toLocaleLowerCase("vi")
    .replace(/^\/+|\/+$/gu, "")
    .split("::");
  if (
    parts.length > 1 ||
    /^(art|cl|pt|chap|sec|annex|part|table|article|điều|clause|khoản|point|điểm|chapter|chương|section|mục)[-\s]/u.test(
      parts[0],
    )
  ) {
    const segments = parts.map((p) =>
      /^(art|cl|pt|chap|sec|annex|part|table|article|điều|clause|khoản|point|điểm|chapter|chương|section|mục)[-\s]([\p{L}\d.-]+)$/u.exec(
        p.trim(),
      ),
    );
    if (segments.some((s) => !s)) return null;
    return segments.map((s) => `/${aliases[s![1]] ?? s![1]}/${s![2]}`).join("");
  }
  return /^(?:(?:document|part|title|chapter|subchapter|section|subsection|article|clause|paragraph|point|item|annex|schedule|table|unstructured_block)\/[\p{L}\d._-]+)(?:\/(?:[a-z_]+)\/[\p{L}\d._-]+)*$/u.test(
    parts[0],
  )
    ? "/" + parts[0]
    : null;
}

function references(nodes: LegalDocumentNode[]): LegalDocumentReference[] {
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  const lookup = new Map<string, LegalDocumentNode[]>();
  for (const n of nodes) {
    const k = `${n.documentId}|${key(n.nodeType, n.label)}`;
    lookup.set(k, [...(lookup.get(k) ?? []), n]);
  }
  const result: LegalDocumentReference[] = [];
  const documents = nodes.filter((n) => n.nodeType === N.DOCUMENT);
  const identifiers = new Map(
    documents.map((n) => [n.documentId, legalDocumentIdentifiers(n.title)]),
  );
  const documentScope = (
    node: LegalDocumentNode,
    start: number,
    end: number,
  ) => {
    const suffix = node.content.slice(end).split(/[;\n]/u, 1)[0];
    const prefix = node.content.slice(0, start).split(/[;\n]/u).at(-1) ?? "";
    // A shared trailing instrument applies to a syntactic list of provision locators.
    // `of the <Name>` / `of another <Name>` names some other instrument even when its name does not start with a keyword.
    const named =
      /(?:của\s+|of\s+(?:the\s+)?)(?:luật|bộ luật|nghị định|thông tư|quyết định|law|act|decree|regulation)\s+[^.;\n]+|\bof\s+(?:the|another)\s+[^.;\n]+/iu.exec(
        suffix,
      );
    const direct =
      /^\s+(?:luật|bộ luật|nghị định|thông tư|quyết định|law|act|decree|regulation)\s+[^.;\n]+/iu.exec(
        suffix,
      );
    const expression = named?.[0] ?? direct?.[0];
    if (
      expression &&
      /(?:luật|bộ luật|nghị định|thông tư|quyết định)\s+này(?!\p{L})/iu.test(
        expression,
      )
    )
      return [node.documentId];
    const explicit = legalDocumentIdentifiers(expression ?? "");
    if (!explicit.length && !expression)
      explicit.push(...legalDocumentIdentifiers(prefix));
    if (explicit.length)
      return documents
        .filter((d) =>
          identifiers.get(d.documentId)!.some((id) => explicit.includes(id)),
        )
        .map((d) => d.documentId);
    if (expression) {
      const name = normalized(
        expression.replace(/^(?:của\s+|of\s+(?:(?:the|another)\s+)?)/iu, ""),
      ).toLocaleLowerCase("vi");
      const matches = documents.filter((d) =>
        normalized(d.title).toLocaleLowerCase("vi").endsWith(name),
      );
      return matches.map((d) => d.documentId);
    }
    // Nested lists inherit an explicitly named instrument from their structural lead-in, not the current document.
    let owner: LegalDocumentNode | undefined = node;
    while (owner && owner.nodeType !== N.DOCUMENT) {
      const leadIn = owner.content.split("\n", 1)[0].trim();
      const headingIds = legalDocumentIdentifiers(
        owner.title || (leadIn.endsWith(":") ? leadIn : ""),
      );
      if (headingIds.length)
        return documents
          .filter((d) =>
            identifiers
              .get(d.documentId)!
              .some((id) => headingIds.includes(id)),
          )
          .map((d) => d.documentId);
      owner = owner.parentNodeId ? byId.get(owner.parentNodeId) : undefined;
    }
    return [node.documentId];
  };
  const add = (
    node: LegalDocumentNode,
    index: number,
    text: string,
    candidates: LegalDocumentNode[],
  ) => {
    const ids = [...new Set(candidates.map((n) => n.nodeId))].sort();
    if (
      index === 0 &&
      LEGAL_STRUCTURE_HEADINGS.some(
        (h) =>
          h.type === node.nodeType &&
          h.pattern.exec(node.content.split("\n")[0])?.[1] === node.label,
      )
    )
      return;
    result.push({
      referenceId: structuralHash([node.nodeId, index, text]),
      fromNodeId: node.nodeId,
      toNodeId: ids.length === 1 ? ids[0] : null,
      text,
      charStart: index,
      charEnd: index + text.length,
      resolutionState:
        ids.length === 1 ? R.RESOLVED : ids.length ? R.AMBIGUOUS : R.UNRESOLVED,
      candidateNodeIds: ids,
    });
  };
  // A reference is syntactic. Words such as "subject to" never become semantic edge types.
  const pattern =
    /(?<![\p{L}\p{N}_])(?:(?:(?:point|điểm)\s+\(?([\p{L}])\)?\s+(?:(?:paragraph|khoản)\s+(\d+)\s+)?)?(?:(?:paragraph|khoản)\s+(\d+)\s+)?(?:article|điều|section)\s+(\d+[a-z]?)(?:\((\d+)\))?(?:\(([a-z])\))?|(?:paragraph|khoản)\s+(\d+)|(?:point|điểm)\s+\(?([\p{L}])\)?)(?![\p{L}\p{N}_])/giu;
  for (const node of nodes) {
    for (const match of node.content.matchAll(LEGAL_STRUCTURE_REFERENCE)) {
      const groups = match.slice(1).filter((v) => v !== undefined);
      const type = structuralWordType(groups[0]);
      if (!type) continue;
      const scope = documentScope(
        node,
        match.index,
        match.index + match[0].length,
      );
      add(
        node,
        match.index,
        match[0],
        scope.flatMap(
          (id) => lookup.get(`${id}|${key(type, groups[1])}`) ?? [],
        ),
      );
    }
    for (const m of node.content.matchAll(pattern)) {
      // The heading labels identify nodes; they are not self-references.
      if (
        m.index === 0 &&
        /^(?:article|điều|section|paragraph|khoản|point|điểm)\b/iu.test(m[0]) &&
        m[0].trim().toLowerCase() ===
          `${node.nodeType.toLowerCase()} ${node.label.toLowerCase()}`
      )
        continue;
      let ancestor: LegalDocumentNode | undefined = node;
      while (
        ancestor &&
        ![N.ARTICLE, N.SECTION].includes(ancestor.nodeType as typeof N.ARTICLE)
      )
        ancestor = ancestor.parentNodeId
          ? byId.get(ancestor.parentNodeId)
          : undefined;
      let candidates: LegalDocumentNode[];
      const article = m[4];
      const paragraph = m[2] ?? m[3] ?? m[5] ?? m[7];
      const point = m[1] ?? m[6] ?? m[8];
      const scope = documentScope(node, m.index, m.index + m[0].length);
      if (article)
        candidates = [
          ...scope.flatMap(
            (id) => lookup.get(`${id}|${key(N.ARTICLE, article)}`) ?? [],
          ),
          ...scope.flatMap(
            (id) => lookup.get(`${id}|${key(N.SECTION, article)}`) ?? [],
          ),
        ];
      else candidates = ancestor ? [ancestor] : [];
      if (!article && !paragraph && point) {
        let local: LegalDocumentNode | undefined = node;
        while (
          local &&
          ![N.CLAUSE, N.PARAGRAPH, N.SUBSECTION].includes(
            local.nodeType as typeof N.CLAUSE,
          )
        )
          local = local.parentNodeId ? byId.get(local.parentNodeId) : undefined;
        if (local) candidates = [local];
      }
      if (paragraph) {
        const paths = candidates.map((n) => n.structuralPath + "/");
        candidates = [N.CLAUSE, N.PARAGRAPH]
          .flatMap((type) =>
            scope.flatMap(
              (id) => lookup.get(`${id}|${key(type, paragraph)}`) ?? [],
            ),
          )
          .filter((n) =>
            paths.some((path) => n.structuralPath.startsWith(path)),
          );
      }
      if (point) {
        const paths = candidates.map((n) => n.structuralPath + "/");
        candidates = scope
          .flatMap((id) => lookup.get(`${id}|${key(N.POINT, point)}`) ?? [])
          .filter((n) =>
            paths.some((path) => n.structuralPath.startsWith(path)),
          );
      }
      add(
        node,
        m.index,
        m[0],
        candidates.filter((n) => scope.includes(n.documentId)),
      );
    }
  }
  return result;
}

/** Pure, provider-free materialization. Pages and retrieval windows never participate in node IDs. */
export function buildLegalDocumentGraph(
  legalSourceVersionId: string,
  documents: StructuralSourceDocument[],
): LegalDocumentGraph {
  const nodes: LegalDocumentNode[] = [];
  const chunkMappings: LegalDocumentGraph["chunkMappings"] = [];
  const inputModes = new Set<LegalDocumentGraph["inputModes"][number]>();
  for (const document of [...documents].sort((a, b) =>
    a.documentId.localeCompare(b.documentId, "en"),
  )) {
    const pages = (document.extraction as { pages?: unknown })?.pages;
    const raw =
      Array.isArray(pages) &&
      pages.length > 0 &&
      pages.every((p) => typeof p === "string");
    const legacy = raw ? null : adaptLegacy(document);
    const drafts = raw ? parseText(document, pages) : legacy!.nodes;
    inputModes.add(raw ? MODES.EXTRACTED_TEXT : MODES.LEGACY_CHUNK_ADAPTER);
    const ids = new Map(
      drafts.map((n) => [
        n,
        structuralHash([
          legalSourceVersionId,
          document.documentId,
          n.path,
          structuralHash(normalized(n.content)),
        ]),
      ]),
    );
    for (const n of drafts)
      nodes.push({
        nodeId: ids.get(n)!,
        legalSourceVersionId,
        documentId: document.documentId,
        nodeType: n.nodeType,
        parentNodeId: n.parent ? ids.get(n.parent)! : null,
        ordinal: n.ordinal,
        label: n.label,
        title: n.title,
        structuralPath: n.path,
        sourcePath: document.snapshotPath ?? document.documentId,
        content: n.content,
        contentFingerprint: structuralHash(normalized(n.content)),
        legalEffectStatus: EFFECT.UNKNOWN,
        legalStatusSourceRefs: [],
        pageStart: n.pageStart,
        pageEnd: n.pageEnd,
        charStart: n.charStart,
        charEnd: n.charEnd,
      });
    const byLocator = new Map<string, DraftNode[]>();
    for (const n of drafts) {
      let ancestor: DraftNode | null = n;
      const parts: string[] = [];
      while (ancestor) {
        if (ancestor.nodeType === N.ARTICLE)
          parts.unshift(`art-${ancestor.label.toLowerCase()}`);
        if (ancestor.nodeType === N.POINT)
          parts.unshift(`pt-${ancestor.label.toLowerCase()}`);
        if (
          [N.CLAUSE, N.PARAGRAPH].includes(ancestor.nodeType as typeof N.CLAUSE)
        )
          parts.unshift(`cl-${ancestor.label.toLowerCase()}`);
        ancestor = ancestor.parent;
      }
      const locator = parts.join("::");
      if (locator)
        byLocator.set(locator, [...(byLocator.get(locator) ?? []), n]);
    }
    // In extracted-text mode, chunks are located by their real source range.
    // A retrieval locator such as art-N is not a canonical node type:
    // section-based corpora can legitimately use that locator vocabulary.
    const extractedText = raw ? pages.join("\n") : null;
    let sourceSearchOffset = 0;
    for (const chunk of document.chunks) {
      const foundAt =
        extractedText?.indexOf(chunk.content, sourceSearchOffset) ?? -1;
      const foundEnd = foundAt < 0 ? -1 : foundAt + chunk.content.length;
      if (foundAt >= 0) sourceSearchOffset = foundEnd;
      const positional =
        foundAt < 0
          ? []
          : drafts
              .filter(
                (n) =>
                  n.charStart !== null &&
                  n.charEnd !== null &&
                  n.charStart <= foundAt &&
                  n.charEnd >= foundEnd,
              )
              .sort(
                (a, b) =>
                  a.charEnd! - a.charStart! - (b.charEnd! - b.charStart!) ||
                  b.rank - a.rank,
              );
      const base = chunk.locator.replace(/::part-\d+$/u, "");
      const candidates = byLocator.get(base) ?? [];
      const owner =
        legacy?.ownerByChunk.get(chunk.id) ??
        positional[0] ??
        candidates[0] ??
        drafts[0];
      chunkMappings.push({
        chunkId: chunk.id,
        legalDocumentNodeId: ids.get(owner)!,
      });
    }
    // Propagate only recorded status metadata through structure; mixed/absent status stays UNKNOWN.
    const direct = new Map<string, StructuralSourceChunk[]>();
    const chunkById = new Map(document.chunks.map((c) => [c.id, c]));
    for (const mapping of chunkMappings) {
      const chunk = chunkById.get(mapping.chunkId);
      if (!chunk) continue;
      direct.set(mapping.legalDocumentNodeId, [
        ...(direct.get(mapping.legalDocumentNodeId) ?? []),
        chunk,
      ]);
    }
    const documentNodes = nodes.filter(
      (n) => n.documentId === document.documentId,
    );
    const descendants = new Map(
      documentNodes.map((n) => [n.nodeId, [...(direct.get(n.nodeId) ?? [])]]),
    );
    for (const node of [...documentNodes].reverse())
      if (node.parentNodeId)
        descendants
          .get(node.parentNodeId)!
          .push(...descendants.get(node.nodeId)!);
    const documentEffect = (
      document.provenance as {
        legalEffectMetadata?: {
          status?: LegalSourceChunkStatus;
          sourceRef?: string;
        };
      }
    )?.legalEffectMetadata;
    const fallback =
      documentEffect &&
      Object.values(EFFECT).includes(documentEffect.status!) &&
      documentEffect.sourceRef?.trim()
        ? [
            {
              legalEffectStatus: documentEffect.status,
              legalStatusSourceRef: documentEffect.sourceRef,
            },
          ]
        : [];
    const ancestors = new Map<
      string,
      Pick<
        StructuralSourceChunk,
        "legalEffectStatus" | "legalStatusSourceRef"
      >[]
    >();
    for (const node of documentNodes) {
      const inherited = node.parentNodeId
        ? (ancestors.get(node.parentNodeId) ?? fallback)
        : fallback;
      const metadata =
        direct.get(node.nodeId) ??
        (descendants.get(node.nodeId)!.length
          ? descendants.get(node.nodeId)!
          : inherited);
      ancestors.set(node.nodeId, direct.get(node.nodeId) ?? inherited);
      const statuses = new Set(
        metadata.map((c) => c.legalEffectStatus ?? EFFECT.UNKNOWN),
      );
      node.legalEffectStatus =
        statuses.size === 1 ? [...statuses][0] : EFFECT.UNKNOWN;
      node.legalStatusSourceRefs = [
        ...new Set(
          metadata.flatMap((c) =>
            c.legalStatusSourceRef?.trim() ? [c.legalStatusSourceRef] : [],
          ),
        ),
      ].sort();
      if (metadata.some((c) => !c.legalStatusSourceRef?.trim()))
        node.legalStatusSourceRefs = [];
    }
  }
  const extractionGaps = extractionGapsOf(documents);
  const referenceOnlyDocumentIds = documents
    .filter(
      (d) => d.corpusRole === LEGAL_SOURCE_DOCUMENT_CORPUS_ROLES.REFERENCE_ONLY,
    )
    .map((d) => d.documentId)
    .sort();
  const sourceDigest = structuralHash([
    ...(referenceOnlyDocumentIds.length ? [referenceOnlyDocumentIds] : []),
    extractionGaps,
    documents
      .map(
        (d) =>
          [
            d.documentId,
            d.sourceSha256,
            d.provenance ?? null,
            d.chunks
              .map((c) => [
                c.id,
                c.locator,
                c.contentSha256,
                c.legalEffectStatus ?? EFFECT.UNKNOWN,
                c.legalStatusSourceRef ?? null,
              ])
              .sort((a, b) => String(a[0]).localeCompare(String(b[0]), "en")),
          ] as const,
      )
      .sort((a, b) => a[0].localeCompare(b[0], "en")),
  ]);
  const retrievalUnits = buildLegalRetrievalUnits(nodes);
  const graph = {
    materializationId: structuralHash([
      legalSourceVersionId,
      REVISION.parserRevision,
      REVISION.materializationRevision,
      sourceDigest,
    ]),
    legalSourceVersionId,
    parserRevision: REVISION.parserRevision,
    materializationRevision: REVISION.materializationRevision,
    sourceDigest,
    inputModes: [...inputModes].sort(),
    extractionGaps,
    ...(referenceOnlyDocumentIds.length ? { referenceOnlyDocumentIds } : {}),
    nodes,
    references: references(nodes),
    chunkMappings,
    retrievalUnits,
  };
  return { ...graph, graphDigest: structuralHash(graph) };
}

export function buildLegalRetrievalUnits(
  nodes: LegalDocumentNode[],
  windowCharacters: number = REVISION.retrievalWindowCharacters,
) {
  if (
    !Number.isSafeInteger(windowCharacters) ||
    windowCharacters < 2 ||
    windowCharacters > REVISION.retrievalWindowCharacters
  )
    throw new Error("Invalid retrieval window size");
  const retrievalUnits: LegalDocumentGraph["retrievalUnits"] = [];
  for (const node of nodes) {
    let start = 0,
      ordinal = 0;
    while (start < node.content.length) {
      let end = Math.min(start + windowCharacters, node.content.length);
      if (
        end < node.content.length &&
        /[\uD800-\uDBFF]/u.test(node.content[end - 1]) &&
        /[\uDC00-\uDFFF]/u.test(node.content[end])
      )
        end -= 1;
      const content = node.content.slice(start, end);
      const contentSha256 = createHash("sha256").update(content).digest("hex");
      retrievalUnits.push({
        unitId: structuralHash([node.nodeId, ordinal, contentSha256]),
        legalDocumentNodeId: node.nodeId,
        ordinal,
        contentStart: start,
        contentEnd: start + content.length,
        content,
        contentSha256,
      });
      start = end;
      ordinal += 1;
    }
  }
  return retrievalUnits;
}
