import { describe, expect, it } from "@jest/globals";

import { authoringDraftSaveDecision } from "./authoring-draft-version.js";

describe("Authoring draft version decision", () => {
  it("accepts an exact lost-response replay without advancing the version", () => {
    expect(
      authoringDraftSaveDecision(
        { draftVersion: 3, draft: { claims: ["a"] } },
        2,
        { claims: ["a"] },
      ),
    ).toEqual({ currentVersion: 3, replayed: true, stale: false });
  });

  it("rejects a stale payload even when its loaded version is one behind", () => {
    expect(
      authoringDraftSaveDecision(
        { draftVersion: 3, draft: { claims: ["a"] } },
        2,
        { claims: ["b"] },
      ),
    ).toEqual({ currentVersion: 3, replayed: false, stale: true });
  });

  it("allows a current-version save and the initial version-zero save", () => {
    expect(
      authoringDraftSaveDecision(
        { draftVersion: 3, draft: { claims: ["a"] } },
        3,
        { claims: ["b"] },
      ),
    ).toEqual({ currentVersion: 3, replayed: false, stale: false });
    expect(authoringDraftSaveDecision(null, 0, {})).toEqual({
      currentVersion: 0,
      replayed: false,
      stale: false,
    });
  });
});
