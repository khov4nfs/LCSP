import { BILLING_ERROR_CODES } from "@lcsp/contracts/billing";
import {
  ModelPricingDomainError,
  ModelPricingUnlistedModelError,
} from "./billing.errors.js";

/**
 * Canonical runtime model providers recognized by `deepagents/model_policy.py` and `model_routes_config.py`.
 * Why: Prevents typos or unconfigured provider names from entering the runtime pricing allowlist.
 * How: Defined as an `as const` array mirroring `_PROVIDERS` in Python `model_policy.py`.
 * Invariants: Matched strictly in lowercase after ASCII trimming.
 */
export const CANONICAL_MODEL_PROVIDERS = [
  "openai",
  "anthropic",
  "google_genai",
  "inception",
  "apx",
  "miraiapi",
] as const;

/** Canonical model wire protocols enforced by `deepagents/model_routes_config.py`. */
export const CANONICAL_MODEL_PROTOCOLS = {
  anthropic: "anthropic",
  openai: "openai",
  googleGenai: "google_genai",
} as const;

const DEFAULT_PROVIDER_PROTOCOLS: Readonly<Record<string, string>> = {
  openai: CANONICAL_MODEL_PROTOCOLS.openai,
  anthropic: CANONICAL_MODEL_PROTOCOLS.anthropic,
  google_genai: CANONICAL_MODEL_PROTOCOLS.googleGenai,
  inception: CANONICAL_MODEL_PROTOCOLS.openai,
  miraiapi: CANONICAL_MODEL_PROTOCOLS.openai,
};

const DUAL_PROTOCOL_PROVIDERS = new Set<string>(["apx", "miraiapi"]);
const DUAL_PROTOCOLS = new Set<string>([
  CANONICAL_MODEL_PROTOCOLS.anthropic,
  CANONICAL_MODEL_PROTOCOLS.openai,
]);
const ALLOWED_PROTOCOLS = new Set<string>(
  Object.values(CANONICAL_MODEL_PROTOCOLS),
);
const ALLOWED_TOP_LEVEL_KEYS = new Set<string>([
  "version",
  "routes",
  "roles",
  "fallbacks",
]);
const ALLOWED_ROUTE_KEYS = new Set<string>([
  "provider",
  "protocol",
  "model",
  "options",
]);
const ALLOWED_PROVIDERS = new Set<string>(CANONICAL_MODEL_PROVIDERS);

export type RuntimeAllowlistEntry = {
  routeId: string;
  provider: string;
  protocol: string;
  model: string;
};

export type ParsedRuntimeModelRoutes = {
  entries: readonly RuntimeAllowlistEntry[];
  allowlistedModels: readonly string[];
  roles: Readonly<Record<string, string>>;
  fallbacks: Readonly<Record<string, readonly string[]>>;
};

type YamlLine = {
  lineNumber: number;
  indent: number;
  content: string;
};

type YamlValue =
  string | number | boolean | null | YamlValue[] | { [key: string]: YamlValue };

/**
 * Business purpose: Count consecutive backslash escape characters immediately preceding a character index in YAML text.
 *
 * Business rules:
 * - Only an odd count of consecutive preceding backslashes escapes a double-quote delimiter inside double-quoted YAML scalars.
 * - Even counts (such as `\\`) represent escaped backslashes followed by an unescaped closing quote.
 *
 * Execution flow:
 * 1. Walk backward from `pos - 1` while characters equal `"\\"`.
 * 2. Return the total consecutive backslash count.
 *
 * Failure cases:
 * - None: returns `0` when `pos <= 0` or the preceding character is not `"\\"`.
 *
 * Side effects:
 * - None: pure string scan helper.
 */
function countPrecedingBackslashes(text: string, pos: number): number {
  // Why: Checking only `text[pos - 1] === "\\"` misclassifies `"value\\"` (an escaped backslash before closing quote) as an escaped quote.
  // How: Counts consecutive preceding backslashes so callers test `precedingBackslashes % 2 === 1`.
  // Invariants: Never reads negative indices; deterministic scan bounded by contiguous backslashes.
  let precedingBackslashes = 0;
  for (let back = pos - 1; back >= 0 && text[back] === "\\"; back -= 1) {
    precedingBackslashes += 1;
  }
  return precedingBackslashes;
}

/**
 * Business purpose: Strip unquoted YAML comments and tokenize raw routes YAML text into indented logical lines.
 *
 * Business rules:
 * - Tab characters anywhere in the YAML text are forbidden to match `deepagents/model_routes_config.py`.
 * - Comments starting with `#` outside single/double quotes are stripped; blank lines are discarded.
 * - Double-quote escaping tracks consecutive preceding backslashes so trailing escaped backslashes (`"foo\\"`) close properly.
 *
 * Execution flow:
 * 1. Reject the input immediately if any `\t` character is present.
 * 2. Scan each line character-by-character tracking single/double quote state (using `countPrecedingBackslashes` parity) and strip `#` comments.
 * 3. Compute leading space indentation and collect non-empty lines with 1-based line numbers.
 *
 * Failure cases:
 * - Throws `ModelPricingDomainError` (`BILLING_VALIDATION_FAILED`) when tabs or unclosed quotes are encountered.
 *
 * Side effects:
 * - None: pure in-memory tokenization.
 */
function tokenizeYamlLines(yamlText: string): YamlLine[] {
  // Why: PyYAML and JS parsers disagree on tab indentation; Python `model_routes_config.py` forbids tabs outright.
  // How: Fail closed on `\t`, then scan quotes with backslash-parity tracking before stripping `#` comments so `#` inside quoted strings stays intact.
  // Invariants: Returned lines contain only space-indented non-blank YAML statements.
  if (typeof yamlText !== "string") {
    throw new ModelPricingDomainError(
      BILLING_ERROR_CODES.validationFailed,
      "Model routes YAML must be a string",
    );
  }
  if (yamlText.includes("\t")) {
    throw new ModelPricingDomainError(
      BILLING_ERROR_CODES.validationFailed,
      "Invalid YAML: tab characters are not allowed (indent with spaces)",
    );
  }

  const rawLines = yamlText.split(/\r?\n/);
  const lines: YamlLine[] = [];

  for (let index = 0; index < rawLines.length; index += 1) {
    const rawLine = rawLines[index];
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let commentStart = -1;

    for (let pos = 0; pos < rawLine.length; pos += 1) {
      const ch = rawLine[pos];
      if (ch === "'" && !inDoubleQuote) {
        if (inSingleQuote && rawLine[pos + 1] === "'") {
          pos += 1;
          continue;
        }
        inSingleQuote = !inSingleQuote;
      } else if (ch === '"' && !inSingleQuote) {
        if (
          inDoubleQuote &&
          countPrecedingBackslashes(rawLine, pos) % 2 === 1
        ) {
          continue;
        }
        inDoubleQuote = !inDoubleQuote;
      } else if (
        ch === "#" &&
        !inSingleQuote &&
        !inDoubleQuote &&
        (pos === 0 || rawLine[pos - 1] === " ")
      ) {
        commentStart = pos;
        break;
      }
    }

    if (inSingleQuote || inDoubleQuote) {
      throw new ModelPricingDomainError(
        BILLING_ERROR_CODES.validationFailed,
        `Invalid YAML: unclosed quote on line ${index + 1}`,
      );
    }

    const withoutComment =
      commentStart >= 0 ? rawLine.slice(0, commentStart) : rawLine;
    const trimmedRight = withoutComment.replace(/ +$/, "");
    if (trimmedRight.trim().length === 0) {
      continue;
    }

    const leadingSpaces = trimmedRight.match(/^ */)?.[0].length ?? 0;
    const content = trimmedRight.slice(leadingSpaces);
    lines.push({
      lineNumber: index + 1,
      indent: leadingSpaces,
      content,
    });
  }

  return lines;
}

/**
 * Business purpose: Parse a single scalar, empty flow mapping, or inline sequence token while rejecting YAML anchors, aliases, tags, and non-empty flow mappings.
 *
 * Business rules:
 * - Explicit YAML tags (`!...`), anchors (`&...`), aliases (`*...`), block scalars (`|`, `>`), and non-empty flow mappings (`{ a: 1 }`) are forbidden.
 * - Empty inline flow mappings (`{}`) are accepted as `{}` for parity with `deepagents/model_routes_config.py` (`fallbacks: {}`, `options: {}`).
 * - Single-quoted and double-quoted strings preserve exact whitespace and inner characters.
 * - Unquoted scalars support YAML 1.2 core types: `null`/`~`, `true`/`false`, base-10/oct/hex integers, and finite floats.
 *
 * Execution flow:
 * 1. Reject forbidden YAML directives, anchors/aliases, tags, block scalar indicators, and non-empty flow objects; decode `{}` to `{}`.
 * 2. Decode single/double-quoted strings or inline `[a, b]` arrays recursively.
 * 3. Resolve unquoted YAML 1.2 scalar literals (`null`, `boolean`, `number`, or plain string).
 *
 * Failure cases:
 * - Throws `ModelPricingDomainError` (`BILLING_VALIDATION_FAILED`) on unsupported or forbidden YAML syntax.
 *
 * Side effects:
 * - None: pure scalar decoder.
 */
function parseYamlScalar(rawToken: string, lineNumber: number): YamlValue {
  // Why: Mirrors Python `_UniqueKeyLoader` YAML 1.2 core-schema restrictions to prevent alias expansion or type confusion,
  // while permitting empty `{}` mappings (`fallbacks: {}`, `options: {}`) valid in `model_routes_config.py`.
  // How: Checks leading/unquoted forbidden tokens and `{}` empty flow mapping before decoding quoted strings, inline arrays, or core scalars.
  // Invariants: Never returns `undefined` or executes code; non-empty `{...}` always fails closed; quoted strings preserve exact inner whitespace.
  const token = rawToken.trim();
  if (token.length === 0) {
    return null;
  }

  if (token.startsWith("&") || token.startsWith("*")) {
    throw new ModelPricingDomainError(
      BILLING_ERROR_CODES.validationFailed,
      `Invalid YAML on line ${lineNumber}: anchors and aliases are not allowed`,
    );
  }
  if (token.startsWith("!")) {
    throw new ModelPricingDomainError(
      BILLING_ERROR_CODES.validationFailed,
      `Invalid YAML on line ${lineNumber}: explicit tags are not allowed`,
    );
  }
  if (token === "|" || token === ">" || token === "|-" || token === ">-") {
    throw new ModelPricingDomainError(
      BILLING_ERROR_CODES.validationFailed,
      `Invalid YAML on line ${lineNumber}: block scalars are not allowed`,
    );
  }
  if (token.startsWith("{")) {
    if (/^\{ *\}$/.test(token)) {
      return {};
    }
    throw new ModelPricingDomainError(
      BILLING_ERROR_CODES.validationFailed,
      `Invalid YAML on line ${lineNumber}: inline flow mappings are not allowed`,
    );
  }

  if (token.startsWith("'") && token.endsWith("'") && token.length >= 2) {
    return token.slice(1, -1).replaceAll("''", "'");
  }

  if (token.startsWith('"') && token.endsWith('"') && token.length >= 2) {
    try {
      return JSON.parse(token) as string;
    } catch {
      throw new ModelPricingDomainError(
        BILLING_ERROR_CODES.validationFailed,
        `Invalid YAML on line ${lineNumber}: malformed double-quoted string`,
      );
    }
  }

  if (token.startsWith("[") && token.endsWith("]")) {
    const inner = token.slice(1, -1).trim();
    if (inner.length === 0) {
      return [];
    }
    return inner.split(",").map((part) => parseYamlScalar(part, lineNumber));
  }

  if (
    token === "~" ||
    token === "null" ||
    token === "Null" ||
    token === "NULL"
  ) {
    return null;
  }
  if (token === "true" || token === "True" || token === "TRUE") {
    return true;
  }
  if (token === "false" || token === "False" || token === "FALSE") {
    return false;
  }
  if (/^[-+]?[0-9]+$/.test(token)) {
    return Number.parseInt(token, 10);
  }
  if (/^0o[0-7]+$/.test(token)) {
    return Number.parseInt(token.slice(2), 8);
  }
  if (/^0x[0-9a-fA-F]+$/.test(token)) {
    return Number.parseInt(token.slice(2), 16);
  }
  if (
    /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?$/.test(token)
  ) {
    return Number.parseFloat(token);
  }

  return token;
}

/**
 * Business purpose: Split a YAML mapping line into its unquoted key and optional inline value while enforcing anchor/tag/key rules.
 *
 * Business rules:
 * - Mapping keys must be followed by `:` (at end of line or followed by a space).
 * - YAML merge keys (`<<`), anchors, aliases, and explicit tags on keys or values are rejected.
 * - Quoted mapping keys track consecutive preceding backslashes so trailing escaped backslashes (`"key\\":`) split accurately.
 *
 * Execution flow:
 * 1. Locate the first `:` outside single/double quotes using `countPrecedingBackslashes` parity for double quotes.
 * 2. Decode the key string and validate it is a non-empty safe string (not `<<`, `__proto__`, `constructor`, `prototype`).
 * 3. Return the decoded key and raw remaining value text.
 *
 * Failure cases:
 * - Throws `ModelPricingDomainError` (`BILLING_VALIDATION_FAILED`) if `:` is missing, key is invalid, or tags/anchors appear.
 *
 * Side effects:
 * - None: pure parser helper.
 */
function splitMappingLine(line: YamlLine): { key: string; rawValue: string } {
  // Why: Naive `indexOf(":")` breaks on quoted colons or unquoted values containing `:` (e.g. URLs),
  // and naive `text[pos - 1] !== "\\"` misclassifies `"key\\":` as an unclosed quoted key.
  // How: Tracks quote boundaries with backslash-parity checks and splits only at the first colon followed by EOL or ASCII space.
  // Invariants: Rejects merge keys (`<<`) and prototype-polluting keys (`__proto__`).
  const text = line.content;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let splitIndex = -1;

  for (let pos = 0; pos < text.length; pos += 1) {
    const ch = text[pos];
    if (ch === "'" && !inDoubleQuote) {
      if (inSingleQuote && text[pos + 1] === "'") {
        pos += 1;
        continue;
      }
      inSingleQuote = !inSingleQuote;
    } else if (ch === '"' && !inSingleQuote) {
      if (inDoubleQuote && countPrecedingBackslashes(text, pos) % 2 === 1) {
        continue;
      }
      inDoubleQuote = !inDoubleQuote;
    } else if (
      ch === ":" &&
      !inSingleQuote &&
      !inDoubleQuote &&
      (pos === text.length - 1 || text[pos + 1] === " ")
    ) {
      splitIndex = pos;
      break;
    }
  }

  if (splitIndex <= 0) {
    throw new ModelPricingDomainError(
      BILLING_ERROR_CODES.validationFailed,
      `Invalid YAML mapping entry on line ${line.lineNumber}`,
    );
  }

  const rawKey = text.slice(0, splitIndex).trim();
  const decodedKey = parseYamlScalar(rawKey, line.lineNumber);
  if (typeof decodedKey !== "string" || decodedKey.length === 0) {
    throw new ModelPricingDomainError(
      BILLING_ERROR_CODES.validationFailed,
      `Invalid YAML mapping key on line ${line.lineNumber}`,
    );
  }
  if (
    decodedKey === "<<" ||
    decodedKey === "__proto__" ||
    decodedKey === "constructor" ||
    decodedKey === "prototype"
  ) {
    throw new ModelPricingDomainError(
      BILLING_ERROR_CODES.validationFailed,
      `Invalid YAML: forbidden mapping key '${decodedKey}' on line ${line.lineNumber}`,
    );
  }

  const rawValue = text.slice(splitIndex + 1).trim();
  return { key: decodedKey, rawValue };
}

/**
 * Business purpose: Recursively parse an indentation-delimited YAML block (mapping or sequence) from tokenized lines.
 *
 * Business rules:
 * - Duplicate keys at the same mapping level are rejected fail-closed.
 * - Mixed indentation or dedent mismatches fail closed.
 * - Anchors (`&`), aliases (`*`), and explicit tags (`!`) anywhere in block headers are rejected.
 *
 * Execution flow:
 * 1. Inspect the first line at `startIndex` to determine whether the block is a sequence (`- `) or mapping (`key:`).
 * 2. Consume sibling entries sharing the exact block indentation and recurse for nested child blocks.
 * 3. Return the constructed value alongside the next unconsumed line index.
 *
 * Failure cases:
 * - Throws `ModelPricingDomainError` (`BILLING_VALIDATION_FAILED`) on duplicate keys, inconsistent indentation, or syntax errors.
 *
 * Side effects:
 * - None: pure recursive descent parser.
 */
function parseYamlBlock(
  lines: readonly YamlLine[],
  startIndex: number,
  expectedIndent: number,
): { value: YamlValue; nextIndex: number } {
  // Why: Structured `model_routes.yaml` requires nested mappings (routes -> routeId -> options) and block sequences (fallbacks).
  // How: Dispatches on `- ` vs `key:` at `expectedIndent` and recurses strictly when child indent > `expectedIndent`.
  // Invariants: Every mapping rejects `Object.hasOwn(mapping, key)` duplicates; no shared mutable state.
  const firstLine = lines[startIndex];
  if (!firstLine || firstLine.indent !== expectedIndent) {
    throw new ModelPricingDomainError(
      BILLING_ERROR_CODES.validationFailed,
      `Invalid YAML indentation on line ${firstLine?.lineNumber ?? startIndex + 1}`,
    );
  }

  if (firstLine.content === "-" || firstLine.content.startsWith("- ")) {
    const items: YamlValue[] = [];
    let cursor = startIndex;

    while (cursor < lines.length) {
      const line = lines[cursor];
      if (line.indent < expectedIndent) {
        break;
      }
      if (line.indent > expectedIndent) {
        throw new ModelPricingDomainError(
          BILLING_ERROR_CODES.validationFailed,
          `Invalid YAML sequence indentation on line ${line.lineNumber}`,
        );
      }
      if (!(line.content === "-" || line.content.startsWith("- "))) {
        throw new ModelPricingDomainError(
          BILLING_ERROR_CODES.validationFailed,
          `Invalid YAML: unexpected mapping entry inside sequence on line ${line.lineNumber}`,
        );
      }

      const itemText = line.content.slice(1).trim();
      if (itemText.length === 0) {
        const nextLine = lines[cursor + 1];
        if (!nextLine || nextLine.indent <= expectedIndent) {
          items.push(null);
          cursor += 1;
        } else {
          const nested = parseYamlBlock(lines, cursor + 1, nextLine.indent);
          items.push(nested.value);
          cursor = nested.nextIndex;
        }
      } else {
        items.push(parseYamlScalar(itemText, line.lineNumber));
        cursor += 1;
      }
    }

    return { value: items, nextIndex: cursor };
  }

  const mapping: { [key: string]: YamlValue } = {};
  let cursor = startIndex;

  while (cursor < lines.length) {
    const line = lines[cursor];
    if (line.indent < expectedIndent) {
      break;
    }
    if (line.indent > expectedIndent) {
      throw new ModelPricingDomainError(
        BILLING_ERROR_CODES.validationFailed,
        `Invalid YAML mapping indentation on line ${line.lineNumber}`,
      );
    }
    if (line.content === "-" || line.content.startsWith("- ")) {
      throw new ModelPricingDomainError(
        BILLING_ERROR_CODES.validationFailed,
        `Invalid YAML: unexpected sequence entry inside mapping on line ${line.lineNumber}`,
      );
    }

    const { key, rawValue } = splitMappingLine(line);
    if (Object.hasOwn(mapping, key)) {
      throw new ModelPricingDomainError(
        BILLING_ERROR_CODES.validationFailed,
        `Invalid YAML: duplicate key '${key}' on line ${line.lineNumber}`,
      );
    }

    if (rawValue.length > 0) {
      if (rawValue.startsWith("&") || rawValue.startsWith("!")) {
        const nextLine = lines[cursor + 1];
        if (nextLine && nextLine.indent > expectedIndent) {
          throw new ModelPricingDomainError(
            BILLING_ERROR_CODES.validationFailed,
            `Invalid YAML on line ${line.lineNumber}: anchors, aliases, and explicit tags are not allowed`,
          );
        }
      }
      mapping[key] = parseYamlScalar(rawValue, line.lineNumber);
      cursor += 1;
    } else {
      const nextLine = lines[cursor + 1];
      if (!nextLine || nextLine.indent <= expectedIndent) {
        mapping[key] = null;
        cursor += 1;
      } else {
        const nested = parseYamlBlock(lines, cursor + 1, nextLine.indent);
        mapping[key] = nested.value;
        cursor = nested.nextIndex;
      }
    }
  }

  return { value: mapping, nextIndex: cursor };
}

/**
 * Business purpose: Determine whether a parsed YAML value is a non-array plain mapping object.
 *
 * Business rules:
 * - Rejects null, primitives, and arrays.
 *
 * Execution flow:
 * 1. Verify runtime typeof is `"object"`, value is non-null, and `!Array.isArray(value)`.
 *
 * Failure cases:
 * - None: returns boolean type-guard result.
 *
 * Side effects:
 * - None: pure type guard.
 */
function isYamlMapping(value: unknown): value is { [key: string]: YamlValue } {
  // Why: Distinguishes YAML mapping objects from null, arrays, and scalars without false positives.
  // How: Combines typeof check, non-null check, and Array.isArray exclusion.
  // Invariants: Safe for strict TypeScript narrowing.
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Business purpose: Derive and validate the effective protocol for a model route entry matching Python `model_routes_config.py`.
 *
 * Business rules:
 * - Standard providers (`openai`, `anthropic`, `google_genai`, `inception`) bind their canonical protocol.
 * - Dual-protocol providers (`apx`, `miraiapi`) allow `anthropic` or `openai`, defaulting `apx` by model prefix heuristic.
 *
 * Execution flow:
 * 1. Resolve explicit protocol if provided, otherwise derive the default protocol from `provider` and `model`.
 * 2. Verify protocol belongs to `CANONICAL_MODEL_PROTOCOLS` and satisfies provider compatibility rules.
 *
 * Failure cases:
 * - Throws `ModelPricingDomainError` (`BILLING_VALIDATION_FAILED`) on missing or incompatible protocol.
 *
 * Side effects:
 * - None: pure validation helper.
 */
function resolveAndValidateRouteProtocol(
  routeId: string,
  provider: string,
  model: string,
  explicitProtocol: unknown,
): string {
  // Why: Ensures route protocol validation mirrors `deepagents/model_routes_config.py` lines 117-128 & 185-191.
  // How: Applies default protocol lookup or APX heuristic when omitted, then enforces dual/single provider constraints.
  // Invariants: Always returns one of `CANONICAL_MODEL_PROTOCOLS`.
  let protocol: unknown = explicitProtocol;
  if (protocol === undefined) {
    if (Object.hasOwn(DEFAULT_PROVIDER_PROTOCOLS, provider)) {
      protocol = DEFAULT_PROVIDER_PROTOCOLS[provider];
    } else if (provider === "apx") {
      const lowerModel = model.toLowerCase();
      if (lowerModel.startsWith("claude-")) {
        protocol = CANONICAL_MODEL_PROTOCOLS.anthropic;
      } else if (
        lowerModel.startsWith("gpt-") ||
        lowerModel.startsWith("o1-") ||
        lowerModel.startsWith("o3-") ||
        lowerModel.startsWith("o4-")
      ) {
        protocol = CANONICAL_MODEL_PROTOCOLS.openai;
      } else {
        protocol = CANONICAL_MODEL_PROTOCOLS.anthropic;
      }
    } else {
      throw new ModelPricingDomainError(
        BILLING_ERROR_CODES.validationFailed,
        `routes.${routeId}: provider '${provider}' requires an explicit protocol`,
      );
    }
  }

  if (typeof protocol !== "string" || !ALLOWED_PROTOCOLS.has(protocol)) {
    throw new ModelPricingDomainError(
      BILLING_ERROR_CODES.validationFailed,
      `routes.${routeId}.protocol must be one of anthropic, openai, google_genai`,
    );
  }
  if (DUAL_PROTOCOL_PROVIDERS.has(provider) && !DUAL_PROTOCOLS.has(protocol)) {
    throw new ModelPricingDomainError(
      BILLING_ERROR_CODES.validationFailed,
      `routes.${routeId}.protocol must be anthropic or openai for provider '${provider}'`,
    );
  }
  if (
    Object.hasOwn(DEFAULT_PROVIDER_PROTOCOLS, provider) &&
    !DUAL_PROTOCOL_PROVIDERS.has(provider) &&
    protocol !== DEFAULT_PROVIDER_PROTOCOLS[provider]
  ) {
    throw new ModelPricingDomainError(
      BILLING_ERROR_CODES.validationFailed,
      `routes.${routeId}.protocol must be '${DEFAULT_PROVIDER_PROTOCOLS[provider]}' for provider '${provider}'`,
    );
  }

  return protocol;
}

/**
 * Business purpose: Walk configured route fallback chains depth-first to detect and reject cyclic fallback references.
 *
 * Business rules:
 * - Every fallback chain must terminate in a directed acyclic graph across known route identifiers.
 *
 * Execution flow:
 * 1. Check whether `node` already exists in the active traversal `stack`.
 * 2. Recursively visit each fallback target configured for `node` with `node` appended to `stack`.
 *
 * Failure cases:
 * - Throws `ModelPricingDomainError` (`BILLING_VALIDATION_FAILED`) describing the cycle path when a cycle is found.
 *
 * Side effects:
 * - None: pure recursive cycle detector.
 */
function assertFallbackNodeAcyclic(
  node: string,
  stack: readonly string[],
  fallbacks: Readonly<Record<string, readonly string[]>>,
): void {
  // Why: Cyclic route fallback chains would cause infinite retry loops at runtime.
  // How: Tracks active DFS ancestor stack and fails closed on any back-edge.
  // Invariants: Terminates deterministically for any finite fallback graph.
  if (stack.includes(node)) {
    throw new ModelPricingDomainError(
      BILLING_ERROR_CODES.validationFailed,
      `Fallback cycle detected: ${[...stack, node].join(" -> ")}`,
    );
  }
  const nextChain = fallbacks[node] ?? [];
  for (const nextNode of nextChain) {
    assertFallbackNodeAcyclic(nextNode, [...stack, node], fallbacks);
  }
}

/**
 * Business purpose: Parse and validate `deepagents/config/model_routes.yaml` into the authoritative runtime model pricing allowlist.
 *
 * Business rules:
 * - Enforces schema parity with `deepagents/model_routes_config.py`: `version: 1`, non-empty `routes`, `roles.default`, and acyclic `fallbacks`.
 * - Accepts optional single-document YAML `---` start and `...` end markers at indentation 0 while rejecting multi-document streams.
 * - Provider values must match canonical lowercase providers; model values must be non-blank with zero leading/trailing ASCII whitespace and preserved casing.
 *
 * Execution flow:
 * 1. Tokenize YAML lines and strip optional leading `---` and trailing `...` single-document markers.
 * 2. Parse the root mapping block and validate top-level keys, `version === 1`, `routes`, `roles`, and `fallbacks`.
 * 3. Walk `fallbacks` graph to reject cycles and return deduplicated `allowlistedModels` alongside `entries`.
 *
 * Failure cases:
 * - Throws `ModelPricingDomainError` (`BILLING_VALIDATION_FAILED`) on malformed YAML, multi-document markers, unknown keys, invalid providers/models, or fallback cycles.
 *
 * Side effects:
 * - None: pure deterministic parser with zero filesystem or network I/O.
 */
export function parseRuntimeModelAllowlistYaml(
  yamlText: string,
): ParsedRuntimeModelRoutes {
  // Why: Billing domain pricing resolution must read the exact same model allowlist authority as Python `deepagents`
  // without adding third-party YAML runtime dependencies to `apps/api/package.json`.
  // How: Strips optional single-document `---`/`...` markers, parses the bounded YAML subset, and enforces identical schema, provider, whitespace, role, and acyclic fallback rules.
  // Invariants: `entry.provider` is canonical lowercase trimmed; `entry.model` preserves exact case; multi-document YAML fails closed.
  const rawLines = tokenizeYamlLines(yamlText);
  let docStart = 0;
  let docEnd = rawLines.length;
  if (
    docStart < docEnd &&
    rawLines[docStart].indent === 0 &&
    rawLines[docStart].content === "---"
  ) {
    docStart += 1;
  }
  if (
    docStart < docEnd &&
    rawLines[docEnd - 1].indent === 0 &&
    rawLines[docEnd - 1].content === "..."
  ) {
    docEnd -= 1;
  }

  const lines = rawLines.slice(docStart, docEnd);
  if (lines.length === 0) {
    throw new ModelPricingDomainError(
      BILLING_ERROR_CODES.validationFailed,
      "Model routes YAML is empty",
    );
  }

  const rootParsed = parseYamlBlock(lines, 0, lines[0].indent);
  if (
    rootParsed.nextIndex !== lines.length ||
    !isYamlMapping(rootParsed.value)
  ) {
    throw new ModelPricingDomainError(
      BILLING_ERROR_CODES.validationFailed,
      "Model routes YAML top-level must be a single mapping",
    );
  }

  const root = rootParsed.value;
  for (const key of Object.keys(root)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) {
      throw new ModelPricingDomainError(
        BILLING_ERROR_CODES.validationFailed,
        `Unknown top-level key '${key}' in model routes YAML`,
      );
    }
  }

  if (root.version !== 1) {
    throw new ModelPricingDomainError(
      BILLING_ERROR_CODES.validationFailed,
      "Model routes YAML version must be integer 1",
    );
  }

  if (!isYamlMapping(root.routes) || Object.keys(root.routes).length === 0) {
    throw new ModelPricingDomainError(
      BILLING_ERROR_CODES.validationFailed,
      "Model routes YAML routes must be a non-empty mapping",
    );
  }
  if (!isYamlMapping(root.roles)) {
    throw new ModelPricingDomainError(
      BILLING_ERROR_CODES.validationFailed,
      "Model routes YAML roles must be a mapping",
    );
  }
  const rawFallbacks = root.fallbacks === undefined ? {} : root.fallbacks;
  if (!isYamlMapping(rawFallbacks)) {
    throw new ModelPricingDomainError(
      BILLING_ERROR_CODES.validationFailed,
      "Model routes YAML fallbacks must be a mapping",
    );
  }

  const entries: RuntimeAllowlistEntry[] = [];
  const routeIds = new Set<string>();
  const modelSet = new Set<string>();

  for (const [routeId, rawRoute] of Object.entries(root.routes)) {
    if (routeId.trim().length === 0 || !isYamlMapping(rawRoute)) {
      throw new ModelPricingDomainError(
        BILLING_ERROR_CODES.validationFailed,
        `routes.${routeId} must be a mapping`,
      );
    }
    for (const routeKey of Object.keys(rawRoute)) {
      if (!ALLOWED_ROUTE_KEYS.has(routeKey)) {
        throw new ModelPricingDomainError(
          BILLING_ERROR_CODES.validationFailed,
          `routes.${routeId}: unknown key '${routeKey}'`,
        );
      }
    }

    const provider = rawRoute.provider;
    const model = rawRoute.model;
    if (typeof provider !== "string" || !ALLOWED_PROVIDERS.has(provider)) {
      throw new ModelPricingDomainError(
        BILLING_ERROR_CODES.validationFailed,
        `routes.${routeId}.provider must be a canonical runtime provider (got ${JSON.stringify(provider)})`,
      );
    }
    if (
      typeof model !== "string" ||
      model.trim().length === 0 ||
      model.trim() !== model
    ) {
      throw new ModelPricingDomainError(
        BILLING_ERROR_CODES.validationFailed,
        `routes.${routeId}.model must be a non-blank string without leading/trailing whitespace`,
      );
    }
    if (rawRoute.options !== undefined && !isYamlMapping(rawRoute.options)) {
      throw new ModelPricingDomainError(
        BILLING_ERROR_CODES.validationFailed,
        `routes.${routeId}.options must be a mapping`,
      );
    }

    const protocol = resolveAndValidateRouteProtocol(
      routeId,
      provider,
      model,
      rawRoute.protocol,
    );

    routeIds.add(routeId);
    modelSet.add(model);
    entries.push({
      routeId,
      provider,
      protocol,
      model,
    });
  }

  const roles: Record<string, string> = {};
  for (const [roleName, targetRoute] of Object.entries(root.roles)) {
    if (roleName.trim().length === 0) {
      throw new ModelPricingDomainError(
        BILLING_ERROR_CODES.validationFailed,
        "Model routes YAML role names must be non-blank strings",
      );
    }
    if (typeof targetRoute !== "string" || !routeIds.has(targetRoute)) {
      throw new ModelPricingDomainError(
        BILLING_ERROR_CODES.validationFailed,
        `roles.${roleName} references unknown route ${JSON.stringify(targetRoute)}`,
      );
    }
    roles[roleName] = targetRoute;
  }

  if (!Object.hasOwn(roles, "default")) {
    throw new ModelPricingDomainError(
      BILLING_ERROR_CODES.validationFailed,
      "Model routes YAML roles.default is required",
    );
  }

  const fallbacks: Record<string, readonly string[]> = {};
  for (const [routeId, chain] of Object.entries(rawFallbacks)) {
    if (!routeIds.has(routeId)) {
      throw new ModelPricingDomainError(
        BILLING_ERROR_CODES.validationFailed,
        `fallbacks.${routeId} references unknown route`,
      );
    }
    if (
      !Array.isArray(chain) ||
      !chain.every((item): item is string => typeof item === "string")
    ) {
      throw new ModelPricingDomainError(
        BILLING_ERROR_CODES.validationFailed,
        `fallbacks.${routeId} must be a list of route id strings`,
      );
    }
    for (const target of chain) {
      if (!routeIds.has(target)) {
        throw new ModelPricingDomainError(
          BILLING_ERROR_CODES.validationFailed,
          `fallbacks.${routeId} references unknown route '${target}'`,
        );
      }
    }
    fallbacks[routeId] = [...chain];
  }

  for (const routeId of Object.keys(fallbacks)) {
    assertFallbackNodeAcyclic(routeId, [], fallbacks);
  }

  return {
    entries,
    allowlistedModels: Array.from(modelSet),
    roles,
    fallbacks,
  };
}

/**
 * Business purpose: Check whether a `(provider, resolvedModel)` pair is authorized by the runtime allowlist entries.
 *
 * Business rules:
 * - Both `provider` and `resolvedModel` must be non-empty strings without leading or trailing whitespace.
 * - `provider` is matched case-insensitively (lowercased), while `resolvedModel` is matched case-sensitively.
 * - Both `provider` and `resolvedModel` must match the same entry so models cannot be resolved under the wrong provider.
 *
 * Execution flow:
 * 1. Verify `provider` and `resolvedModel` are non-empty trimmed strings.
 * 2. Normalize `provider` to lowercase and search `entries` for an exact `(provider, model)` match.
 *
 * Failure cases:
 * - Returns `false` (fails closed) for non-strings, empty/untrimmed values, or unmatched pairs.
 *
 * Side effects:
 * - None: pure read-only allowlist predicate.
 */
export function isRuntimeModelAllowlisted(
  entries: readonly RuntimeAllowlistEntry[],
  provider: string,
  resolvedModel: string,
): boolean {
  // Why: Allowlist checks must match `(provider, model)` jointly so a model configured for provider A
  // cannot inherit provider B's tariff or bypass allowlist validation.
  // How: Rejects untrimmed inputs, lowercases provider, and compares `entry.model === resolvedModel` exactly.
  // Invariants: Never mutates entries; fails closed on malformed inputs.
  if (
    typeof provider !== "string" ||
    provider.length === 0 ||
    provider.trim() !== provider
  ) {
    return false;
  }
  if (
    typeof resolvedModel !== "string" ||
    resolvedModel.length === 0 ||
    resolvedModel.trim() !== resolvedModel
  ) {
    return false;
  }

  const normalizedProvider = provider.toLowerCase();
  return entries.some(
    (entry) =>
      entry.provider.toLowerCase() === normalizedProvider &&
      entry.model === resolvedModel,
  );
}

/**
 * Business purpose: Assert that `(provider, resolvedModel)` is present in the runtime allowlist and return its matching route entry.
 *
 * Business rules:
 * - Fails closed with `ModelPricingUnlistedModelError` (`MODEL_PRICING_UNLISTED_MODEL`) if untrimmed, empty, or unlisted.
 * - Matches `provider` case-insensitively and `resolvedModel` case-sensitively.
 *
 * Execution flow:
 * 1. Validate `provider` and `resolvedModel` are non-empty trimmed strings.
 * 2. Find the matching `RuntimeAllowlistEntry` by normalized provider and exact model name.
 * 3. Return the matched entry or throw `ModelPricingUnlistedModelError`.
 *
 * Failure cases:
 * - Throws `ModelPricingUnlistedModelError` when validation fails or no matching entry exists.
 *
 * Side effects:
 * - None: pure read-only assertion.
 */
export function assertRuntimeModelAllowlisted(
  entries: readonly RuntimeAllowlistEntry[],
  provider: string,
  resolvedModel: string,
): RuntimeAllowlistEntry {
  // Why: Pricing resolution, draft publish, and preview must refuse any model not authorized by runtime routing.
  // How: Checks trimmed identity first, matches `(lowercase provider, exact model)`, and throws typed domain error on miss.
  // Invariants: Guarantees returned entry satisfies `entry.model === resolvedModel`.
  if (
    typeof provider !== "string" ||
    provider.length === 0 ||
    provider.trim() !== provider ||
    typeof resolvedModel !== "string" ||
    resolvedModel.length === 0 ||
    resolvedModel.trim() !== resolvedModel
  ) {
    throw new ModelPricingUnlistedModelError(
      `Model (${String(provider)}, ${String(resolvedModel)}) must be non-empty trimmed identifiers`,
    );
  }

  const normalizedProvider = provider.toLowerCase();
  const matched = entries.find(
    (entry) =>
      entry.provider.toLowerCase() === normalizedProvider &&
      entry.model === resolvedModel,
  );

  if (!matched) {
    throw new ModelPricingUnlistedModelError(
      `Model '${resolvedModel}' for provider '${normalizedProvider}' is not in runtime allowlist`,
    );
  }

  return matched;
}
