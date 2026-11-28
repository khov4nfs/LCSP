import { describe, expect, it } from "@jest/globals";
import { ModelPricingUnlistedModelError } from "./billing.errors.js";
import {
  assertRuntimeModelAllowlisted,
  isRuntimeModelAllowlisted,
  parseRuntimeModelAllowlistYaml,
} from "./runtime-model-allowlist.js";

const VALID_ROUTES_YAML = `
# Runtime routes fixture
version: 1

routes:
  anthropic-primary:
    provider: anthropic
    model: claude-sonnet-4-6
    options:
      context_window_tokens: 1000000
      max_output_tokens: 65536
      streaming: true
  apx-openai:
    provider: apx
    protocol: openai
    model: gpt-5.2

roles:
  default: anthropic-primary
  reviewer: apx-openai

fallbacks:
  anthropic-primary:
    - apx-openai
`;

describe("runtime-model-allowlist (pure domain parser & matcher)", () => {
  it("parses valid YAML routes, roles, options, and acyclic fallbacks while preserving model case", () => {
    const parsed = parseRuntimeModelAllowlistYaml(VALID_ROUTES_YAML);

    expect(parsed.entries).toEqual([
      {
        routeId: "anthropic-primary",
        provider: "anthropic",
        protocol: "anthropic",
        model: "claude-sonnet-4-6",
      },
      {
        routeId: "apx-openai",
        provider: "apx",
        protocol: "openai",
        model: "gpt-5.2",
      },
    ]);
    expect(parsed.allowlistedModels).toEqual(["claude-sonnet-4-6", "gpt-5.2"]);
    expect(parsed.roles).toEqual({
      default: "anthropic-primary",
      reviewer: "apx-openai",
    });
    expect(parsed.fallbacks).toEqual({
      "anthropic-primary": ["apx-openai"],
    });
  });

  it("matches provider case-insensitively and model case-sensitively, failing closed on unlisted/untrimmed/mismatched pairs", () => {
    const parsed = parseRuntimeModelAllowlistYaml(VALID_ROUTES_YAML);

    expect(
      isRuntimeModelAllowlisted(
        parsed.entries,
        "anthropic",
        "claude-sonnet-4-6",
      ),
    ).toBe(true);
    expect(
      isRuntimeModelAllowlisted(
        parsed.entries,
        "ANTHROPIC",
        "claude-sonnet-4-6",
      ),
    ).toBe(true);
    expect(
      assertRuntimeModelAllowlisted(
        parsed.entries,
        "ANTHROPIC",
        "claude-sonnet-4-6",
      ),
    ).toMatchObject({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
    });

    // Model case mismatch fails closed
    expect(
      isRuntimeModelAllowlisted(
        parsed.entries,
        "anthropic",
        "Claude-Sonnet-4-6",
      ),
    ).toBe(false);
    expect(() =>
      assertRuntimeModelAllowlisted(
        parsed.entries,
        "anthropic",
        "Claude-Sonnet-4-6",
      ),
    ).toThrow(ModelPricingUnlistedModelError);

    // Provider/model mismatch fails closed
    expect(
      isRuntimeModelAllowlisted(parsed.entries, "apx", "claude-sonnet-4-6"),
    ).toBe(false);
    expect(() =>
      assertRuntimeModelAllowlisted(parsed.entries, "apx", "claude-sonnet-4-6"),
    ).toThrow(ModelPricingUnlistedModelError);

    // Untrimmed or blank values fail closed
    expect(
      isRuntimeModelAllowlisted(
        parsed.entries,
        " anthropic",
        "claude-sonnet-4-6",
      ),
    ).toBe(false);
    expect(
      isRuntimeModelAllowlisted(
        parsed.entries,
        "anthropic",
        "claude-sonnet-4-6 ",
      ),
    ).toBe(false);
    expect(
      isRuntimeModelAllowlisted(parsed.entries, "", "claude-sonnet-4-6"),
    ).toBe(false);
    expect(() =>
      assertRuntimeModelAllowlisted(parsed.entries, "anthropic", "  "),
    ).toThrow(ModelPricingUnlistedModelError);
  });

  it("rejects tabs, anchors/aliases, explicit tags, merge keys, and duplicate keys", () => {
    expect(() =>
      parseRuntimeModelAllowlistYaml("version: 1\n\troutes:\n  a: 1\n"),
    ).toThrow(/tab/i);

    expect(() =>
      parseRuntimeModelAllowlistYaml(`
version: 1
routes:
  primary: &base
    provider: anthropic
    model: claude-sonnet-4-6
roles:
  default: primary
`),
    ).toThrow(/anchor|alias/i);

    expect(() =>
      parseRuntimeModelAllowlistYaml(`
version: 1
routes:
  primary:
    provider: anthropic
    model: claude-sonnet-4-6
  secondary: *primary
roles:
  default: primary
`),
    ).toThrow(/anchor|alias/i);

    expect(() =>
      parseRuntimeModelAllowlistYaml(`
version: 1
routes:
  primary: !!str
    provider: anthropic
    model: claude-sonnet-4-6
roles:
  default: primary
`),
    ).toThrow(/tag/i);

    expect(() =>
      parseRuntimeModelAllowlistYaml(`
version: 1
routes:
  primary:
    provider: anthropic
    model: claude-sonnet-4-6
  primary:
    provider: anthropic
    model: claude-sonnet-4-6
roles:
  default: primary
`),
    ).toThrow(/duplicate key/i);
  });

  it("rejects invalid version, missing roles.default, untrimmed model, unknown route refs, and cyclic fallbacks", () => {
    expect(() =>
      parseRuntimeModelAllowlistYaml(`
version: 2
routes:
  primary:
    provider: anthropic
    model: claude-sonnet-4-6
roles:
  default: primary
`),
    ).toThrow(/version/i);

    expect(() =>
      parseRuntimeModelAllowlistYaml(`
version: 1
routes:
  primary:
    provider: anthropic
    model: claude-sonnet-4-6
roles:
  reviewer: primary
`),
    ).toThrow(/roles\.default/i);

    expect(() =>
      parseRuntimeModelAllowlistYaml(`
version: 1
routes:
  primary:
    provider: anthropic
    model: " claude-sonnet-4-6"
roles:
  default: primary
`),
    ).toThrow(/whitespace|model/i);

    expect(() =>
      parseRuntimeModelAllowlistYaml(`
version: 1
routes:
  a:
    provider: anthropic
    model: claude-sonnet-4-6
  b:
    provider: openai
    model: gpt-5.2
roles:
  default: a
fallbacks:
  a:
    - b
  b:
    - a
`),
    ).toThrow(/cycle/i);
  });

  it("handles double-quoted scalars ending in escaped backslashes, YAML document markers (---/...), and empty inline flow mappings ({}) while failing closed on unclosed quotes or non-empty flow mappings", () => {
    const withEscapedBackslash = parseRuntimeModelAllowlistYaml(`
version: 1
routes:
  p:
    provider: anthropic
    model: "claude-sonnet-4-6\\\\"
roles:
  default: p
`);
    expect(withEscapedBackslash.entries).toEqual([
      {
        routeId: "p",
        provider: "anthropic",
        protocol: "anthropic",
        model: "claude-sonnet-4-6\\",
      },
    ]);

    const withDocMarkersAndEmptyFallbacks = parseRuntimeModelAllowlistYaml(`---
version: 1
routes:
  "primary\\\\":
    provider: anthropic
    model: "claude-sonnet-4-6"
    options: {}
roles:
  default: "primary\\\\"
fallbacks: {}
...
`);
    expect(withDocMarkersAndEmptyFallbacks.entries).toEqual([
      {
        routeId: "primary\\",
        provider: "anthropic",
        protocol: "anthropic",
        model: "claude-sonnet-4-6",
      },
    ]);
    expect(withDocMarkersAndEmptyFallbacks.fallbacks).toEqual({});

    // Unclosed quote (odd trailing backslash before closing quote) must still fail closed
    expect(() =>
      parseRuntimeModelAllowlistYaml(`
version: 1
routes:
  p:
    provider: anthropic
    model: "claude-sonnet-4-6\\\\\\"
roles:
  default: p
`),
    ).toThrow(/unclosed quote/i);

    // Non-empty inline flow mappings must still fail closed
    expect(() =>
      parseRuntimeModelAllowlistYaml(`
version: 1
routes:
  p:
    provider: anthropic
    model: claude-sonnet-4-6
roles:
  default: p
fallbacks: { p: [] }
`),
    ).toThrow(/inline flow mappings/i);

    expect(() =>
      parseRuntimeModelAllowlistYaml(`
version: 1
routes:
  p:
    provider: anthropic
    model: claude-sonnet-4-6
    options: { a: 1 }
roles:
  default: p
`),
    ).toThrow(/inline flow mappings/i);
  });
});
