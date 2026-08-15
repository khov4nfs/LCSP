import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirPath = dirname(currentFilePath);
const templateDirPaths = [
  resolve(currentDirPath, "templates"),
  resolve(currentDirPath, "../../../platform/mail/templates"),
];

const templateCache = new Map<string, string>();

/**
 * Renders an HTML mail template by replacing escaped `{{variable}}` placeholders.
 *
 * @param templateName - File name of the mail template to render.
 * @param variables - Placeholder values keyed by template variable name.
 * @returns Rendered template HTML with all supplied values HTML-escaped.
 */
export function renderMailTemplate(
  templateName: string,
  variables: Record<string, string>,
): string {
  const template = getTemplate(templateName);
  return Object.entries(variables).reduce(
    (output, [key, value]) =>
      output.replaceAll(`{{${key}}}`, escapeHtml(value)),
    template,
  );
}

/**
 * Loads a template from disk once and reuses the cached content for later renders.
 *
 * @param templateName - File name of the template to load.
 * @returns Raw template content.
 */
function getTemplate(templateName: string): string {
  const cached = templateCache.get(templateName);
  if (cached) {
    return cached;
  }

  const templatePath = resolveTemplatePath(templateName);
  const template = readFileSync(templatePath, "utf8");
  templateCache.set(templateName, template);
  return template;
}

/**
 * Resolves a mail template against the supported runtime template directories.
 *
 * @param templateName - File name of the template to resolve.
 * @returns Absolute path to the first existing template, or the primary expected path.
 */
function resolveTemplatePath(templateName: string): string {
  for (const templateDirPath of templateDirPaths) {
    const templatePath = resolve(templateDirPath, templateName);
    if (existsSync(templatePath)) {
      return templatePath;
    }
  }

  return resolve(templateDirPaths[0], templateName);
}

/**
 * Escapes characters that could be interpreted as HTML before inserting user-controlled text.
 *
 * @param value - Plain-text value to escape.
 * @returns HTML-safe representation of the supplied value.
 */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
