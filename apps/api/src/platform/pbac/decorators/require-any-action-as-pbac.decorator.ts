import { SetMetadata } from "@nestjs/common";
import { PBAC_METADATA_TYPES } from "@lcsp/contracts/pbac";

import { PBAC_METADATA_KEY, type PbacMetadata } from "./pbac-metadata.js";

/**
 * Requires at least one PBAC action while intentionally mapping missing membership to a non-enumerating PBAC denial.
 *
 * @param actions - One or more PBAC actions of which at least one must be allowed.
 * @returns A Nest class/method decorator containing the action-any metadata and denial behavior.
 */
export const RequireAnyActionAsPbac = (
  ...actions: [string, ...string[]]
): MethodDecorator & ClassDecorator =>
  SetMetadata<string, PbacMetadata>(PBAC_METADATA_KEY, {
    type: PBAC_METADATA_TYPES.actionAny,
    actions,
    membershipMissingAsPbacDenied: true,
  });
