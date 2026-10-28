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
/**
 * Business purpose: Carry recorded source-extraction gaps into graph and Agent views without converting them into legal conclusions.
 *
 * Business rules:
 * - Only an explicit `extraction.gaps` array is surfaced; absent gap metadata contributes no gap rows.
 * - Each gap must satisfy the shared extraction-gap contract and remains associated with its source document.
 * - Gap records describe extraction limitations, never legal propositions.
 *
 * Execution flow:
 * 1. Read each document's optional extraction-gap value.
 * 2. Reject a present non-array value and validate each entry with the shared schema.
 * 3. Attach document identity and sort the resulting gaps by document, page, and kind.
 *
 * Failure cases:
 * - A malformed gap container throws an error; schema-invalid entries propagate the schema parser's failure.
 *
 * Side effects:
 * - None: the function returns a derived, sorted view of the supplied extraction metadata.
 */
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
/**
 * Business purpose: Derive deterministic SHA-256 identities for legal-document graph content and structural nodes.
 *
 * Business rules:
 * - The digest covers the JSON serialization exactly as emitted, so callers must build values in the intended property and array order.
 * - Hashes identify supplied structure and content; they do not certify legal meaning or evidentiary sufficiency.
 *
 * Execution flow:
 * 1. Serialize the supplied value with JSON.stringify.
 * 2. Hash that serialization with SHA-256 and return its hexadecimal digest.
 *
 * Failure cases:
 * - Values that cannot be serialized by JSON.stringify propagate a runtime error rather than receiving an unstable identity.
 *
 * Side effects:
 * - None: hashing is performed in memory without changing the source value.
 */
export function structuralHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
/**
 * Business purpose: Normalize node text before calculating a structure-based content fingerprint.
 *
 * Business rules:
 * - Unicode is normalized to NFC, whitespace runs collapse to one space, and surrounding whitespace is removed.
 * - Normalization is for stable structural identity and does not replace the original text stored in a graph node.
 *
 * Execution flow:
 * 1. Convert the string to NFC.
 * 2. Collapse whitespace runs and trim the result.
 *
 * Failure cases:
 * - No domain rejection is added; invalid runtime inputs propagate ordinary string-method errors.
 *
 * Side effects:
 * - None: this helper returns a new normalized string without mutating source text.
 */
const normalized = (text: string) =>
  text.normalize("NFC").replace(/\s+/gu, " ").trim();
/**
 * Business purpose: Create the normalized lookup key used to resolve structural labels inside a legal-source document.
 *
 * Business rules:
 * - Node type remains part of the key, while the label is lowercased using the fixed en-US locale.
 * - This key is a lookup aid and does not establish a cross-document legal reference by itself.
 *
 * Execution flow:
 * 1. Lowercase the label using the fixed locale.
 * 2. Prefix it with the supplied node type and the graph lookup separator.
 *
 * Failure cases:
 * - Empty type or label values are composed as provided; callers own structural input validation.
 *
 * Side effects:
 * - None: a key string is returned without changing either input.
 */
const key = (type: string, label: string) =>
  `${type}:${label.toLocaleLowerCase("en-US")}`;

/**
 * Business purpose: Create an in-memory node builder that assigns stable paths and sibling ordinals during document parsing.
 *
 * Business rules:
 * - Repeated type/label paths receive occurrence suffixes so distinct repeated headings remain addressable.
 * - Each node's ordinal is local to its parent, and newly created nodes begin with empty content and unknown source ranges.
 *
 * Execution flow:
 * 1. Initialize the ordered node list, repeated-path counter, and per-parent child counter.
 * 2. Return the list with an `add` operation that assigns identity, path, and ordinal while appending each new node.
 *
 * Failure cases:
 * - No domain failure is raised for repeated labels; malformed parent or label inputs propagate ordinary runtime errors.
 *
 * Side effects:
 * - Mutates only the builder's in-memory node list and counters; it does not persist graph data.
 */
function createDrafts() {
  const nodes: DraftNode[] = [];
  const repeats = new Map<string, number>();
  const childCounts = new Map<DraftNode | null, number>();
  /**
   * Business purpose: Add one structural node to the current document parse with a deterministic path and sibling position.
   *
   * Business rules:
   * - The structural path combines parent path, lowercase node type, and lowercase label.
   * - Duplicate base paths get an occurrence suffix, while ordinals advance independently for each parent.
   *
   * Execution flow:
   * 1. Derive the base path and increment its occurrence counter.
   * 2. Build the draft node with the parent's next ordinal and empty content/source spans.
   * 3. Advance the parent's sibling counter, append the node, and return it.
   *
   * Failure cases:
   * - Invalid values that cannot produce a path propagate runtime errors; repeated labels are disambiguated rather than rejected.
   *
   * Side effects:
   * - Updates the enclosing builder's counters and node list only.
   */
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

/**
 * Business purpose: Convert extracted page text into a reviewable legal-document hierarchy while retaining source spans and body text.
 *
 * Business rules:
 * - Only configured structural headings and the supported numbered/lettered forms create legal hierarchy nodes.
 * - Unrecognized Markdown headings are kept as UNSTRUCTURED_BLOCK nodes; ordinary prose stays in its current node.
 * - A wrapped lowercase continuation is not promoted to a duplicate heading, and structure detection does not determine legal effect.
 *
 * Execution flow:
 * 1. Create the document root and walk pages and physical lines in source order.
 * 2. Recognize configured headings or contextual clause/paragraph and point labels, preserving generic Markdown headings separately.
 * 3. Update the hierarchy stack, append each raw line to its owner, and track character and available page ranges.
 * 4. Return the ordered draft nodes for deterministic graph identity assignment.
 *
 * Failure cases:
 * - Unrecognized legal structure remains body text or an unstructured block instead of receiving a guessed legal node type.
 * - Malformed document or page inputs propagate ordinary parsing/runtime errors.
 *
 * Side effects:
 * - Mutates only draft nodes held in memory; the extracted source document is not changed or persisted.
 */
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

/**
 * Business purpose: Adapt legacy chunk-based legal-source content into graph nodes without inventing unavailable document offsets.
 *
 * Business rules:
 * - Existing chunk text is retained; hierarchy comes only from recorded chapter metadata and recognized locator segments.
 * - Retrieval suffixes are not treated as legal hierarchy, and character spans remain null because legacy chunk offsets are not document offsets.
 * - Points recognized inside a legacy clause get structural nodes while the chunk remains mapped to its original clause owner.
 *
 * Execution flow:
 * 1. Create a document root and sort chunks by locator for stable processing.
 * 2. Build chapter and supported locator hierarchy from stored metadata, assigning each chunk to its structural owner.
 * 3. Split lettered points into child nodes where recognized and aggregate stored page spans upward.
 * 4. Clear unavailable character spans and return both nodes and chunk-owner mappings.
 *
 * Failure cases:
 * - Missing or unrecognized hierarchy remains under a generic unstructured node rather than being inferred from content semantics.
 * - Malformed hierarchy values may fail through ordinary runtime operations; source chunks are not fabricated to repair them.
 *
 * Side effects:
 * - Mutates only the newly created in-memory draft nodes; historical source chunks and metadata remain unchanged.
 */
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

/**
 * Business purpose: Extract normalized printed legal-instrument identifiers for matching source documents by citation identity.
 *
 * Business rules:
 * - Only the configured number/year/instrument-code shape is recognized.
 * - Whitespace is removed and the identifier is uppercased with the Vietnamese locale; identifiers do not establish legal effect.
 *
 * Execution flow:
 * 1. Find each identifier-shaped substring in the supplied title or text.
 * 2. Normalize every match and return the identifiers in source order.
 *
 * Failure cases:
 * - Text with no matching instrument identifier returns an empty list rather than a guessed identifier.
 *
 * Side effects:
 * - None: matching and normalization operate only on the supplied string.
 */
export function legalDocumentIdentifiers(value: string): string[] {
  return [
    ...value.matchAll(
      /(?<![\p{L}\p{N}])\d+\s*\/\s*(?:\d{4}\s*\/\s*)?[\p{L}][\p{L}\d]*(?:[-–][\p{L}\d]+)*/gu,
    ),
  ].map((m) => m[0].replace(/\s/gu, "").toLocaleUpperCase("vi"));
}

/**
 * Business purpose: Normalize a supported legal locator into a structural-path suffix for exact graph lookup.
 *
 * Business rules:
 * - Recognized English and Vietnamese shorthand terms map to configured node types; canonical structural paths are also accepted.
 * - Unsupported or malformed locator forms stay unresolved as null; this formatter does not choose among matching nodes.
 *
 * Execution flow:
 * 1. Normalize case and trim surrounding slashes, then split shorthand paths on `::`.
 * 2. Translate recognized shorthand segments to canonical node-type path segments.
 * 3. For non-shorthand input, accept only the supported canonical structural-path grammar.
 *
 * Failure cases:
 * - Any unrecognized shorthand segment or invalid canonical path returns null so callers can reject or preserve unresolved state.
 *
 * Side effects:
 * - None: the helper produces a path suffix in memory without querying or altering the graph.
 */
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

/**
 * Business purpose: Build syntactic cross-reference records between legal-document graph nodes for source navigation.
 *
 * Business rules:
 * - References are resolved only from recognized text patterns, document identity, and structural ancestry; no legal relation type or legal meaning is inferred.
 * - One candidate is RESOLVED, multiple candidates are AMBIGUOUS, and no candidates are UNRESOLVED.
 * - Structural headings that identify their own node are excluded from self-reference records.
 *
 * Execution flow:
 * 1. Index nodes by identity and by document-scoped type/label, and collect document instrument identifiers.
 * 2. For each node, determine the relevant instrument scope and inspect configured reference patterns.
 * 3. Resolve candidate nodes within that scope and emit stable, source-offset reference records.
 *
 * Failure cases:
 * - Unrecognized reference wording is omitted; recognized wording with no target is retained as UNRESOLVED.
 * - Malformed node data may propagate ordinary map or string-operation errors rather than yielding fabricated targets.
 *
 * Side effects:
 * - None: the function builds reference records in memory and does not alter graph nodes or source content.
 */
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
  /**
   * Business purpose: Select the document identities that may satisfy a syntactic reference found in one node.
   *
   * Business rules:
   * - Explicitly named or numbered instruments constrain the search to matching document titles.
   * - Recognized Vietnamese instrument self-references ending in "này" stay in the node's document; nested lists may inherit an instrument identity from a structural lead-in.
   * - The current document is the fallback only when no explicit instrument context is found.
   *
   * Execution flow:
   * 1. Inspect trailing and leading text around the reference for a named or numbered instrument.
   * 2. Resolve explicit identifiers or a normalized title suffix against the graph's document nodes.
   * 3. If needed, inspect structural ancestors for an instrument identifier; otherwise use the current document.
   *
   * Failure cases:
   * - Explicit but unmatched instrument references yield an empty scope; the caller records them unresolved.
   * - No source text or ancestor context is synthesized when the supplied node lacks it.
   *
   * Side effects:
   * - None: document scope is derived from the supplied node text and graph nodes.
   */
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
  /**
   * Business purpose: Record one recognized source-text reference with its exact candidate set and resolution state.
   *
   * Business rules:
   * - Candidate node IDs are deduplicated and sorted so the same reference has a stable representation.
   * - A target node is assigned only when exactly one candidate remains; zero or multiple candidates preserve unresolved or ambiguous state.
   * - A structural heading label at the start of its own node is not recorded as a reference.
   *
   * Execution flow:
   * 1. Normalize the candidate node identity set.
   * 2. Skip a recognized heading's own opening label when it is merely the node title.
   * 3. Emit a stable reference ID, source character range, optional unique target, and resolution state.
   *
   * Failure cases:
   * - Empty candidates produce UNRESOLVED; multiple unique candidates produce AMBIGUOUS rather than choosing one.
   *
   * Side effects:
   * - Appends one reference record to the enclosing in-memory result list when the heading-self-reference rule does not skip it.
   */
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

/**
 * Business purpose: Build the version-pinned legal-document structure used for deterministic source retrieval and navigation.
 *
 * Business rules:
 * - Documents are processed in stable identifier order; extracted page text is preferred when it is a nonempty array of strings, otherwise the legacy chunk adapter is used.
 * - Node identity depends on source version, document, structural path, and normalized node content, not retrieval-window boundaries.
 * - Legal effect is copied only from recorded chunk or provenance metadata; absent or mixed status remains UNKNOWN.
 * - Cross-references are syntactic navigation records and do not express substantive legal relationships.
 *
 * Execution flow:
 * 1. Record extraction mode and derive draft nodes from each document's available source representation.
 * 2. Assign stable node IDs, persisted source ranges, and chunk-to-node mappings using source positions or structural locators.
 * 3. Propagate only recorded legal-effect metadata and retain extraction gaps and reference-only document identities.
 * 4. Build syntactic references and bounded retrieval units, then calculate source and graph digests.
 *
 * Failure cases:
 * - Malformed extraction-gap metadata or invalid values required by hashing propagate errors; unavailable extracted pages use the legacy adapter rather than fabricated text.
 * - When extracted source offsets are unavailable, chunk mapping uses a matching structural locator or the first deterministic fallback node; that navigation association is not a legal finding.
 *
 * Side effects:
 * - None: this provider-free builder returns an in-memory graph and does not modify source documents or persistence.
 */
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

/**
 * Business purpose: Split each legal-document graph node into bounded retrieval windows that preserve exact source offsets and content hashes.
 *
 * Business rules:
 * - A requested window must be a safe integer of at least two characters and no larger than the configured maximum.
 * - Window boundaries must not divide a UTF-16 surrogate pair, and each unit remains linked to its source node.
 *
 * Execution flow:
 * 1. Validate the requested window size against the configured retrieval limit.
 * 2. Walk each node's content in bounded windows, adjusting a boundary when it would split a surrogate pair.
 * 3. Emit deterministic unit identities, ordinals, source character ranges, and SHA-256 content hashes.
 *
 * Failure cases:
 * - An unsafe, too-small, or over-limit window size raises `Invalid retrieval window size`.
 * - Empty node content yields no retrieval units; malformed node values propagate runtime errors.
 *
 * Side effects:
 * - None: the function derives retrieval-unit records in memory without modifying the source nodes.
 */
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
