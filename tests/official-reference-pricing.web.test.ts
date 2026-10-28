import { test } from "node:test";
import assert from "node:assert/strict";
import {
  estimateOfficialReferenceCost as estimate,
  OFFICIAL_REFERENCE_PRICES,
  attodollarsToUsd,
} from "@lcsp/contracts/billing";
const now = new Date("2026-10-22T16:00:00Z");
const usage = {
  inputTokens: "1000000",
  inputTokensIncludingCache: "1000000",
  cachedInputTokens: "0",
  cacheWriteTokens: "0",
  outputTokens: "1000000",
  reasoningTokens: "500000",
};
for (const [provider, model, total, canonical] of [
  ["MIRAIAPI", "claude-sonnet-5", "12", "claude-sonnet-5"],
  ["APX", "claude-sonnet-4-6-free", "18", "claude-sonnet-4-6"],
  ["INCEPTION", "mercury-2.5", "0.95", "mercury-2.5"],
  ["GOOGLE_GENAI", "gemini-3.5-flash-lite", "2.8", "gemini-3.5-flash-lite"],
  ["OPENAI", "gpt-4o", "12.5", "gpt-4o"],
] as const)
  test(`official reference mapping ${provider}/${model}`, () => {
    const result = estimate(provider, model, now, usage);
    assert.equal(result.estimatedCostUsd, total);
    assert.equal(result.canonicalModel, canonical);
    assert.ok(result.priceVersionId);
    assert.match(result.evidenceSha256!, /^[a-f0-9]{64}$/);
  });
test("cache read/write TTL buckets and reasoning are counted once", () => {
  const result = estimate("ANTHROPIC", "claude-sonnet-5", now, {
    ...usage,
    inputTokens: "1000000",
    inputTokensIncludingCache: "4000000",
    cachedInputTokens: "1000000",
    cacheWriteTokens: "2000000",
    cacheWrite5mTokens: "1000000",
    cacheWrite1hTokens: "1000000",
  });
  assert.equal(result.estimatedCostUsd, "18.7");
  assert.equal(
    estimate("ANTHROPIC", "claude-sonnet-5", now, {
      ...usage,
      cacheWriteTokens: "10",
    }).status,
    "PARTIAL",
  );
});
test("partial usage retains exact known subtotal, never presents a complete total", () => {
  const result = estimate("INCEPTION", "mercury-2.5", now, {
    outputTokens: "3",
  });
  assert.equal(result.status, "PARTIAL");
  assert.equal(result.knownCostUsd, "0.00000225");
  assert.equal(result.estimatedCostUsd, null);
  assert.equal(estimate("INCEPTION", "mercury-2.5", now, {}).status, "UNKNOWN");
  assert.equal(
    estimate("APX", "unknown-free-model", now, usage).status,
    "UNPRICED",
  );
  assert.equal(
    estimate("OTHER_GATEWAY", "claude-sonnet-5", now, usage).status,
    "UNPRICED",
  );
});
test("version selection does not invent historical prices or mutate existing snapshots", () => {
  const old = estimate("INCEPTION", "mercury-2.5", now, usage);
  assert.equal(
    estimate("INCEPTION", "mercury-2.5", new Date("2026-01-01"), usage).status,
    "UNPRICED",
  );
  const prior = OFFICIAL_REFERENCE_PRICES.find(
    (p) => p.model === "mercury-2.5",
  )!;
  const future = {
    ...prior,
    version: "future-test",
    applicableFrom: "2027-01-01T00:00:00Z",
    rates: { ...prior.rates, output: "99" },
  };
  const registry = [...OFFICIAL_REFERENCE_PRICES, future];
  assert.equal(
    estimate("INCEPTION", "mercury-2.5", now, usage, registry).priceVersionId,
    old.priceVersionId,
  );
  assert.equal(
    estimate(
      "INCEPTION",
      "mercury-2.5",
      new Date("2027-01-02"),
      usage,
      registry,
    ).priceVersionId,
    "future-test",
  );
  assert.equal(old.estimatedCostUsd, "0.95");
});
test("context tiers require measured inclusive input and exact precision survives large counts", () => {
  assert.equal(
    estimate("OPENAI", "gpt-6.1-sol", now, {
      ...usage,
      inputTokensIncludingCache: undefined,
    }).status,
    "UNPRICED",
  );
  assert.equal(
    estimate("OPENAI", "gpt-6.1-sol", now, {
      ...usage,
      inputTokens: "272000",
      inputTokensIncludingCache: "272000",
    }).estimatedCostUsd,
    "10.544",
  );
  assert.equal(
    estimate("OPENAI", "gpt-6.1-sol", now, usage).estimatedCostUsd,
    "19",
  );
  assert.equal(attodollarsToUsd(1n), "0.000000000000000001");
  assert.equal(attodollarsToUsd(0n), "0");
  assert.throws(() =>
    estimate("INCEPTION", "mercury-2.5", now, { inputTokens: "-1" }),
  );
});

test("decimal formatter trims adversarial zero tails in a bounded scan", () => {
  const value = BigInt("1" + "0".repeat(10000) + "1");
  assert.equal(
    attodollarsToUsd(value),
    `${value.toString().slice(0, -18)}.000000000000000001`,
  );
});
