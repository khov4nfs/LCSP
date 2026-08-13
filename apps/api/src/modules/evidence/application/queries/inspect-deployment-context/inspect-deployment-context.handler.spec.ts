import { jest } from "@jest/globals";
import { EvidenceAcceptanceStatus } from "@prisma/client";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import {
  DEPLOYMENT_ENVIRONMENTS,
  DEPLOYMENT_MANIFEST_KINDS,
} from "../../contracts/evidence/deployment-context.contract.js";
import { InspectDeploymentContextHandler } from "./inspect-deployment-context.handler.js";
import { InspectDeploymentContextQuery } from "./inspect-deployment-context.query.js";
describe("InspectDeploymentContextHandler", () => {
  it("returns category-only contexts without config values", async () => {
    const prisma = {
      technicalEvidenceReport: {
        findFirst: jest.fn().mockImplementation(() =>
          Promise.resolve({
            id: "report-1",
            status: EvidenceAcceptanceStatus.ACCEPTED,
            evidencePayload: {
              deployment_contexts: [
                {
                  context_ref: "deployment:1",
                  manifest_kind: "KUBERNETES",
                  environment: "PRODUCTION",
                  relative_location: "deploy/api.yaml",
                  categories: ["WORKLOAD"],
                  evidence_refs: ["finding:1"],
                  secret: "dont-leak",
                },
              ],
            },
          }),
        ),
      },
    } as unknown as PrismaService;
    const audit = {
      write: jest.fn<AuditWriterService["write"]>(),
    } as unknown as jest.Mocked<AuditWriterService>;
    const response = await new InspectDeploymentContextHandler(
      prisma,
      audit,
    ).execute(
      new InspectDeploymentContextQuery(
        "assessment-1",
        "org-1",
        "report-1",
        [DEPLOYMENT_MANIFEST_KINDS.kubernetes],
        [DEPLOYMENT_ENVIRONMENTS.production],
        10,
        "corr-1",
      ),
    );
    expect(response.result.contexts).toEqual([
      expect.objectContaining({
        relative_location: "deploy/api.yaml",
        categories: ["WORKLOAD"],
      }),
    ]);
    expect(JSON.stringify(response)).not.toContain("dont-leak");
  });
});
