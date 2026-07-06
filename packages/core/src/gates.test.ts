import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const tempRoots: string[] = [];

function makeTempRoot(name: string) {
  const root = mkdtempSync(join(tmpdir(), `pass-along-${name}-`));
  tempRoots.push(root);
  return root;
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
