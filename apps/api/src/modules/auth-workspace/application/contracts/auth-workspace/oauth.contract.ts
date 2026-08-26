export type OAuthStartPayload = {
  provider?: unknown;
  redirect_uri?: unknown;
};

export type OAuthStartSuccess = {
  ok: true;
  correlationId: string;
  authorization_url: string;
};

export type OAuthCallbackPayload = {
  code?: unknown;
  state?: unknown;
  provider?: unknown;
};

export type OAuthCallbackSuccess = {
  ok: true;
  correlationId: string;
  session_token: string;
  expires_at: number;
  mfa_required: boolean;
  mfa_enrolled: boolean;
};

export type OAuthLinkStartPayload = OAuthStartPayload;

export type OAuthLinkStartSuccess = OAuthStartSuccess;

export type OAuthLinkCallbackPayload = OAuthCallbackPayload;

export type OAuthLinkCallbackSuccess = {
  ok: true;
  correlationId: string;
  provider: string;
  linked: boolean;
};
