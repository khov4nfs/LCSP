export type PasswordReauthPayload = {
  session_token?: string;
  password?: string;
};

export type PasswordReauthSuccess = {
  ok: true;
  correlationId: string;
  verified: true;
};
