export type OAuthStartSuccess = {
  ok: true;
  correlationId: string;
  authorization_url: string;
};

export type OAuthCallbackSuccess = {
  ok: true;
  correlationId: string;
  session_token: string;
  expires_at: number;
  mfa_required: boolean;
  mfa_enrolled: boolean;
};

export type OAuthLinkStartSuccess = OAuthStartSuccess;

export type OAuthLinkCallbackSuccess = {
  ok: true;
  correlationId: string;
  provider: string;
  linked: boolean;
};
