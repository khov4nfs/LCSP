import "dotenv/config";

import { PBAC_ACTIONS } from "@lcsp/contracts/pbac";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const policyId = process.env.LCSP_MANAGER_POLICY_ID ?? "policy-lcsp-manager";
const policyVersion = process.env.LCSP_MANAGER_POLICY_VERSION ?? "2026-07-29";
const legalCorpusActions = [
  PBAC_ACTIONS.legalCorpusIngest,
  PBAC_ACTIONS.legalCorpusApprove,
];

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg(connectionString),
  });

  try {
    const policy = await prisma.authPolicy.findUnique({
      where: { id_version: { id: policyId, version: policyVersion } },
      select: { actions: true },
    });
    if (!policy) {
      throw new Error(
        `Manager policy ${policyId}@${policyVersion} was not found`,
      );
    }

    const addedActions = legalCorpusActions.filter(
      (action) => !policy.actions.includes(action),
    );
    const actions = [...policy.actions, ...addedActions];
    await prisma.authPolicy.update({
      where: { id_version: { id: policyId, version: policyVersion } },
      data: { actions },
    });

    console.log(
      JSON.stringify(
        { policyId, policyVersion, addedActions, actions },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main();
