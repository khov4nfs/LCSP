/**
 * LCSP-424/425: initial normative corpus approved by the product owner.
 * Pins mirror deepagents/evals/corpora/lcsp-402-vn-cong-bao-v1/manifest.json.
 * This is business data, not parser logic or a legal-effect/semantic approval.
 * Extend the corpus by updating the reviewed manifest and these pins together.
 */
export const OFFICIAL_LEGAL_CORPUS = [
  {
    number: "134-2025-QH15",
    sourcePage:
      "https://congbao.chinhphu.vn/van-ban/luat-so-134-2025-qh15-468694/61695.htm",
    downloadUrl:
      "https://congbaocdn.chinhphu.vn/180507251028987904/2026/1/26/l134signed-176941401701024378539.pdf",
    sha256: "181b8687613093eaf42d09af506999a22c7b13453ede8ef574ac48de2e1fdd1b",
  },
  {
    number: "71-2025-QH15",
    sourcePage:
      "https://congbao.chinhphu.vn/van-ban/luat-so-71-2025-qh15-45555.htm",
    downloadUrl:
      "https://congbaocdn.chinhphu.vn/CongBaoCP/VanBan/2025/6/45555/57751-1-2025965-96671-2025-qh15.pdf",
    sha256: "d65911c89cedad9cb0948824d742363776b9a39428969200951af089ea217468",
  },
  {
    number: "142-2026-ND-CP",
    sourcePage:
      "https://congbao.chinhphu.vn/van-ban/nghi-dinh-so-142-2026-nd-cp-469480.htm",
    downloadUrl:
      "https://congbaocdn.chinhphu.vn/180507251028987904/2026/5/18/469480-1778814202_v1_1779067280_signed.pdf",
    sha256: "b2f71e9b86a878e4e91e0f59478b893f98a7db853112de66f3a7c58cbf392e18",
  },
  {
    number: "33-2026-QD-TTg",
    sourcePage:
      "https://congbao.chinhphu.vn/van-ban/quyet-dinh-so-33-2026-qd-ttg-469951.htm",
    downloadUrl:
      "https://congbaocdn.chinhphu.vn/180507251028987904/2026/7/14/469951-1784024086_v1_1784024564_signed.pdf",
    sha256: "62287ada1add99bef29c41fa171743a78e352912449305fa9e554ec3d138d00e",
  },
  {
    number: "05-2026-TT-BKHCN",
    sourcePage:
      "https://congbao.chinhphu.vn/van-ban/thong-tu-so-05-2026-tt-bkhcn-469079/63291.htm",
    downloadUrl:
      "https://congbaocdn.chinhphu.vn/180507251028987904/2026/3/24/469079-1774341042_v1_1774343649_signed.pdf",
    sha256: "b7e83e1924fafc2d94d008f20167ca9b5f8e6238ee7c274aa3bf6bd9c5cb4800",
  },
  {
    number: "1671-QD-TTg",
    sourcePage:
      "https://congbao.chinhphu.vn/van-ban/quyet-dinh-so-1671-qd-ttg-470384.htm",
    downloadUrl:
      "https://congbaocdn.chinhphu.vn/180507251028987904/2026/9/11/470384-1788862278_v1_1789121403_signed.pdf",
    sha256: "8d0000fbb2617f639ba81a3269278e07224f29ba0d4c1be95b1fa0c3033d10dd",
  },
  {
    number: "91-2025-QH15",
    sourcePage:
      "https://congbao.chinhphu.vn/van-ban/luat-so-91-2025-qh15-45578.htm",
    downloadUrl:
      "https://congbaocdn.chinhphu.vn/CongBaoCP/VanBan/2025/6/45578/57730-1-2025971-97291-2025-qh15.pdf",
    sha256: "226dd6da66a6eea348e04db0f8c496d884021b730298991c6f6683720a0dfa2e",
  },
  {
    number: "356-2025-ND-CP",
    sourcePage:
      "https://congbao.chinhphu.vn/van-ban/nghi-dinh-so-356-2025-nd-cp-468371.htm",
    downloadUrl:
      "https://congbaocdn.chinhphu.vn/180507251028987904/2026/1/17/356signed-1768638052103952849513.pdf",
    sha256: "f24747bf3c374b04901e66704423ea1e1a60460376c4d052d649ecc8a2a2f1eb",
  },
  {
    number: "116-2025-QH15",
    sourcePage:
      "https://congbao.chinhphu.vn/van-ban/luat-so-116-2025-qh15-468678/61574.htm",
    downloadUrl:
      "https://congbaocdn.chinhphu.vn/180507251028987904/2026/1/23/116signed-1769163678477753319408.pdf",
    sha256: "8e19e14fd57666baec8f16b7ca2832cbf7f24030a5e6ee0c574e15d0d48ad971",
  },
] as const;

export type OfficialLegalDocument = (typeof OFFICIAL_LEGAL_CORPUS)[number];

/**
 * Business purpose: Resolve an explicitly approved official legal source to its original file.
 * Business rules:
 * - Only an exact publication page or its pinned PDF URL identifies a corpus entry.
 * - A hostname, document number or caller-supplied jurisdiction label is not sufficient.
 * Execution flow:
 * 1. Match the URL against the configured publication and download pins.
 * Failure cases:
 * - An unlisted publication URL or a lookalike host returns undefined, so the caller cannot treat it as a pinned original.
 * Side effects:
 * - Pure lookup; no network, model or human review.
 */
export function resolveOfficialLegalDocument(
  url: string,
): OfficialLegalDocument | undefined {
  return OFFICIAL_LEGAL_CORPUS.find(
    (entry) => entry.sourcePage === url || entry.downloadUrl === url,
  );
}

/**
 * Business purpose: Recognize an original document already pinned in the official corpus.
 * Business rules:
 * - Only an exact SHA-256 digest identifies the approved bytes; filenames and titles do not.
 * Execution flow:
 * 1. Normalize the existing digest prefix and locate the corresponding corpus entry.
 * Failure cases:
 * - An unmatched original document digest returns undefined; an altered PDF cannot inherit the identity of a pinned official document.
 * Side effects:
 * - Pure lookup; no parsing or modification of legal text.
 */
export function identifyOfficialLegalDocument(
  digest: string,
): OfficialLegalDocument | undefined {
  const sha256 = digest.replace(/^sha256:/u, "");
  return OFFICIAL_LEGAL_CORPUS.find((entry) => entry.sha256 === sha256);
}

/**
 * Business purpose: Determine whether the complete corpus binds to product-approved managed originals.
 * Business rules:
 * - Every stored original digest and source digest must identify the same approved document.
 * - The URL of another configured publication cannot be paired with a different original; legacy uploads of the same approved bytes remain eligible.
 * Execution flow:
 * 1. Resolve both stored digests and any known publication URL for each document.
 * 2. Require a nonempty collection and consistent original identities for every document.
 * Failure cases:
 * - Empty collections, missing original digests, substituted bytes or conflicting publication identities return false and block normative admission.
 * Side effects:
 * - Pure calculation from persisted document identity metadata; no retrieval, model or approval step.
 */
export function isOfficialCorpusAdmitted(
  documents: ReadonlyArray<{
    sourceUrl: string;
    sourceSha256: string;
    blobSha256: string | null;
  }>,
): boolean {
  return (
    documents.length > 0 &&
    documents.every((document) => {
      const original = identifyOfficialLegalDocument(document.blobSha256 ?? "");
      const claimedPublication = resolveOfficialLegalDocument(
        document.sourceUrl,
      );
      return Boolean(
        original &&
        identifyOfficialLegalDocument(document.sourceSha256) === original &&
        (claimedPublication === undefined || claimedPublication === original),
      );
    })
  );
}
