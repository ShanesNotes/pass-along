import { lstat, readdir, readFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";

const roots = process.argv.slice(2);
const scanRoots =
  roots.length > 0 ? roots.map((root) => resolve(root)) : [resolve("supabase/migrations")];

const rules = [
  {
    name: "DROP TABLE",
    reason: "migrations are additive-only; do not drop tables",
    pattern: /\bdrop\s+table\b/giu
  },
  {
    name: "DROP COLUMN",
    reason: "migrations are additive-only; do not drop columns",
    pattern: /\balter\s+table\b[^;]*\bdrop\s+column\b/giu
  },
  {
    name: "RENAME",
    reason: "migrations are additive-only; do not rename objects in place",
    pattern: /\brename\s+(?:column|to|table|constraint|index)\b/giu
  },
  {
    name: "ALTER COLUMN TYPE",
    reason: "migrations are additive-only; do not alter column types in place",
    pattern: /\balter\s+table\b[^;]*\balter\s+column\b[^;]*\btype\b/giu
  }
];

const files = [];
for (const root of scanRoots) {
  await collectSqlFiles(root, files);
}

const findings = [];
for (const filePath of files) {
  const text = await readFile(filePath, "utf8");
  const searchable = stripSqlComments(text);

  for (const rule of rules) {
    for (const match of collectPatternMatches(filePath, searchable, rule.pattern)) {
      findings.push({ ...match, rule: rule.name, reason: rule.reason });
    }
  }
}

if (findings.length > 0) {
  for (const finding of findings) {
    const displayPath = relative(process.cwd(), finding.filePath) || finding.filePath;
    console.error(`${displayPath}:${finding.line}: ${finding.rule} - ${finding.reason}`);
    console.error(`  ${finding.source.trim()}`);
  }
  process.exit(1);
}

console.log(`db:lint passed (${files.length} migration SQL files scanned)`);

async function collectSqlFiles(root, files) {
  let stats;
  try {
    stats = await lstat(root);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return;
    }
    throw error;
  }

  if (stats.isFile()) {
    if (extname(root) === ".sql") {
      files.push(root);
    }
    return;
  }

  if (!stats.isDirectory()) {
    return;
  }

  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    await collectSqlFiles(join(root, entry.name), files);
  }
}

function collectPatternMatches(filePath, text, pattern) {
  const matches = [];
  const lines = text.split(/\r?\n/);
  let match;

  pattern.lastIndex = 0;
  while ((match = pattern.exec(text)) !== null) {
    const line = lineNumberAt(text, match.index);
    matches.push({ filePath, line, source: lines[line - 1] ?? "" });
  }

  return matches;
}

function stripSqlComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//gu, (match) => "\n".repeat(match.split(/\r?\n/).length - 1))
    .replace(/--.*$/gmu, "");
}

function lineNumberAt(text, index) {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (text.charCodeAt(cursor) === 10) {
      line += 1;
    }
  }
  return line;
}
