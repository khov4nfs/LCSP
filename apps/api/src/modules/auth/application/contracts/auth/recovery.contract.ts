export type RequestRecoveryPayload = {
  email?: string;
};

export type RequestRecoverySuccess = {
  ok: true;
  correlationId: string;
};

export type ConfirmRecoveryPayload = {
  token?: string;
  new_password?: string;
};

export type ConfirmRecoverySuccess = {
  ok: true;
  correlationId: string;
};
