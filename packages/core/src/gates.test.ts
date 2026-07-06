import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const tempRoots: string[] = [];
const scannerIgnoreDirectories = new Set([
  ".git",
  ".next",
  "coverage",
  "dist",
  "node_modules"
]);
const scannerExtensions = new Set([
  ".cjs",
  ".js",
  ".jsx",
  ".mjs",
  ".sql",
  ".ts",
  ".tsx"
]);

function makeTempRoot(name: string) {
  const root = mkdtempSync(join(tmpdir(), `pass-along-${name}-`));
  tempRoots.push(root);
  return root;
}

function findLargestScannedFile(root: string): string {
  let largestFile = "";
  let largestSize = -1;

  for (const filePath of listScannedFiles(root)) {
    const size = statSync(filePath).size;

    if (size > largestSize) {
      largestFile = filePath;
      largestSize = size;
    }
  }

  if (!largestFile) {
    throw new Error("no scanned files found");
  }

  return largestFile;
}

function listScannedFiles(root: string): string[] {
  const stats = statSync(root);

  if (stats.isFile()) {
    return scannerExtensions.has(extname(root)) ? [root] : [];
  }

  if (!stats.isDirectory()) {
    return [];
  }

  if (scannerIgnoreDirectories.has(basename(root))) {
    return [];
  }

  if (normalizePath(root).endsWith("/scripts/__fixtures__")) {
    return [];
  }

  return readdirSync(root, { withFileTypes: true }).flatMap((entry) =>
    listScannedFiles(join(root, entry.name))
  );
}

function normalizePath(filePath: string): string {
  return filePath.split(sep).join("/");
}

type ScriptResult = {
  status: number;
  stdout: string;
  stderr: string;
};

class ScriptExit extends Error {
  readonly status: number;

  constructor(code: string | number | null | undefined) {
    super("script called process.exit");
    this.status = typeof code === "number" ? code : 0;
  }
}

let scriptRunId = 0;

async function runScript(
  scriptPath: string,
  args: string[] = []
): Promise<ScriptResult> {
  const originalArgv = process.argv;
  const originalExit = process.exit;
  const originalLog = console.log;
  const originalError = console.error;
  const stdout: string[] = [];
  const stderr: string[] = [];

  process.argv = [process.execPath, scriptPath, ...args];
  process.exit = ((code?: string | number | null | undefined): never => {
    throw new ScriptExit(code);
  }) as typeof process.exit;
  console.log = (...values: unknown[]) => {
    stdout.push(values.map(String).join(" "));
  };
  console.error = (...values: unknown[]) => {
    stderr.push(values.map(String).join(" "));
  };

  try {
    scriptRunId += 1;
    await import(`${pathToFileURL(scriptPath).href}?run=${scriptRunId}`);
    return { status: 0, stdout: stdout.join("\n"), stderr: stderr.join("\n") };
  } catch (error) {
    if (error instanceof ScriptExit) {
      return {
        status: error.status,
        stdout: stdout.join("\n"),
        stderr: stderr.join("\n")
      };
    }

    return {
      status: 1,
      stdout: stdout.join("\n"),
      stderr: `${stderr.join("\n")}\n${String(error)}`
    };
  } finally {
    process.argv = originalArgv;
    process.exit = originalExit;
    console.log = originalLog;
    console.error = originalError;
  }
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("privacy scan", () => {
  const scannerPath = join(repoRoot, "scripts/privacy-scan.mjs");

  test("passes on the clean repository tree", async () => {
    const result = await runScript(scannerPath);

    expect(result.status).toBe(0);
  });

  test("flags the seeded privacy violation fixture when scanned directly", async () => {
    const fixturePath = join(
      repoRoot,
      "scripts/__fixtures__/privacy-violation.ts"
    );
    const result = await runScript(scannerPath, [fixturePath]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain("raw query");
  });

  test("flags the fixture when it is copied into a scanned find path", async () => {
    const root = makeTempRoot("privacy");
    const findDir = join(root, "apps/web/src/app/api/find");
    const targetPath = join(findDir, "route.ts");
    mkdirSync(findDir, { recursive: true });
    copyFileSync(
      join(repoRoot, "scripts/__fixtures__/privacy-violation.ts"),
      targetPath
    );

    const result = await runScript(scannerPath, [root]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain("analytics");
  });

  test("flags multi-line raw query logging", async () => {
    const root = makeTempRoot("privacy-multiline-log");
    const targetPath = join(root, "x.ts");
    const logCall = ["  console.", "log("].join("");
    writeFileSync(
      targetPath,
      [
        "export function h(rawQuery: string) {",
        logCall,
        '    "q",',
        "    rawQuery",
        "  );",
        "}"
      ].join("\n")
    );

    const result = await runScript(scannerPath, [targetPath]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain("raw query");
  });

  test("flags multi-line raw text inserts into queries", async () => {
    const root = makeTempRoot("privacy-multiline-insert");
    const targetPath = join(root, "x.sql");
    const tableName = ["quer", "ies"].join("");
    const rawTextColumn = ["raw", "_text"].join("");
    writeFileSync(
      targetPath,
      [
        `insert into ${tableName} (`,
        "  query_hash,",
        "  understood,",
        `  ${rawTextColumn}`,
        ") values (",
        "  'hash',",
        "  '{}'::jsonb,",
        "  'raw'",
        ");"
      ].join("\n")
    );

    const result = await runScript(scannerPath, [targetPath]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain("queries rows");
  });

  test("scans the largest repository file without regex blowups", async () => {
    const largestFile = findLargestScannedFile(repoRoot);
    const start = performance.now();
    const result = await runScript(scannerPath, [largestFile]);

    expect(result.status).toBe(0);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});

describe("migration additivity lint", () => {
  const lintPath = join(repoRoot, "scripts/db-lint.mjs");

  test("passes on repository migrations", async () => {
    const result = await runScript(lintPath);

    expect(result.status).toBe(0);
  });

  test("accepts additive migration statements", async () => {
    const root = makeTempRoot("db-ok");
    const migrationDir = join(root, "migrations");
    mkdirSync(migrationDir, { recursive: true });
    writeFileSync(
      join(migrationDir, "0001_additive.sql"),
      [
        "create table providers (id uuid primary key);",
        "alter table providers add column name text;",
        "create index providers_name_idx on providers (name);"
      ].join("\n")
    );

    const result = await runScript(lintPath, [migrationDir]);

    expect(result.status).toBe(0);
  });

  test("rejects destructive migration statements", async () => {
    const root = makeTempRoot("db-bad");
    const migrationDir = join(root, "migrations");
    mkdirSync(migrationDir, { recursive: true });
    writeFileSync(
      join(migrationDir, "0002_destructive.sql"),
      [
        "drop table providers;",
        "alter table recommendations drop column story;",
        "alter table recommendations rename column body to scrubbed_story;",
        "alter table recommendations alter column score type numeric;",
        "alter table providers",
        "  drop column legacy_name;"
      ].join("\n")
    );

    const result = await runScript(lintPath, [migrationDir]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain("DROP TABLE");
    expect(`${result.stdout}\n${result.stderr}`).toContain("ALTER COLUMN TYPE");
  });
});
