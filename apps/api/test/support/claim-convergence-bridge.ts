/** Provider-free contract bridge for the real native tools and API domain validators. No DB/provider/Preparation creation. */
import { readFileSync } from "node:fs";
import {
  complianceRuleSetPacketSchema,
  legalSemanticGraphSchema,
  type LegalSemanticGraph,
} from "@lcsp/contracts/compliance-rule-set";
import {
  fixtureLegalSource,
  validPacket,
} from "./compliance-rule-set-fixtures.js";
import {
  inventoryFingerprint,
  validateClaimInventory,
  validateFrozenInventory,
} from "../../src/modules/compliance-rule-set/domain/claim-inventory.js";
import {
  type LegalSourceSnapshot,
  validateComplianceRuleSetPacket,
} from "../../src/modules/compliance-rule-set/domain/compliance-rule-set-integrity.validator.js";
interface ScriptedInput {
  action: string;
  source?: LegalSourceSnapshot;
  graph: unknown;
  packet: unknown;
  runId: string;
  revision: number;
  identities: Record<string, string>;
  frozen: {
    revision: number;
    fingerprint: string;
    graph: LegalSemanticGraph;
  } | null;
}
// Source snapshots are trusted scripted fixtures; Agent graph/candidate payloads use the real schemas below.
const input = JSON.parse(readFileSync(0, "utf8")) as ScriptedInput;
const source = input.source ?? fixtureLegalSource();
try {
  if (input.action === "INIT")
    console.log(JSON.stringify({ source, packet: validPacket() }));
  else if (input.action === "INVENTORY") {
    const graph = legalSemanticGraphSchema.parse(input.graph);
    const result = validateClaimInventory(
      input.runId,
      input.revision,
      graph,
      input.identities,
      source,
    );
    console.log(
      JSON.stringify({
        ...result,
        outcome: result.failures.length ? "FAILED" : "PASSED",
        fingerprint: inventoryFingerprint(input.revision, graph),
        revision: input.revision,
      }),
    );
  } else {
    const packet = complianceRuleSetPacketSchema.parse(input.packet);
    const result = validateComplianceRuleSetPacket(packet, source, () => false);
    result.failures.push(
      ...validateFrozenInventory(packet, input.frozen, input.revision),
    );
    console.log(
      JSON.stringify({
        outcome: result.failures.length ? "FAILED" : "PASSED",
        failures: result.failures,
        coverage: result.coverage,
        packet,
      }),
    );
  }
} catch (error) {
  const issues = (error as { issues?: { path: (string | number)[] }[] }).issues;
  if (!issues) throw error;
  console.log(
    JSON.stringify({
      outcome: "FAILED",
      failures: issues.map((i) => ({
        code: "CLAIM_SCHEMA_INVALID",
        ref: "packet." + i.path.join("."),
        detail: "Invalid schema field",
      })),
    }),
  );
}
