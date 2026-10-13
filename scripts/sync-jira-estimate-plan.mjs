#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { findAllowedJiraPage } from "./jira-page-url.mjs";

const ROOT = process.cwd();
const DEV_DIR = path.join(ROOT, "docs", "developer");
const CDP_BASE = process.env.CDP_BASE_URL || "http://127.0.0.1:9222";

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

const rows = parseCsv(
  fs.readFileSync(path.join(DEV_DIR, "jira-lcsp-estimate-plan.csv"), "utf8"),
);

const page = await getAtlassianPage();
try {
  const result = await page.evaluate(`(async () => {
    const rows = ${JSON.stringify(rows)};
    const successes = [];
    const failures = [];

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

    for (const row of rows) {
      const fields = {
        customfield_10015: row["Start Date"],
        duedate: row["Due Date"],
        customfield_10016: Number(row["Story Points"]),
        priority: { name: row.Priority },
      };
      try {
        await request("/rest/api/3/issue/" + row["Jira Key"], {
          method: "PUT",
          body: JSON.stringify({ fields }),
        });
        successes.push(row["Jira Key"]);
      } catch (error) {
        failures.push({ key: row["Jira Key"], error: String(error.message || error) });
      }
    }

    const sampleKeys = rows.slice(0, 5).map((row) => row["Jira Key"]);
    const sample = [];
    for (const key of sampleKeys) {
      const issue = await request(
        "/rest/api/3/issue/" + key + "?fields=summary,customfield_10015,duedate,customfield_10016,priority",
      );
      sample.push({
        key,
        summary: issue.fields.summary,
        startDate: issue.fields.customfield_10015,
        dueDate: issue.fields.duedate,
        points: issue.fields.customfield_10016,
        priority: issue.fields.priority?.name,
      });
    }

    return { updated: successes.length, failed: failures.length, failures: failures.slice(0, 20), sample };
  })()`);

  console.log(JSON.stringify(result, null, 2));
} finally {
  await page.close();
}
