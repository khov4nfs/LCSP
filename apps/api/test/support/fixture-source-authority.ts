import type { LegalSourceAuthorityService } from "../../src/modules/legal-source/application/services/legal-source-authority.service.js";

// Synthetic lifecycle fixtures exercise persistence and concurrency, not official corpus admission.
// The production provider is independently tested against the real pinned corpus and is never replaced outside tests.
export const fixtureSourceAuthority: LegalSourceAuthorityService = {
  requireVersion: async () => {},
};
