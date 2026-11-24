import { CheckSensitiveRouteHandler } from "./check-sensitive-route/check-sensitive-route.handler.ts";
import { GetAuthProfileHandler } from "./get-auth-profile/get-auth-profile.handler.ts";
import { GetOAuthIdentitiesHandler } from "./get-oauth-identities/get-oauth-identities.handler.ts";
import { GetPrivacySettingsHandler } from "./get-privacy-settings/get-privacy-settings.handler.ts";
import { ListAuthSessionsHandler } from "./list-auth-sessions/list-auth-sessions.handler.ts";

export * from "./check-sensitive-route/check-sensitive-route.query.ts";
export * from "./check-sensitive-route/check-sensitive-route.handler.ts";
export * from "./get-auth-profile/get-auth-profile.query.ts";
export * from "./get-auth-profile/get-auth-profile.handler.ts";
export * from "./get-oauth-identities/get-oauth-identities.query.ts";
export * from "./get-oauth-identities/get-oauth-identities.handler.ts";
export * from "./get-privacy-settings/get-privacy-settings.query.ts";
export * from "./get-privacy-settings/get-privacy-settings.handler.ts";
export * from "./list-auth-sessions/list-auth-sessions.query.ts";
export * from "./list-auth-sessions/list-auth-sessions.handler.ts";

export const AUTH_QUERY_HANDLERS = [
  CheckSensitiveRouteHandler,
  GetAuthProfileHandler,
  GetOAuthIdentitiesHandler,
  GetPrivacySettingsHandler,
  ListAuthSessionsHandler,
] as const;
