import { createHash } from "node:crypto";
import ts from "typescript";

/** Shared format for TypeScript JSDoc and Python docstrings. */
export const BUSINESS_SECTIONS = [
  "Business purpose",
  "Business rules",
  "Execution flow",
  "Failure cases",
  "Side effects",
];

const headings = new Map(
  BUSINESS_SECTIONS.map((name) => [name.toLowerCase(), name]),
);
const invalidAnswer =
  /^(?:(?:TODO|TBD|FIXME|N\/?A|UNKNOWN|PLACEHOLDER)\b|(?:NONE|SAME AS CODE|HANDLE LOGIC)\.?$)/i;
const safePath = (path) => path.replaceAll("\\", "/");

export function isBusinessSource(path) {
  const name = safePath(path);
  if (
    !/\.(?:ts|tsx|js|jsx)$/.test(name) ||
    /(?:\.d\.ts|\.(?:spec|test|stories)\.[jt]sx?)$/.test(name)
  ) {
    return false;
  }
  if (
    /(?:^|\/)(?:__generated__|generated|mocks|fixtures|tests|test|dist|node_modules)\//.test(
      name,
    )
  ) {
    return false;
  }

  if (/^apps\/api\/src\/modules\//.test(name)) {
    return (
      /\/(?:application|domain)\//.test(name) ||
      /\/(?:infrastructure|presentation)\/.*(?:\.(?:handler|service|policy|validator)\.[jt]s)$/.test(
        name,
      )
    );
  }
  if (/^apps\/api\/src\/(?:platform|common)\//.test(name)) {
    return /(?:\.(?:handler|service|policy|validator)\.[jt]s)$/.test(name);
  }
  if (/^apps\/web\/src\/features\//.test(name)) {
    return (
      /\/(?:hooks|utils|services|domain|application|stores|clients|schemas)\//.test(
        name,
      ) || /(?:-client|-queries|-service|-handler)\.[jt]s$/.test(name)
    );
  }
  if (/^apps\/web\/src\/app\/api\//.test(name)) {
    return /\/route\.[jt]s$/.test(name);
  }
  if (/^apps\/web\/src\/lib\//.test(name)) {
    return true;
  }
  if (/^packages\/contracts\/src\//.test(name)) {
    return true;
  }
  // Infrastructure such as generic Prisma clients, logging and transport
  // helpers is technical and is not presumed to own business decisions.
  return false;
}

export function isPythonBusinessSource(path) {
  const name = safePath(path);
  return (
    /^(?:deepagents|deepagents-langgraph)\//.test(name) &&
    name.endsWith(".py") &&
    !/(?:^|\/)(?:tests?|fixtures|migrations|\.venv|venv|__pycache__|\.mda|generated)\//.test(
      name,
    ) &&
    !/(?:^|\/)(?:__init__|conftest|setup)\.py$/.test(name)
  );
}

/**
 * Validates the real content under the five headings, not merely their names.
 * Long-form business meaning must still be checked by the author/reviewer.
 */
export function validateBusinessDocumentation(comment) {
  if (typeof comment !== "string" || !comment.trim()) {
    return [
      "missing structured Business purpose / rules / flow / failures / effects documentation",
    ];
  }
  const cleaned = comment
    .replace(/^\s*\/\*\*/, "")
    .replace(/\*\/\s*$/, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\*\s?/, "").trim());

  const sections = new Map();
  const sectionOrder = [];
  const repeatedSections = [];
  let current = null;
  for (const line of cleaned) {
    const match = line.match(
      /^(Business purpose|Business rules|Execution flow|Failure cases|Side effects):\s*(.*)$/i,
    );
    if (match) {
      current = headings.get(match[1].toLowerCase());
      if (sections.has(current)) repeatedSections.push(current);
      else {
        sections.set(current, []);
        sectionOrder.push(current);
      }
      if (match[2]) sections.get(current).push(match[2]);
    } else if (current && line) {
      sections.get(current).push(line);
    }
  }

  const problems = [];
  if (repeatedSections.length)
    problems.push(
      `repeated business documentation section: ${repeatedSections.join(", ")}`,
    );
  if (
    sectionOrder.length === BUSINESS_SECTIONS.length &&
    sectionOrder.some((name, index) => name !== BUSINESS_SECTIONS[index])
  ) {
    problems.push(
      "business documentation sections must appear in the prescribed order",
    );
  }
  for (const section of BUSINESS_SECTIONS) {
    if (!sections.has(section)) {
      problems.push(`missing "${section}:" section`);
    }
  }

  const purpose = sections.get("Business purpose") ?? [];
  if (
    !purpose.length ||
    purpose.join(" ").length < 18 ||
    invalidAnswer.test(purpose.join(" ").trim())
  ) {
    if (sections.has("Business purpose"))
      problems.push(
        "Business purpose must describe the business outcome (not a placeholder)",
      );
  }

  for (const section of ["Business rules", "Failure cases", "Side effects"]) {
    if (!sections.has(section)) continue;
    const lines = sections.get(section);
    const meaningful = lines.some(
      (line) =>
        /^-\s+\S/.test(line) &&
        line.replace(/^-\s+/, "").length >= 14 &&
        !invalidAnswer.test(line.replace(/^-\s+/, "").trim()),
    );
    if (!meaningful)
      problems.push(`"${section}:" must contain a meaningful "- ..." bullet`);
  }

  if (sections.has("Execution flow")) {
    const steps = sections.get("Execution flow");
    const ordered = steps.filter((line) => /^\d+\.\s+\S/.test(line));
    const meaningful = ordered.some(
      (line) =>
        line.replace(/^\d+\.\s+/, "").length >= 14 &&
        !invalidAnswer.test(line.replace(/^\d+\.\s+/, "").trim()),
    );
    if (!meaningful) {
      problems.push(
        '"Execution flow:" must contain a meaningful ordered step such as "1. ..."',
      );
    } else if (
      ordered.some((line, index) => Number(line.match(/^\d+/)[0]) !== index + 1)
    ) {
      problems.push(
        '"Execution flow:" steps must start at 1 and use consecutive numbering',
      );
    }
  }
  return problems;
}

/** Enforces the frozen baseline only for the exact unchanged legacy implementation. */
export function findBusinessDocumentationViolations(records, baseline = {}) {
  return records.filter(
    (record) =>
      record.problems.length > 0 && baseline[record.key] !== record.hash,
  );
}

function sha(source) {
  return createHash("sha256")
    .update(source.replace(/\s+/g, " ").trim())
    .digest("hex");
}

function textOfName(node, sf) {
  if (!node) return "default";
  return node.getText(sf).replace(/\s/g, "").slice(0, 80);
}

export function collectTypeScriptBusinessFunctions(source, path) {
  const scriptKind = /\.tsx$/.test(path)
    ? ts.ScriptKind.TSX
    : /\.jsx$/.test(path)
      ? ts.ScriptKind.JSX
      : /\.js$/.test(path)
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const result = [];
  const duplicateCounters = new Map();

  function add(node, target, name, scope, docNode = node) {
    if (!target?.body || !name || name === "constructor") return false;
    const fullName = [...scope, name].join(".");
    const occurrence = (duplicateCounters.get(fullName) ?? 0) + 1;
    duplicateCounters.set(fullName, occurrence);
    const id = `${path}::${fullName}${occurrence > 1 ? `#${occurrence}` : ""}`;
    const jsdoc = docNode.jsDoc?.at(-1) ?? node.jsDoc?.at(-1);
    const documentation = jsdoc ? source.slice(jsdoc.pos, jsdoc.end) : null;
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    result.push({
      key: id,
      hash: sha(node.getText(sf)),
      name: fullName,
      path,
      line,
      problems: validateBusinessDocumentation(documentation),
    });
    return true;
  }

  function visit(node, scope = []) {
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      ts.forEachChild(node, (child) =>
        visit(child, [...scope, textOfName(node.name, sf)]),
      );
      return;
    }
    let newScope = scope;
    if (ts.isFunctionDeclaration(node) && node.body) {
      const name = textOfName(node.name, sf);
      add(node, node, name, scope);
      newScope = [...scope, name];
    } else if (
      (ts.isMethodDeclaration(node) ||
        ts.isGetAccessorDeclaration(node) ||
        ts.isSetAccessorDeclaration(node)) &&
      node.body
    ) {
      const name = textOfName(node.name, sf);
      add(node, node, name, scope);
      newScope = [...scope, name];
    } else if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) ||
        ts.isFunctionExpression(node.initializer))
    ) {
      const name = textOfName(node.name, sf);
      const statement =
        ts.isVariableDeclarationList(node.parent) &&
        ts.isVariableStatement(node.parent.parent)
          ? node.parent.parent
          : node;
      add(node, node.initializer, name, scope, statement);
      newScope = [...scope, name];
    } else if (
      (ts.isPropertyDeclaration(node) || ts.isPropertyAssignment(node)) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) ||
        ts.isFunctionExpression(node.initializer))
    ) {
      const name = textOfName(node.name, sf);
      add(node, node.initializer, name, scope);
      newScope = [...scope, name];
    }
    ts.forEachChild(node, (child) => visit(child, newScope));
  }

  visit(sf);
  return result;
}
