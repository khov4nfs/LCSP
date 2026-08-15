import { SetMetadata } from "@nestjs/common";
import { PBAC_METADATA_TYPES } from "@lcsp/contracts/pbac";

import { PBAC_METADATA_KEY, type PbacMetadata } from "./pbac-metadata.js";

/**
 * Requires an authenticated session with active membership without evaluating a specific PBAC action.
 *
 * @returns A Nest class/method decorator containing session-only PBAC metadata.
 */
export const RequireSession = (): MethodDecorator & ClassDecorator =>
  SetMetadata<string, PbacMetadata>(PBAC_METADATA_KEY, {
    type: PBAC_METADATA_TYPES.session,
  });
