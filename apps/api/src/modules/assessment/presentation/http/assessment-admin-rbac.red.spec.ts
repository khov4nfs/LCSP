import { describe, expect, it } from "@jest/globals";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";

import { RBAC_METADATA_KEY } from "../../../../platform/rbac/decorators/rbac-metadata.js";
import type { RbacMetadata } from "../../../../platform/rbac/decorators/rbac-metadata.js";
import { AssessmentProvenanceController } from "./assessment-provenance.controller.js";
import { WorkspaceRuntimeEventsController } from "./workspace-runtime-events.controller.js";

function rolesOf(target: object): readonly string[] {
  const metadata = Reflect.getMetadata(
    RBAC_METADATA_KEY,
    target,
  ) as RbacMetadata;
  return metadata.type === "roles" ? metadata.roles : [];
}

describe("[RED] assessment ADMIN metadata-only RBAC boundary", () => {
  it("[RED][ASM-ADMIN-03] excludes ADMIN from full provenance content", () => {
    // ADMIN is a metadata-only support role; provenance contains customer case
    // content and therefore remains a customer-owned surface.
    expect(rolesOf(AssessmentProvenanceController)).toEqual([
      AUTH_USER_ROLES.customer,
    ]);
  });

  it("[RED][ASM-ADMIN-04] excludes ADMIN from the content-rich runtime stream", () => {
    // Operational metadata needs a dedicated projection instead of granting
    // ADMIN access to the customer runtime-event transport.
    expect(rolesOf(WorkspaceRuntimeEventsController)).toEqual([
      AUTH_USER_ROLES.customer,
    ]);
  });
});
