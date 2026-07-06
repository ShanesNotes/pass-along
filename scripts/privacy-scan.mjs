import { lstat, readdir, readFile } from "node:fs/promises";
import { basename, extname, join, relative, resolve, sep } from "node:path";

const DEFAULT_IGNORES = new Set([
  ".git",
  ".next",
  "coverage",
  "dist",
  "node_modules"
]);
const SCANNED_EXTENSIONS = new Set([
  ".cjs",
  ".js",
  ".jsx",
  ".mjs",
  ".sql",
  ".ts",
  ".tsx"
]);

const explicitRoots = process.argv.slice(2);
const roots = explicitRoots.length > 0 ? explicitRoots : [process.cwd()];
const explicitRootSet = new Set(explicitRoots.map((root) => resolve(root)));

const rules = [
  {
    name: "console.log raw query",
    reason: "raw query text must never be logged",
    matches(filePath, text) {
      return collectLineMatches(
        filePath,
        text,
        /\bconsole\s*\.\s*log\s*\([^)\n]*(?:raw\s*query|rawQuery|queryText|query)\b[^)\n]*\)/giu
      );
    }
  },
  {
    name: "analytics in find path",
    reason: "find-flow analytics must not receive raw query text",
    matches(filePath, text) {
      const normalized = normalizePath(filePath).toLowerCase();
      if (!isFindPath(normalized)) {
        return [];
      }

      return collectLineMatches(
        filePath,
        text,
        /\b(?:analytics|posthog|segment|mixpanel|gtag|dataLayer)\s*(?:\.|\[|\()/giu
      );
    }
  },
  {
    name: "queries raw-text insert",
    reason: "queries rows may store understood JSON and hash only",
    matches(filePath, text) {
      const matches = [
        ...collectLineMatches(
          filePath,
          text,
          /\binsert\s+into\s+queries\s*\([^)]*(?:raw_text|rawText|query_text|queryText|query)\b/giu
        ),
        ...collectLineMatches(
          filePath,
          text,
          /\bfrom\s*\(\s*["'`]queries["'`]\s*\)\s*\.\s*insert\s*\([^)]*(?:raw_text|rawText|query_text|queryText|query)\b/giu
        )
      ];

      return matches;
    }
  }
];

const files = [];
for (const root of roots) {
  await collectFiles(resolve(root), files);
}

const findings = [];
for (const filePath of files) {
  const text = await readFile(filePath, "utf8");
  for (const rule of rules) {
    for (const match of rule.matches(filePath, text)) {
      findings.push({ ...match, rule: rule.name, reason: rule.reason });
    }
  }
}

if (findings.length > 0) {
  for (const finding of findings) {
    const displayPath = relative(process.cwd(), finding.filePath) || finding.filePath;
    console.error(
      `${displayPath}:${finding.line}: ${finding.rule} - ${finding.reason}`
    );
    console.error(`  ${finding.source.trim()}`);
  }
  process.exit(1);
}

console.log(`privacy:scan passed (${files.length} files scanned)`);

async function collectFiles(root, files) {
  const stats = await lstat(root);
  if (stats.isFile()) {
    if (shouldScanFile(root)) {
      files.push(root);
    }
    return;
  }

  if (!stats.isDirectory()) {
    return;
  }

  const directoryName = basename(root);
  if (DEFAULT_IGNORES.has(directoryName)) {
    return;
  }

  if (
    normalizePath(root).endsWith("/scripts/__fixtures__") &&
    !explicitRootSet.has(root)
  ) {
    return;
  }

  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    await collectFiles(join(root, entry.name), files);
  }
}

function shouldScanFile(filePath) {
  return SCANNED_EXTENSIONS.has(extname(filePath));
}

function collectLineMatches(filePath, text, pattern) {
  const matches = [];
  const lines = text.split(/\r?\n/);

  for (const [index, line] of lines.entries()) {
    pattern.lastIndex = 0;
    if (pattern.test(line)) {
      matches.push({ filePath, line: index + 1, source: line });
    }
  }

  return matches;
}

function normalizePath(filePath) {
  return filePath.split(sep).join("/");
}

function isFindPath(normalizedPath) {
  return (
    normalizedPath.includes("/api/find/") ||
    normalizedPath.endsWith("/api/find.ts") ||
    normalizedPath.endsWith("/api/find/route.ts") ||
    normalizedPath.includes("/find/")
  );
}
