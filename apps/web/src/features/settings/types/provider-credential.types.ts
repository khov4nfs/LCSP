export type ProviderCredentialDisconnectConfirmProps = {
  errorMessage: string | null;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  reauthPending: boolean;
};

/** Starts a sensitive retry once access is confirmed; onCancel runs if confirmation is dismissed. */
export type ProviderReauthenticateHandler = (
  retry: () => void,
  onCancel?: () => void,
) => void;
