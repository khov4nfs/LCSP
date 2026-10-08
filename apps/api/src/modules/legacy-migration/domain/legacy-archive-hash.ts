import { createHash } from "node:crypto";

export const sha256Hex = (input: string | Uint8Array): string =>
  createHash("sha256").update(input).digest("hex");

/** Byte-order comparison; equals PostgreSQL `COLLATE "C"` so SQL and JS digests always agree. */
const compareCodeUnits = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

/** Per-assessment archive digest: order-independent of insertion, sensitive to every record hash. */
export function archiveDigest(
  records: readonly {
    sourceTable: string;
    sourceId: string;
    payloadSha256: string;
  }[],
): string {
  const lines = [...records]
    .sort(
      (left, right) =>
        compareCodeUnits(left.sourceTable, right.sourceTable) ||
        compareCodeUnits(left.sourceId, right.sourceId),
    )
    .map(
      (record) =>
        `${record.sourceTable}:${record.sourceId}:${record.payloadSha256}`,
    );
  return sha256Hex(lines.join("\n"));
}
