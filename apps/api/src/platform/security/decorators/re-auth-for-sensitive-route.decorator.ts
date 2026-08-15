import { SetMetadata } from "@nestjs/common";
import { registerSensitiveRoute } from "../sensitive-route-policy.js";

export const RE_AUTH_FOR_SENSITIVE_ROUTE_METADATA_KEY =
  "lcsp:security:re-auth-for-sensitive-route";

export type SensitiveRouteAlias = {
  method: string;
  pathTemplate: string;
};

export type ReAuthForSensitiveRouteOptions = {
  routeId: string;
  method: string;
  pathTemplate: string;
  aliases?: readonly SensitiveRouteAlias[];
};

/**
 * Registers a sensitive route and marks its controller or handler as requiring recent sensitive-action re-authentication.
 *
 * @param options - Canonical route ID, HTTP method, path template, and optional route aliases to register.
 * @returns A Nest class/method decorator carrying the sensitive re-authentication metadata.
 */
export const ReAuthForSensitiveRoute = (
  options: ReAuthForSensitiveRouteOptions,
): MethodDecorator & ClassDecorator => {
  registerSensitiveRoute({
    routeId: options.routeId,
    method: options.method,
    pathTemplate: options.pathTemplate,
  });

  for (const alias of options.aliases ?? []) {
    registerSensitiveRoute({
      routeId: options.routeId,
      method: alias.method,
      pathTemplate: alias.pathTemplate,
    });
  }

  return SetMetadata(RE_AUTH_FOR_SENSITIVE_ROUTE_METADATA_KEY, true);
};
