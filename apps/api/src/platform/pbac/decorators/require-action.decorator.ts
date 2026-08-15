import { SetMetadata } from "@nestjs/common";
import { PBAC_METADATA_TYPES } from "@lcsp/contracts/pbac";

import { PBAC_METADATA_KEY, type PbacMetadata } from "./pbac-metadata.js";

/**
 * Requires an authenticated session, active membership, and an allow decision for one PBAC action.
 *
 * @param action - PBAC action that the current principal must be allowed to perform.
 * @returns A Nest class/method decorator containing the required PBAC action metadata.
 */
export const RequireAction = (
  action: string,
): MethodDecorator & ClassDecorator =>
  SetMetadata<string, PbacMetadata>(PBAC_METADATA_KEY, {
    type: PBAC_METADATA_TYPES.action,
    action,
  });
