#!/usr/bin/env node

import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const DEV_DIR = path.join(ROOT, "docs", "developer");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const [header, ...body] = rows.filter((items) => items.some(Boolean));
  return body.map((items) => Object.fromEntries(header.map((key, index) => [key, items[index] ?? ""])));
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(filePath, header, rows) {
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(header.map((key) => csvEscape(row[key] ?? "")).join(","));
  }
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

const roleByAssignee = {
  Khovan: "Main flow lead / backend orchestration",
  nhibao08: "Rotating contributor across all modules",
  Nta1210: "Rotating contributor across all modules",
  DthuyInk: "Rotating contributor across all modules",
  anhtunguyen05: "Rotating contributor across all modules",
};

const rosterByAssignee = {
  Khovan: { name: "Phan Nguyễn Quốc Minh (leader, PM)", jiraEmail: "minhpnq1807@gmail.com", github: "khovan123" },
  nhibao08: { name: "Lê Bảo Nhi", jiraEmail: "lebaonhi0805@gmail.com", github: "nhibao08" },
  Nta1210: { name: "Nguyễn Tuấn Anh", jiraEmail: "anhkn7@gmail.com", github: "Nta1210" },
  DthuyInk: { name: "Trần Nguyễn Đăng Thụy", jiraEmail: "trannguyendangthuy120701@gmail.com", github: "DthuyInk" },
  anhtunguyen05: { name: "Nguyễn Anh Tú", jiraEmail: "anhtunguyen643@gmail.com", github: "anhtunguyen05" },
};

const mainFlowTaskIds = new Set([
  "MW-cfg-001",
  "MW-audit-001",
  "MW-audit-002",
  "MW-outbox-001",
  "MW-outbox-002",
  "MW-pbac-001",
  "MW-pbac-002",
  "MW-pbac-003",
  "MW-pbac-004",
  "MW-asmt-001",
  "MW-asmt-002",
  "MW-asmt-003",
  "MW-gh-001",
  "MW-gh-002",
  "MW-gh-003",
  "MW-gh-004",
  "MW-scan-001",
  "MW-scan-002",
  "MW-evid-001",
  "MW-evid-002",
  "MW-aiuf-001",
  "MW-rec-001",
  "MW-cls-001",
  "MW-cls-002",
  "MW-doc-003",
  "MW-qa-003",
]);

const rotation = ["nhibao08", "Nta1210", "DthuyInk", "anhtunguyen05"];

// Pipeline-adjacent tasks within the same module are kept in contiguous
// segments (instead of interleaved one-by-one) so a dependent chain of steps
// stays with one person; segments are then bin-packed onto whichever
// rotating member currently carries the least load, keeping totals balanced.
const MAX_SEGMENT_SIZE = 3;

function assignRotationSegments(allTasks) {
  const groupOrder = [];
  const groups = new Map();
  for (const task of allTasks) {
    if (mainFlowTaskIds.has(task["Task ID"])) {
      continue;
    }
    if (!groups.has(task.Module)) {
      groups.set(task.Module, []);
      groupOrder.push(task.Module);
    }
    groups.get(task.Module).push(task);
  }

  const load = Object.fromEntries(rotation.map((name) => [name, 0]));
  const assigneeByTaskId = new Map();
  let rotationCursor = 0;

  for (const moduleName of groupOrder) {
    const moduleTasks = groups.get(moduleName);
    for (let start = 0; start < moduleTasks.length; start += MAX_SEGMENT_SIZE) {
      const segment = moduleTasks.slice(start, start + MAX_SEGMENT_SIZE);

      let bestOffset = 0;
      let bestLoad = Infinity;
      for (let offset = 0; offset < rotation.length; offset += 1) {
        const name = rotation[(rotationCursor + offset) % rotation.length];
        if (load[name] < bestLoad) {
          bestLoad = load[name];
          bestOffset = offset;
        }
      }
      const assignee = rotation[(rotationCursor + bestOffset) % rotation.length];

      for (const task of segment) {
        assigneeByTaskId.set(task["Task ID"], assignee);
      }
      load[assignee] += segment.length;
      rotationCursor = (rotationCursor + bestOffset + 1) % rotation.length;
    }
  }

  return assigneeByTaskId;
}

const tasks = parseCsv(fs.readFileSync(path.join(DEV_DIR, "jira-lcsp-tasks-import.csv"), "utf8"));
const jiraRows = parseCsv(fs.readFileSync(path.join(DEV_DIR, "jira-lcsp-push-result.csv"), "utf8"));
const jiraBySummary = new Map(jiraRows.filter((row) => row["Issue Type"] === "Task").map((row) => [row.Summary, row]));

const rotationAssignments = assignRotationSegments(tasks);

function assignTask(task) {
  const id = task["Task ID"];

  if (mainFlowTaskIds.has(id)) {
    return "Khovan";
  }
  return rotationAssignments.get(id);
}

const assignmentRows = tasks.map((task) => {
  const assignee = assignTask(task);
  const jira = jiraBySummary.get(task.Summary);
  return {
    Assignee: assignee,
    Role: roleByAssignee[assignee],
    "Main Flow": assignee === "Khovan" && mainFlowTaskIds.has(task["Task ID"]) ? "true" : "false",
    "Jira Key": jira?.Key ?? "",
    "Task ID": task["Task ID"],
    "Task Name": task.Summary.replace(/^[^:]+:\s*/, ""),
    Module: task.Module,
    Runtime: task.Runtime,
    Story: task.Story,
    Priority: task.Priority,
    Status: task.Status,
    "Jira URL": jira?.URL ?? "",
    "Source URL": task["Source URL"],
  };
});

const header = [
  "Assignee",
  "Role",
  "Main Flow",
  "Jira Key",
  "Task ID",
  "Task Name",
  "Module",
  "Runtime",
  "Story",
  "Priority",
  "Status",
  "Jira URL",
  "Source URL",
];

writeCsv(path.join(DEV_DIR, "lcsp-local-assignments.csv"), header, assignmentRows);

const grouped = new Map();
for (const row of assignmentRows) {
  if (!grouped.has(row.Assignee)) {
    grouped.set(row.Assignee, []);
  }
  grouped.get(row.Assignee).push(row);
}

const summaryRows = [...grouped.entries()].map(([assignee, rows]) => ({
  Assignee: assignee,
  Role: roleByAssignee[assignee],
  Total: rows.length,
  P0: rows.filter((row) => row.Priority === "P0").length,
  P1: rows.filter((row) => row.Priority === "P1").length,
  Done: rows.filter((row) => row.Status === "DONE").length,
  Ready: rows.filter((row) => row.Status === "READY_FOR_DEV").length,
  "Main Flow": rows.filter((row) => row["Main Flow"] === "true").length,
}));

writeCsv(
  path.join(DEV_DIR, "lcsp-local-assignment-summary.csv"),
  ["Assignee", "Role", "Total", "P0", "P1", "Done", "Ready", "Main Flow"],
  summaryRows,
);

const md = [
  "# LCSP Local Assignments",
  "",
  "Local-only assignment plan generated from `docs/implementation/tasks/modules` via Jira import artifacts.",
  "",
  "## Team Roster",
  "",
  "| Assignee | Name | Jira Email | GitHub Username |",
  "|---|---|---|---|",
  ...Object.entries(rosterByAssignee).map(
    ([assignee, person]) => `| ${assignee} | ${person.name} | ${person.jiraEmail} | ${person.github} |`,
  ),
  "",
  "## Rules",
  "",
  "- `Khovan` owns the critical/main flow and integration seams.",
  "- `nhibao08`, `Nta1210`, `DthuyInk`, `anhtunguyen05` rotate across every module (auth, web, interview, scanner, legal RAG, reconciliation, classification, reporting, audit, etc.) so no single module has one fixed owner and everyone builds context on the whole system.",
  "- Within a module, pipeline-adjacent tasks are kept in contiguous segments (max 5 tasks) rather than interleaved task-by-task, so a dependent chain of steps stays with one person instead of forcing a handoff after every single task.",
  "- Segments are bin-packed onto whichever rotating member currently carries the least load, so total workload stays balanced across the 4 members even though segment sizes vary.",
  "- Rotation and balancing are computed by `scripts/generate-local-assignments.mjs`; re-run it whenever `jira-lcsp-tasks-import.csv` changes.",
  "",
  "## Summary",
  "",
  "| Assignee | Role | Total | P0 | P1 | Done | Ready | Main Flow |",
  "|---|---|---:|---:|---:|---:|---:|---:|",
  ...summaryRows.map(
    (row) =>
      `| ${row.Assignee} | ${row.Role} | ${row.Total} | ${row.P0} | ${row.P1} | ${row.Done} | ${row.Ready} | ${row["Main Flow"]} |`,
  ),
  "",
  "## Tasks By Assignee",
  "",
];

for (const [assignee, rows] of [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right))) {
  md.push(`### ${assignee} - ${roleByAssignee[assignee]} (${rows.length})`, "");
  for (const row of rows) {
    const marker = row["Main Flow"] === "true" ? "main-flow" : "support";
    md.push(
      `- \`${row["Jira Key"]}\` \`${row["Task ID"]}\`: ${row["Task Name"]} (${row.Module}, Story ${row.Story}, ${row.Priority}, ${row.Status}, ${marker})`,
    );
  }
  md.push("");
}

fs.writeFileSync(path.join(DEV_DIR, "lcsp-local-assignments.md"), `${md.join("\n")}\n`, "utf8");

console.log(JSON.stringify({ total: assignmentRows.length, summary: summaryRows }, null, 2));
