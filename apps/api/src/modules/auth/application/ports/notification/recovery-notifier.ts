export const AUTH_RECOVERY_NOTIFIER = "AUTH_RECOVERY_NOTIFIER";

export interface RecoveryNotifier {
  /** Delivers the plaintext recovery token out-of-band (e.g. email). Never return this token via an API response. */
  notify(input: {
    userId: string;
    email: string;
    token: string;
    correlationId: string;
    appOrigin?: string;
  }): Promise<void>;
}
