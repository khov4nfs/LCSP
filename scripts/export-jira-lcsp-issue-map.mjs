#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { findAllowedJiraPage } from "./jira-page-url.mjs";

const ROOT = process.cwd();
const CDP_BASE = process.env.CDP_BASE_URL || "http://127.0.0.1:9222";
const DEV_DIR = path.join(ROOT, "docs", "developer");

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${url}: ${response.status} ${response.statusText}`,
    );
  }
  return response.json();
}

class CdpPage {
  constructor(target) {
    this.target = target;
    this.id = 0;
    this.pending = new Map();
    this.ws = null;
  }

  async connect() {
    this.ws = new WebSocket(this.target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("WebSocket timeout")),
        10000,
      );
      this.ws.onopen = () => {
        clearTimeout(timeout);
        resolve();
      };
      this.ws.onerror = (event) => {
        clearTimeout(timeout);
        reject(event.error || new Error("WebSocket error"));
      };
    });
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) {
        return;
      }
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) {
        reject(new Error(JSON.stringify(message.error)));
      } else {
        resolve(message.result);
      }
    };
    await this.send("Runtime.enable");
  }

  async close() {
    this.ws?.close();
    this.ws = null;
  }

  async send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || "Evaluation failed");
    }
    return result.result?.value;
  }
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

async function getAtlassianPage() {
  const pages = await fetchJson(`${CDP_BASE}/json/list`);
  const target = findAllowedJiraPage(pages);
  if (!target) {
    throw new Error(
      "No logged-in Atlassian page found in Chrome DevTools targets.",
    );
  }
  const page = new CdpPage(target);
  await page.connect();
  return page;
}

async function main() {
  const page = await getAtlassianPage();
  try {
    const issues = await page.evaluate(`(async () => {
      let nextPageToken = null;
      const issues = [];
      for (;;) {
        const body = {
          jql: "project = LCSP ORDER BY key ASC",
          fields: [
            "summary",
            "issuetype",
            "status",
            "parent",
            "labels",
            "customfield_10020",
            "customfield_10015",
            "duedate",
            "customfield_10016",
            "priority"
          ],
          maxResults: 100
        };
        if (nextPageToken) {
          body.nextPageToken = nextPageToken;
        }
        const response = await fetch("/rest/api/3/search/jql", {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(body)
        });
        if (!response.ok) {
          throw new Error(await response.text());
        }
        const json = await response.json();
        issues.push(...(json.issues || []));
        if (!json.nextPageToken || json.isLast === true || !(json.issues || []).length) {
          break;
        }
        nextPageToken = json.nextPageToken;
      }
      return issues.map((issue) => ({
        key: issue.key,
        type: issue.fields.issuetype.name,
        summary: issue.fields.summary,
        status: issue.fields.status.name,
        parent: issue.fields.parent?.key || "",
        labels: (issue.fields.labels || []).join(";"),
        sprints: (issue.fields.customfield_10020 || []).map((sprint) => sprint.name || sprint.id).join(";"),
        startDate: issue.fields.customfield_10015 || "",
        dueDate: issue.fields.duedate || "",
        storyPoints: issue.fields.customfield_10016 ?? "",
        priority: issue.fields.priority?.name || ""
      }));
    })()`);

    const rows = issues.map((issue) => ({
      Key: issue.key,
      "Issue Type": issue.type,
      Summary: issue.summary,
      Status: issue.status,
      Parent: issue.parent,
      Labels: issue.labels,
      Sprint: issue.sprints,
      "Start Date": issue.startDate,
      "Due Date": issue.dueDate,
      "Story Points": issue.storyPoints,
      Priority: issue.priority,
      URL: `https://minhpnq1807.atlassian.net/browse/${issue.key}`,
    }));

    writeCsv(
      path.join(DEV_DIR, "jira-lcsp-push-result.csv"),
      [
        "Key",
        "Issue Type",
        "Summary",
        "Status",
        "Parent",
        "Labels",
        "Sprint",
        "Start Date",
        "Due Date",
        "Story Points",
        "Priority",
        "URL",
      ],
      rows,
    );

    const byType = rows.reduce((acc, row) => {
      acc[row["Issue Type"]] = (acc[row["Issue Type"]] ?? 0) + 1;
      return acc;
    }, {});
    const taskWithoutParent = rows.filter(
      (row) => row["Issue Type"] === "Task" && !row.Parent,
    );

    fs.writeFileSync(
      path.join(DEV_DIR, "jira-lcsp-push-result.md"),
      [
        "# LCSP Jira Push Result",
        "",
        `Generated from Jira project LCSP via logged-in Chrome session.`,
        "",
        "## Counts",
        "",
        `- Total issues: ${rows.length}`,
        `- Epics: ${byType.Epic ?? 0}`,
        `- Stories: ${byType.Story ?? 0}`,
        `- Tasks: ${byType.Task ?? 0}`,
        `- Tasks without parent: ${taskWithoutParent.length}`,
        "",
        "## Artifacts",
        "",
        "- `docs/developer/jira-lcsp-push-result.csv`",
        "- `docs/developer/jira-lcsp-modules-import.csv`",
        "- `docs/developer/jira-lcsp-stories-import.csv`",
        "- `docs/developer/jira-lcsp-tasks-import.csv`",
        "- `docs/developer/jira-lcsp-story-task-mapping.csv`",
        "",
      ].join("\n"),
      "utf8",
    );

    console.log(
      JSON.stringify(
        {
          total: rows.length,
          byType,
          taskWithoutParent: taskWithoutParent.length,
        },
        null,
        2,
      ),
    );
  } finally {
    await page.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
