import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const tempRoots: string[] = [];

function makeTempRoot(name: string) {
  const root = mkdtempSync(join(tmpdir(), `pass-along-${name}-`));
  tempRoots.push(root);
  return root;
}

function runScript(scriptPath: string, args: string[] = []) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8"
  });
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("privacy scan", () => {
  const scannerPath = join(repoRoot, "scripts/privacy-scan.mjs");

  test("passes on the clean repository tree", () => {
    const result = runScript(scannerPath);

    expect(result.status).toBe(0);
  });

  test("flags the seeded privacy violation fixture when scanned directly", () => {
    const fixturePath = join(
      repoRoot,
      "scripts/__fixtures__/privacy-violation.ts"
    );
    const result = runScript(scannerPath, [fixturePath]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain("raw query");
  });

  test("flags the fixture when it is copied into a scanned find path", () => {
    const root = makeTempRoot("privacy");
    const findDir = join(root, "apps/web/src/app/api/find");
    const targetPath = join(findDir, "route.ts");
    mkdirSync(findDir, { recursive: true });
    copyFileSync(
      join(repoRoot, "scripts/__fixtures__/privacy-violation.ts"),
      targetPath
    );

    const result = runScript(scannerPath, [root]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain("analytics");
  });
});

describe("migration additivity lint", () => {
  const lintPath = join(repoRoot, "scripts/db-lint.mjs");

  test("passes when no migration SQL files exist yet", () => {
    const result = runScript(lintPath);

    expect(result.status).toBe(0);
  });

  test("accepts additive migration statements", () => {
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

    const result = runScript(lintPath, [migrationDir]);

    expect(result.status).toBe(0);
  });

  test("rejects destructive migration statements", () => {
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

    const result = runScript(lintPath, [migrationDir]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain("DROP TABLE");
    expect(`${result.stdout}\n${result.stderr}`).toContain("ALTER COLUMN TYPE");
  });
});
