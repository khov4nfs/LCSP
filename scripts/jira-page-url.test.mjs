import test from "node:test";
import assert from "node:assert/strict";

import { findAllowedJiraPage, isAllowedJiraPageUrl } from "./jira-page-url.mjs";

test("accepts only the configured Jira HTTPS origin", () => {
  assert.equal(
    isAllowedJiraPageUrl("https://minhpnq1807.atlassian.net/browse/LCSP-1"),
    true,
  );
  assert.equal(
    isAllowedJiraPageUrl(
      "https://minhpnq1807.atlassian.net.evil.test/browse/LCSP-1",
    ),
    false,
  );
  assert.equal(
    isAllowedJiraPageUrl(
      "https://evil.test/?next=https://minhpnq1807.atlassian.net",
    ),
    false,
  );
  assert.equal(
    isAllowedJiraPageUrl(
      "https://user:pass@minhpnq1807.atlassian.net/browse/LCSP-1",
    ),
    false,
  );
  assert.equal(isAllowedJiraPageUrl("not a URL"), false);
});

test("selects only a trusted page target", () => {
  assert.deepEqual(
    findAllowedJiraPage([
      { type: "page", url: "https://evil.test/?atlassian.net" },
      { type: "page", url: "https://minhpnq1807.atlassian.net/jira" },
    ]),
    { type: "page", url: "https://minhpnq1807.atlassian.net/jira" },
  );
});
