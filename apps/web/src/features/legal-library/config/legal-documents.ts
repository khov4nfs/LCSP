import {
  LEGAL_RISK_LEVELS,
  type LegalRiskLevel,
} from "@lcsp/contracts/legal-rule-catalog";

export const LEGAL_DOCUMENT_IDS = {
  aiLaw: "ai-law",
  digitalTechnologyIndustryLaw: "digital-technology-industry-law",
} as const;

export type LegalDocumentId =
  (typeof LEGAL_DOCUMENT_IDS)[keyof typeof LEGAL_DOCUMENT_IDS];

export const legalDocuments = [
  {
    id: LEGAL_DOCUMENT_IDS.aiLaw,
    messageKey: "aiLaw",
    fileName: "Luat_134_2025_QH15.pdf",
    officialSourceUrl:
      "https://vanban.chinhphu.vn/?docid=216334&pageid=27160&typegroupid=3",
  },
  {
    id: LEGAL_DOCUMENT_IDS.digitalTechnologyIndustryLaw,
    messageKey: "digitalTechnologyIndustryLaw",
    fileName: "Luat-71-2025-qh15_0710195033.pdf",
    officialSourceUrl:
      "https://vanban.chinhphu.vn/?docid=214609&pageid=27160",
  },
] as const;

export type LegalDocument = (typeof legalDocuments)[number];

export type LegalDocumentChunk = {
  id: string;
  documentId: LegalDocumentId;
  pageStart: number;
  pageEnd: number;
  riskLevel: LegalRiskLevel;
};

export const legalDocumentChunks = [
  {
    id: "AI-134-2025-001",
    documentId: LEGAL_DOCUMENT_IDS.aiLaw,
    pageStart: 1,
    pageEnd: 7,
    riskLevel: LEGAL_RISK_LEVELS.high,
  },
  {
    id: "AI-134-2025-002",
    documentId: LEGAL_DOCUMENT_IDS.aiLaw,
    pageStart: 8,
    pageEnd: 14,
    riskLevel: LEGAL_RISK_LEVELS.medium,
  },
  {
    id: "AI-134-2025-003",
    documentId: LEGAL_DOCUMENT_IDS.aiLaw,
    pageStart: 15,
    pageEnd: 20,
    riskLevel: LEGAL_RISK_LEVELS.low,
  },
  {
    id: "DTI-71-2025-001",
    documentId: LEGAL_DOCUMENT_IDS.digitalTechnologyIndustryLaw,
    pageStart: 1,
    pageEnd: 10,
    riskLevel: LEGAL_RISK_LEVELS.high,
  },
  {
    id: "DTI-71-2025-002",
    documentId: LEGAL_DOCUMENT_IDS.digitalTechnologyIndustryLaw,
    pageStart: 11,
    pageEnd: 20,
    riskLevel: LEGAL_RISK_LEVELS.medium,
  },
  {
    id: "DTI-71-2025-003",
    documentId: LEGAL_DOCUMENT_IDS.digitalTechnologyIndustryLaw,
    pageStart: 21,
    pageEnd: 28,
    riskLevel: LEGAL_RISK_LEVELS.low,
  },
] as const satisfies readonly LegalDocumentChunk[];

export function getLegalDocument(lawId: string): LegalDocument | undefined {
  return legalDocuments.find((document) => document.id === lawId);
}
