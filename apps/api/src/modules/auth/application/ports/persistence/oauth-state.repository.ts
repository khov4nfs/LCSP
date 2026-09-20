import type { OAuthState } from "../../../domain/models/auth.models.ts";

export const AUTH_OAUTH_STATE_REPOSITORY = Symbol(
  "AUTH_OAUTH_STATE_REPOSITORY",
);

export interface OAuthStateRepository {
  nextId(): string;
  save(state: OAuthState): Promise<void>;
  consumeByState(state: string): Promise<OAuthState | null>;
}
