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

const sprintDefinitions = [
  {
    sprint: "LCSP Sprint 1",
    sequence: 1,
    theme: "Foundation, auth, assessment, interview entry",
    start: "2026-07-04T22:45:00+07:00",
    end: "2026-07-18T23:59:59+07:00",
    stories: new Set(["1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "1.8", "2.1", "2.2", "2.3", "2.4"]),
  },
  {
    sprint: "LCSP Sprint 2",
    sequence: 2,
    theme: "Repository connection, scan orchestration, technical evidence",
    start: "2026-07-19T00:00:00+07:00",
    end: "2026-08-02T23:59:59+07:00",
    stories: new Set(["3.1", "3.2", "3.3", "3.4", "3.5", "3.6"]),
  },
  {
    sprint: "LCSP Sprint 3",
    sequence: 3,
    theme: "AI usage analysis and reconciliation",
    start: "2026-08-03T00:00:00+07:00",
    end: "2026-08-17T23:59:59+07:00",
    stories: new Set(["4.1", "4.2", "5.1", "5.2", "5.3", "5.4"]),
  },
  {
    sprint: "LCSP Sprint 4",
    sequence: 4,
    theme: "Legal matching and classification",
    start: "2026-08-18T00:00:00+07:00",
    end: "2026-09-01T23:59:59+07:00",
    stories: new Set(["6.1", "6.2", "6.7", "7.3", "7.5"]),
  },
  {
    sprint: "LCSP Sprint 5",
    sequence: 5,
    theme: "Reporting, audit export, final hardening",
    start: "2026-09-02T00:00:00+07:00",
    end: "2026-09-16T23:59:59+07:00",
    stories: new Set(["8.1", "8.3", "8.6", "8.7"]),
  },
];

const sprintByStory = new Map();
for (const sprint of sprintDefinitions) {
  for (const story of sprint.stories) {
    sprintByStory.set(story, sprint);
  }
}

const issues = parseCsv(fs.readFileSync(path.join(DEV_DIR, "jira-lcsp-push-result.csv"), "utf8"));
const tasks = parseCsv(fs.readFileSync(path.join(DEV_DIR, "lcsp-local-assignments.csv"), "utf8"));
const stories = parseCsv(fs.readFileSync(path.join(DEV_DIR, "jira-lcsp-stories-import.csv"), "utf8"));

const taskByJira = new Map(tasks.map((task) => [task["Jira Key"], task]));
const storyRefBySummary = new Map(stories.map((story) => [story.Summary, story.Story]));

function storyForIssue(issue) {
  if (issue["Issue Type"] === "Task") {
    return taskByJira.get(issue.Key)?.Story ?? "";
  }
  if (issue["Issue Type"] === "Story") {
    return storyRefBySummary.get(issue.Summary) ?? "";
  }
  return "";
}

const rows = [];
const epicRows = [];
for (const issue of issues) {
  if (issue["Issue Type"] === "Epic") {
    const module = issue.Summary.replace(/^Module:\s*/, "");
    epicRows.push({
      Target: "Backlog",
      "Jira Key": issue.Key,
      "Issue Type": issue["Issue Type"],
      Module: module,
      Summary: issue.Summary,
      Status: issue.Status,
      "Current Sprint": issue.Sprint ?? "",
      Reason: "Epic is a portfolio container and must not be assigned to execution sprints.",
      URL: issue.URL,
    });
    continue;
  }

  const story = storyForIssue(issue);
  const sprint = sprintByStory.get(story);
  if (!sprint) {
    throw new Error(`No sprint mapping for ${issue.Key} ${issue.Summary} story=${story}`);
  }
  const task = taskByJira.get(issue.Key);
  rows.push({
    Sprint: sprint.sprint,
    Sequence: sprint.sequence,
    Theme: sprint.theme,
    Start: sprint.start,
    End: sprint.end,
    "Jira Key": issue.Key,
    "Issue Type": issue["Issue Type"],
    "Task ID": task?.["Task ID"] ?? "",
    Summary: issue.Summary,
    Assignee: task?.Assignee ?? "",
    "Main Flow": task?.["Main Flow"] ?? "",
    Story: story,
    Priority: task?.Priority ?? "",
    Status: issue.Status,
    URL: issue.URL,
  });
}

rows.sort((left, right) => {
  if (Number(left.Sequence) !== Number(right.Sequence)) {
    return Number(left.Sequence) - Number(right.Sequence);
  }
  const order = { Epic: 0, Story: 1, Task: 2 };
  if (left["Issue Type"] !== right["Issue Type"]) {
    return order[left["Issue Type"]] - order[right["Issue Type"]];
  }
  return left["Jira Key"].localeCompare(right["Jira Key"], undefined, { numeric: true });
});

writeCsv(
  path.join(DEV_DIR, "jira-lcsp-sprint-plan.csv"),
  [
    "Sprint",
    "Sequence",
    "Theme",
    "Start",
    "End",
    "Jira Key",
    "Issue Type",
    "Task ID",
    "Summary",
    "Assignee",
    "Main Flow",
    "Story",
    "Priority",
    "Status",
    "URL",
  ],
  rows,
);

writeCsv(
  path.join(DEV_DIR, "jira-lcsp-epics-backlog-plan.csv"),
  ["Target", "Jira Key", "Issue Type", "Module", "Summary", "Status", "Current Sprint", "Reason", "URL"],
  epicRows,
);

const summary = sprintDefinitions.map((sprint) => {
  const sprintRows = rows.filter((row) => row.Sprint === sprint.sprint);
  const tasksOnly = sprintRows.filter((row) => row["Issue Type"] === "Task");
  return {
    Sprint: sprint.sprint,
    Theme: sprint.theme,
    Start: sprint.start,
    End: sprint.end,
    Epics: 0,
    Stories: sprintRows.filter((row) => row["Issue Type"] === "Story").length,
    Tasks: tasksOnly.length,
    "P0 Tasks": tasksOnly.filter((row) => row.Priority === "P0").length,
    "P1 Tasks": tasksOnly.filter((row) => row.Priority === "P1").length,
    "Main Flow Tasks": tasksOnly.filter((row) => row["Main Flow"] === "true").length,
    "Total Issues": sprintRows.length,
  };
});

writeCsv(
  path.join(DEV_DIR, "jira-lcsp-sprint-plan-summary.csv"),
  ["Sprint", "Theme", "Start", "End", "Epics", "Stories", "Tasks", "P0 Tasks", "P1 Tasks", "Main Flow Tasks", "Total Issues"],
  summary,
);

const md = [
  "# LCSP Jira Sprint Plan",
  "",
  "Corrective sprint split generated because all Jira issues were initially placed in `LCSP Sprint 1`.",
  "",
  "## BMad Position",
  "",
  "- Current BMad phase: `4-implementation`.",
  "- Relevant required workflow: `[SP] Sprint Planning` / `bmad-sprint-planning`.",
  "- This file is the corrective local sprint planning artifact used before syncing Jira.",
  "",
  "## Policy",
  "",
  "- Epics are excluded from execution sprints and kept in backlog/no sprint.",
  "- Story and Task issues are assigned to exactly one sprint by dependency flow.",
  "- `Khovan` remains in the main flow through integration and orchestration tasks.",
  "",
  "## Summary",
  "",
  "| Sprint | Theme | Epics | Stories | Tasks | P0 | P1 | Main Flow | Total Issues |",
  "|---|---|---:|---:|---:|---:|---:|---:|---:|",
  ...summary.map(
    (row) =>
      `| ${row.Sprint} | ${row.Theme} | ${row.Epics} | ${row.Stories} | ${row.Tasks} | ${row["P0 Tasks"]} | ${row["P1 Tasks"]} | ${row["Main Flow Tasks"]} | ${row["Total Issues"]} |`,
  ),
  "",
  "## Jira Sync Targets",
  "",
  "- `docs/developer/jira-lcsp-sprint-plan.csv`",
  "- `docs/developer/jira-lcsp-sprint-plan-summary.csv`",
  "- `docs/developer/jira-lcsp-epics-backlog-plan.csv`",
  "",
];

fs.writeFileSync(path.join(DEV_DIR, "jira-lcsp-sprint-plan.md"), `${md.join("\n")}\n`, "utf8");

console.log(JSON.stringify({ summary, plannedIssues: rows.length, epicsToBacklog: epicRows.length }, null, 2));
