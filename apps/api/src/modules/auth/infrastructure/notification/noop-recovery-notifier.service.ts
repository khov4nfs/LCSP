import { Injectable } from "@nestjs/common";

import type { RecoveryNotifier } from "../../application/ports/notification/recovery-notifier.ts";

/**
 * Placeholder recovery notifier used when password recovery delivery is
 * intentionally disabled. The plaintext token must only ever be delivered
 * out-of-band and must never be returned from the recovery-request API.
 */
@Injectable()
export class NoopRecoveryNotifierService implements RecoveryNotifier {
  async notify(input: {
    userId: string;
    email: string;
    token: string;
    correlationId: string;
    appOrigin?: string;
  }): Promise<void> {
    void input;
    return Promise.resolve();
  }
}
