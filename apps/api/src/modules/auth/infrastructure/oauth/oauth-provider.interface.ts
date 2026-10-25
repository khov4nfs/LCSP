/** Compatibility exports for infrastructure implementations and existing clients. */
export { OAuthCallbackError } from "../../application/ports/oauth/oauth-provider.port.ts";
export type {
  OAuthAuthorizationRequest,
  OAuthCallbackInput,
  OAuthCallbackClaims,
  OAuthProvider,
} from "../../application/ports/oauth/oauth-provider.port.ts";
