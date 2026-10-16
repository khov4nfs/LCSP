import { LEGAL_DOCUMENT_NODE_TYPES as N } from "@lcsp/contracts/legal-source";

/** Syntactic headings only. No legal force, effect or assessability is inferred. */
export const LEGAL_STRUCTURE_HEADINGS = [
  {
    type: N.ANNEX,
    rank: 1,
    pattern: /^(?:annex|phụ lục)\s+([\wIVXLCDM-]+)\b[.:—–-]?\s*(.*)$/iu,
  },
  {
    type: N.SCHEDULE,
    rank: 1,
    pattern: /^schedule\s+([\wIVXLCDM-]+)\b[.:—–-]?\s*(.*)$/iu,
  },
  {
    type: N.PART,
    rank: 1,
    pattern: /^(?:part|phần)\s+([\wIVXLCDM-]+)\b[.:—–-]?\s*(.*)$/iu,
  },
  {
    type: N.TITLE,
    rank: 2,
    pattern: /^title\s+([\wIVXLCDM-]+)\b[.:—–-]?\s*(.*)$/iu,
  },
  {
    type: N.CHAPTER,
    rank: 3,
    pattern: /^(?:chapter|chương)\s+([\wIVXLCDM-]+)\b[.:—–-]?\s*(.*)$/iu,
  },
  {
    type: N.SUBCHAPTER,
    rank: 4,
    pattern: /^subchapter\s+([\wIVXLCDM-]+)\b[.:—–-]?\s*(.*)$/iu,
  },
  {
    type: N.SECTION,
    rank: 5,
    pattern: /^(?:section|mục|§)\s*(\d+(?:[.-][\da-z]+)*)\s*[.:—–-]?\s*(.*)$/iu,
  },
  {
    type: N.ARTICLE,
    rank: 6,
    pattern:
      /^(?:article|điều)\s+(\d+[a-z]?)\b(?!\s*\([\da-z]+\))\s*[.:—–-]?\s*(.*)$/iu,
  },
  {
    type: N.SUBSECTION,
    rank: 7,
    pattern: /^subsection\s+\(?([\w.-]+)\)?\s*[.:—–-]?\s*(.*)$/iu,
  },
  {
    type: N.CLAUSE,
    rank: 8,
    pattern: /^(?:clause|khoản)\s+(\d+)\b\s*[.:—–-]?\s*(.*)$/iu,
  },
  {
    type: N.PARAGRAPH,
    rank: 8,
    pattern: /^paragraph\s+\(?(\d+)\)?\s*[.:—–-]?\s*(.*)$/iu,
  },
  {
    type: N.SUBPARAGRAPH,
    rank: 9,
    pattern: /^subparagraph\s+\(?([\w.-]+)\)?\s*[.:—–-]?\s*(.*)$/iu,
  },
  {
    type: N.POINT,
    rank: 10,
    pattern: /^(?:point|điểm)\s+\(?([\p{L}\d]+)\)?\s*[.:—–-]?\s*(.*)$/iu,
  },
  {
    type: N.ITEM,
    rank: 11,
    pattern: /^item\s+\(?([\w.-]+)\)?\s*[.:—–-]?\s*(.*)$/iu,
  },
  {
    type: N.TABLE,
    rank: 7,
    pattern: /^(?:table|bảng)\s+([\w.-]+)\b\s*[.:—–-]?\s*(.*)$/iu,
  },
] as const;
