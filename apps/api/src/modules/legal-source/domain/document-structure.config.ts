import {
  LEGAL_DOCUMENT_NODE_TYPES as N,
  type LegalDocumentNodeType,
} from "@lcsp/contracts/legal-source";

/**
 * Syntactic structure vocabulary only. No legal force, effect or assessability is inferred from it.
 *
 * Conservative heading shape (INV-R3): a line opens a node only when its structural word and label are followed by
 * an explicit delimiter (`.` `:` `-` `—` `–`, or the closing parenthesis of a parenthesised label) or by the end of the
 * line. Prose that merely starts with a structural word ("Article 2 applies to ...", "Paragraph 2 of this Section ...",
 * "Part 1 does not ...") continues the current node. `.` `:` `-` count only when followed by a space or the end of the
 * line, so a dotted label such as "4.1" is never cut at its dot.
 */
const DELIMITER = String.raw`(?:[.:-](?=\s|$)|[—–])`;
const CLOSED = String.raw`(?:\s*${DELIMITER}\s*|\s*(?=$))(.*)$`;
const CLOSED_PARENTHESIS = String.raw`(?:\)\s*(?:${DELIMITER}\s*)?|\s*${DELIMITER}\s*|\s*(?=$))(.*)$`;

interface StructureSpec {
  readonly type: LegalDocumentNodeType;
  /** Nesting rank: a heading closes every open node of an equal or deeper rank. */
  readonly rank: number;
  /** The structural words, in every configured language. Headings and references read the same list. */
  readonly words: readonly string[];
  /** Label grammar of a heading, as a regular-expression source. */
  readonly label: string;
  /** Whether the label may be written in parentheses ("Point (a)"). */
  readonly parenthesised?: boolean;
  /** Whitespace between word and label (`\s+` unless the word may touch its label, as a section sign does). */
  readonly gap?: string;
  /** Text that may not directly follow the label (a line-start reference such as "Article 5(2) ..." is no heading). */
  readonly notFollowedBy?: string;
  /**
   * Label grammar for a reference to a node of this type written in running text. Absent when the type's labels are
   * only unique relative to a parent (paragraphs, points), which the dedicated reference rules resolve instead.
   */
  readonly reference?: string;
}

/** Numeric ("3", "3.1", "2a"), upper-case Roman numeral, or one upper-case letter. Prose such as "part of" never matches. */
const REFERENCE_LABEL = String.raw`\d+(?:\.\d+)*[a-z]?|[IVXLCDM]+|[A-Z]`;
const DOTTED_REFERENCE_LABEL = String.raw`\d+(?:\.\d+)+[a-z]?`;
const WORD_LABEL = String.raw`[\wIVXLCDM-]+`;

const SPECS: readonly StructureSpec[] = [
  { type: N.ANNEX, rank: 1, words: ["annex", "phụ lục"], label: WORD_LABEL, reference: REFERENCE_LABEL },
  { type: N.SCHEDULE, rank: 1, words: ["schedule"], label: WORD_LABEL, reference: REFERENCE_LABEL },
  { type: N.PART, rank: 1, words: ["part", "phần"], label: WORD_LABEL, reference: REFERENCE_LABEL },
  { type: N.TITLE, rank: 2, words: ["title"], label: WORD_LABEL, reference: REFERENCE_LABEL },
  { type: N.CHAPTER, rank: 3, words: ["chapter", "chương"], label: WORD_LABEL, reference: REFERENCE_LABEL },
  { type: N.SUBCHAPTER, rank: 4, words: ["subchapter"], label: WORD_LABEL, reference: REFERENCE_LABEL },
  {
    type: N.SECTION,
    rank: 5,
    words: ["section", "mục", "§"],
    label: String.raw`\d+(?:[.-][\da-z]+)*`,
    gap: String.raw`\s*`,
    // "Section 5" and its "(2)(a)" forms are read by the article/section reference rule; dotted labels are read here.
    reference: DOTTED_REFERENCE_LABEL,
  },
  {
    type: N.ARTICLE,
    rank: 6,
    words: ["article", "điều"],
    label: String.raw`\d+[a-z]?`,
    notFollowedBy: String.raw`(?!\s*\([\da-z]+\))`,
  },
  { type: N.SUBSECTION, rank: 7, words: ["subsection"], label: String.raw`[\w.-]+`, parenthesised: true },
  { type: N.CLAUSE, rank: 8, words: ["clause", "khoản"], label: String.raw`\d+` },
  { type: N.PARAGRAPH, rank: 8, words: ["paragraph"], label: String.raw`\d+`, parenthesised: true },
  { type: N.SUBPARAGRAPH, rank: 9, words: ["subparagraph"], label: String.raw`[\w.-]+`, parenthesised: true },
  { type: N.POINT, rank: 10, words: ["point", "điểm"], label: String.raw`[\p{L}\d]+`, parenthesised: true },
  { type: N.ITEM, rank: 11, words: ["item"], label: String.raw`[\w.-]+`, parenthesised: true },
  {
    type: N.TABLE,
    rank: 7,
    words: ["table", "bảng"],
    label: String.raw`[\w.-]+`,
    reference: REFERENCE_LABEL,
  },
];

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/gu, "\\$&").replace(/\s+/gu, "\\s+");

export interface LegalStructureHeading {
  readonly type: LegalDocumentNodeType;
  readonly rank: number;
  readonly words: readonly string[];
  /** Group 1 is the label, group 2 the title after the delimiter. Never global: callers may reuse it with `test`. */
  readonly pattern: RegExp;
}

export const LEGAL_STRUCTURE_HEADINGS: readonly LegalStructureHeading[] = SPECS.map(
  (spec) => ({
    type: spec.type,
    rank: spec.rank,
    words: spec.words,
    pattern: new RegExp(
      `^(?:${spec.words.map(escape).join("|")})${spec.gap ?? String.raw`\s+`}${
        spec.parenthesised ? String.raw`\(?` : ""
      }(${spec.label})${spec.parenthesised ? "" : String.raw`\b`}${spec.notFollowedBy ?? ""}${
        spec.parenthesised ? CLOSED_PARENTHESIS : CLOSED
      }`,
      "iu",
    ),
  }),
);

/** Case-insensitive spelling of a word, so a reference label next to it can stay case-sensitive. */
function anyCase(word: string): string {
  return [...word]
    .map((character) => {
      const lower = character.toLocaleLowerCase();
      const upper = character.toLocaleUpperCase();
      return lower !== upper && lower.length === 1 && upper.length === 1
        ? `[${lower}${upper}]`
        : escape(character);
    })
    .join("")
    .replace(/\\s\+/gu, String.raw`\s+`);
}

const referable = SPECS.filter((spec) => spec.reference);
const wordsOf = new Map<string, LegalDocumentNodeType>();
for (const spec of referable)
  for (const word of spec.words)
    wordsOf.set(word.toLocaleLowerCase().replace(/\s+/gu, " "), spec.type);

/**
 * A reference in running text to a container the document names by type and label ("set out in Schedule 1",
 * "Part II", "Annex A"). Group 1 is the word as written, group 2 the label. Sections and the article-like forms
 * with "(2)(a)" suffixes keep their dedicated rule in `document-graph.ts`.
 */
const referenceGroups = referable.map((spec) => ({
  words: spec.words.map(anyCase),
  label: spec.reference!,
}));
export const LEGAL_STRUCTURE_REFERENCE = new RegExp(
  referenceGroups
    .flatMap((group) => group.words.map((word) => ({ word, label: group.label })))
    .sort((a, b) => b.word.length - a.word.length)
    .map(
      ({ word, label }) =>
        String.raw`(?<![\p{L}\p{N}])(${word})\s+(${label})(?![\p{L}\p{N}])`,
    )
    .join("|"),
  "gu",
);

/** The node type a structural word names, in any configured language and case. */
export function structuralWordType(word: string): LegalDocumentNodeType | undefined {
  return wordsOf.get(word.toLocaleLowerCase().replace(/\s+/gu, " "));
}
