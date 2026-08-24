import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const TASKS_README_PATH = path.join(ROOT, "docs", "implementation", "tasks", "README.md");
const TASKS_DIR = path.join(ROOT, "docs", "implementation", "tasks");
const HANDBOOK_DIR = path.join(ROOT, "docs", "developer", "task-handbook");
const OUTPUT_PATH = path.join(ROOT, "docs", "developer", "task-index.md");

const DOMAIN_BY_TASK_ID = {
  "TASK-000": "Platform",
  "TASK-001": "Platform",
  "TASK-002": "Platform",
  "TASK-003": "Platform",
  "TASK-004": "Platform",
  "TASK-005": "Platform",
  "TASK-006": "Auth",
  "TASK-007": "Assessment",
  "TASK-008": "Wizard",
  "TASK-009": "Repository",
  "TASK-010": "Scanner",
  "TASK-011": "Platform",
  "TASK-012": "Scanner",
  "TASK-013": "Scanner",
  "TASK-014": "Scanner",
  "TASK-015": "Scanner",
  "TASK-016": "Technical Profile",
  "TASK-017": "AI Usage",
  "TASK-018": "Reconciliation",
  "TASK-019": "Collaboration",
  "TASK-020": "Legal",
  "TASK-021": "Legal",
  "TASK-022": "Legal",
  "TASK-023": "Legal",
  "TASK-024": "Legal",
  "TASK-025": "LLM Gateway",
  "TASK-026": "Classification",
  "TASK-027": "Reporting",
  "TASK-028": "Reporting",
  "TASK-029": "Audit",
  "TASK-030": "UX",
  "TASK-031": "UX",
  "TASK-032": "UX / QA",
  "TASK-033": "Acceptance",
  "TASK-034": "Acceptance",
};

function parseTaskCatalog(readmeText) {
  const lines = readmeText.split("\n");
  const tableStart = lines.findIndex((line) => line.trim() === "| Task ID | Status | Title | Primary owner | Dependencies | Dedicated brief |");
  if (tableStart === -1) {
    return [];
  }

  const rows = [];
  for (let i = tableStart + 2; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.startsWith("| TASK-")) {
      break;
    }

    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());

    const [taskId, statusCell, title, primaryOwner, dependencies, dedicatedBrief] = cells;
    const briefMatch = dedicatedBrief.match(/\[([^\]]+)\]\(([^)]+)\)/);

    rows.push({
      taskId,
      statusFromCatalog: statusCell.replace(/`/g, ""),
      title,
      primaryOwner,
      dependencies,
      briefFileName: briefMatch?.[2] ?? "",
    });
  }

  return rows;
}

function parseFrontmatter(mdText) {
  const match = mdText.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) {
    return {};
  }

  const data = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) {
      continue;
    }
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    data[key] = value;
  }
  return data;
}

function readTaskMetadata(row) {
  const briefPath = path.join(TASKS_DIR, row.briefFileName);
  const handbookPath = path.join(HANDBOOK_DIR, `${row.taskId}.md`);
  const briefText = fs.existsSync(briefPath) ? fs.readFileSync(briefPath, "utf8") : "";
  const briefMeta = parseFrontmatter(briefText);

  return {
    ...row,
    domain: DOMAIN_BY_TASK_ID[row.taskId] ?? "Unknown",
    status: briefMeta.status ?? row.statusFromCatalog,
    owner: briefMeta.owner ?? row.primaryOwner,
    runtime: briefMeta.runtime ?? "unknown",
    briefPath: `../implementation/tasks/${row.briefFileName}`,
    handbookPath: fs.existsSync(handbookPath) ? `task-handbook/${row.taskId}.md` : "",
  };
}

function groupBy(items, key) {
  const map = new Map();
  for (const item of items) {
    const groupKey = item[key];
    if (!map.has(groupKey)) {
      map.set(groupKey, []);
    }
    map.get(groupKey).push(item);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function mdLink(label, target) {
  return target ? `[${label}](${target})` : label;
}

function renderSummaryTable(items, key) {
  const grouped = groupBy(items, key);
  return [
    "| Group | Count | Tasks |",
    "|---|---:|---|",
    ...grouped.map(([groupName, groupItems]) => {
      const ids = groupItems.map((item) => `\`${item.taskId}\``).join(", ");
      return `| ${groupName} | ${groupItems.length} | ${ids} |`;
    }),
    "",
  ].join("\n");
}

function renderMasterTable(items) {
  return [
    "| Task | Domain | Owner | Runtime | Status | Dependencies | Brief | Handbook |",
    "|---|---|---|---|---|---|---|---|",
    ...items.map((item) => {
      return [
        `| \`${item.taskId}\` ${item.title}`,
        item.domain,
        `\`${item.owner}\``,
        `\`${item.runtime}\``,
        `\`${item.status}\``,
        item.dependencies,
        mdLink("brief", item.briefPath),
        mdLink("handbook", item.handbookPath),
      ].join(" | ") + " |";
    }),
    "",
  ].join("\n");
}

function renderGroupedSection(title, items, key) {
  const sections = [`## ${title}`, ""];
  for (const [groupName, groupItems] of groupBy(items, key)) {
    sections.push(`### ${groupName}`, "");
    sections.push("| Task | Title | Owner | Runtime | Dependencies |");
    sections.push("|---|---|---|---|---|");
    for (const item of groupItems) {
      sections.push(
        `| ${mdLink(`\`${item.taskId}\``, item.handbookPath || item.briefPath)} | ${item.title} | \`${item.owner}\` | \`${item.runtime}\` | ${item.dependencies} |`,
      );
    }
    sections.push("");
  }
  return sections.join("\n");
}

const readmeText = fs.readFileSync(TASKS_README_PATH, "utf8");
const catalogRows = parseTaskCatalog(readmeText);
const tasks = catalogRows.map(readTaskMetadata);

const output = `# LCSP Task Index

## Muc tieu

Muc luc nhanh cho developer de tim task brief va handbook theo \`domain\`, \`owner\`, va \`runtime\` ma khong can mo tung file thu cong.

## Cach dung

- Xem **Master Catalog** khi can tra nhanh dependency, runtime, va link brief.
- Xem **By Domain** khi duoc giao mot module/dong nghiep vu cu the.
- Xem **By Owner** khi can phan task theo nhom phu trach.
- Xem **By Runtime** khi can biet task nao thuoc \`nestjs-api\`, \`deepagents\`, \`apps-web\`, hay \`cross-runtime\`.
- Mo \`handbook\` truoc de lay task boundary nhanh; mo \`brief\` khi can contract day du.

## Source Of Truth

- Task catalog: \`docs/implementation/tasks/README.md\`
- Task briefs: \`docs/implementation/tasks/*.md\`
- Developer handbooks: \`docs/developer/task-handbook/*.md\`

## Summary By Domain

${renderSummaryTable(tasks, "domain")}## Summary By Owner

${renderSummaryTable(tasks, "owner")}## Summary By Runtime

${renderSummaryTable(tasks, "runtime")}## Master Catalog

${renderMasterTable(tasks)}${renderGroupedSection("By Domain", tasks, "domain")}
${renderGroupedSection("By Owner", tasks, "owner")}
${renderGroupedSection("By Runtime", tasks, "runtime")}
`;

fs.writeFileSync(OUTPUT_PATH, `${output.trim()}\n`, "utf8");
console.log(`Generated ${path.relative(ROOT, OUTPUT_PATH)}`);
