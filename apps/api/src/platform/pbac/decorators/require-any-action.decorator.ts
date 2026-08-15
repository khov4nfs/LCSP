import { SetMetadata } from "@nestjs/common";
import { PBAC_METADATA_TYPES } from "@lcsp/contracts/pbac";

import { PBAC_METADATA_KEY, type PbacMetadata } from "./pbac-metadata.js";

/**
 * Requires an authenticated principal to be allowed to perform at least one of the supplied PBAC actions.
 *
 * @param actions - One or more PBAC actions of which at least one must be allowed.
 * @returns A Nest class/method decorator containing the action-any metadata.
 */
export const RequireAnyAction = (
  ...actions: [string, ...string[]]
): MethodDecorator & ClassDecorator =>
  SetMetadata<string, PbacMetadata>(PBAC_METADATA_KEY, {
    type: PBAC_METADATA_TYPES.actionAny,
    actions,
  });
