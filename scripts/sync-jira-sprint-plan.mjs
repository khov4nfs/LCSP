#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { findAllowedJiraPage } from "./jira-page-url.mjs";

const ROOT = process.cwd();
const DEV_DIR = path.join(ROOT, "docs", "developer");
const CDP_BASE = process.env.CDP_BASE_URL || "http://127.0.0.1:9222";
const BOARD_ID = 71;

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
  return body.map((items) =>
    Object.fromEntries(header.map((key, index) => [key, items[index] ?? ""])),
  );
}

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

const sprintRows = parseCsv(
  fs.readFileSync(path.join(DEV_DIR, "jira-lcsp-sprint-plan.csv"), "utf8"),
);
const summaryRows = parseCsv(
  fs.readFileSync(
    path.join(DEV_DIR, "jira-lcsp-sprint-plan-summary.csv"),
    "utf8",
  ),
);
const epicBacklogPath = path.join(DEV_DIR, "jira-lcsp-epics-backlog-plan.csv");
const epicBacklogRows = fs.existsSync(epicBacklogPath)
  ? parseCsv(fs.readFileSync(epicBacklogPath, "utf8"))
  : [];

const syncPlan = summaryRows.map((summary) => ({
  name: summary.Sprint,
  theme: summary.Theme,
  start: summary.Start,
  end: summary.End,
  goal: summary.Theme,
  issues: sprintRows
    .filter((row) => row.Sprint === summary.Sprint)
    .map((row) => row["Jira Key"]),
}));
const epicBacklogIssues = epicBacklogRows
  .map((row) => row["Jira Key"])
  .filter(Boolean);

const page = await getAtlassianPage();
try {
  const result = await page.evaluate(`(async () => {
    const boardId = ${BOARD_ID};
    const syncPlan = ${JSON.stringify(syncPlan)};
    const epicBacklogIssues = ${JSON.stringify(epicBacklogIssues)};
    async function request(path, options = {}) {
      const response = await fetch(path, {
        headers: { accept: "application/json", "content-type": "application/json", ...(options.headers || {}) },
        ...options,
      });
      const text = await response.text();
      let body;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }
      if (!response.ok) {
        throw new Error(JSON.stringify({ path, status: response.status, body }));
      }
      return body;
    }

    async function allSprints() {
      const states = ["active", "future", "closed"];
      const values = [];
      for (const state of states) {
        const json = await request("/rest/agile/1.0/board/" + boardId + "/sprint?state=" + state);
        values.push(...(json.values || []));
      }
      return values;
    }

    const existing = await allSprints();
    const sprintsByName = new Map(existing.map((sprint) => [sprint.name, sprint]));
    const syncedSprints = [];

    for (const item of syncPlan) {
      let sprint = sprintsByName.get(item.name);
      if (!sprint) {
        sprint = await request("/rest/agile/1.0/sprint", {
          method: "POST",
          body: JSON.stringify({
            name: item.name,
            originBoardId: boardId,
            startDate: item.start,
            endDate: item.end,
            goal: item.goal,
          }),
        });
      } else {
        sprint = await request("/rest/agile/1.0/sprint/" + sprint.id, {
          method: "PUT",
          body: JSON.stringify({
            id: sprint.id,
            self: sprint.self,
            state: sprint.state,
            name: item.name,
            startDate: item.start,
            endDate: item.end,
            originBoardId: boardId,
            goal: item.goal,
          }),
        });
      }

      syncedSprints.push({ id: sprint.id, name: sprint.name, state: sprint.state, issueCount: item.issues.length });

      for (let i = 0; i < item.issues.length; i += 50) {
        const issues = item.issues.slice(i, i + 50);
        await request("/rest/agile/1.0/sprint/" + sprint.id + "/issue", {
          method: "POST",
          body: JSON.stringify({ issues }),
        });
      }
    }

    const backlogMoveResults = [];
    for (let i = 0; i < epicBacklogIssues.length; i += 50) {
      const issues = epicBacklogIssues.slice(i, i + 50);
      try {
        await request("/rest/agile/1.0/backlog/issue", {
          method: "POST",
          body: JSON.stringify({ issues }),
        });
        backlogMoveResults.push({ method: "agile-backlog", issues, ok: true });
      } catch (error) {
        const fallback = [];
        for (const issue of issues) {
          try {
            await request("/rest/api/3/issue/" + issue, {
              method: "PUT",
              body: JSON.stringify({ fields: { customfield_10020: null } }),
            });
            fallback.push({ issue, ok: true });
          } catch (fallbackError) {
            fallback.push({ issue, ok: false, error: String(fallbackError.message || fallbackError) });
          }
        }
        backlogMoveResults.push({
          method: "field-clear-fallback",
          issues,
          ok: fallback.every((item) => item.ok),
          originalError: String(error.message || error),
          fallback,
        });
      }
    }

    async function sprintCounts() {
      const sprints = await allSprints();
      const counts = [];
      for (const sprint of sprints.filter((item) => item.name.startsWith("LCSP Sprint "))) {
        const json = await request("/rest/agile/1.0/sprint/" + sprint.id + "/issue?maxResults=200&fields=issuetype,status,summary");
        const byType = {};
        for (const issue of json.issues || []) {
          const type = issue.fields.issuetype.name;
          byType[type] = (byType[type] || 0) + 1;
        }
        counts.push({ id: sprint.id, name: sprint.name, state: sprint.state, total: json.total, byType });
      }
      counts.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      return counts;
    }

    async function epicSprintState() {
      const states = [];
      for (let i = 0; i < epicBacklogIssues.length; i += 50) {
        const keys = epicBacklogIssues.slice(i, i + 50);
        if (!keys.length) {
          continue;
        }
        const response = await request("/rest/api/3/search/jql", {
          method: "POST",
          body: JSON.stringify({
            jql: "key in (" + keys.join(",") + ") ORDER BY key ASC",
            fields: ["summary", "issuetype", "customfield_10020"],
            maxResults: 50,
          }),
        });
        states.push(...(response.issues || []).map((issue) => ({
          key: issue.key,
          type: issue.fields.issuetype.name,
          sprints: (issue.fields.customfield_10020 || []).map((sprint) => sprint.name || sprint.id),
        })));
      }
      return states;
    }

    return { syncedSprints, backlogMoveResults, counts: await sprintCounts(), epics: await epicSprintState() };
  })()`);

  console.log(JSON.stringify(result, null, 2));
} finally {
  await page.close();
}
