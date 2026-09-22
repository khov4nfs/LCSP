import { SetMetadata } from "@nestjs/common";

export const BYPASS_ENVELOPE_KEY = "bypassEnvelope";

/**
 * Decorator to bypass automatic success result wrapping (e.g. for streams or raw binary downloads).
 */
export const BypassEnvelope = () => SetMetadata(BYPASS_ENVELOPE_KEY, true);
