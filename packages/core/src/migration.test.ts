import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../../..");

describe("initial migration privacy contract", () => {
  test("queries stores query_hash and understood only", () => {
    const sql = readFileSync(
      resolve(repoRoot, "supabase/migrations/0001_init.sql"),
      "utf8"
    );
    const queriesColumns = extractCreateTableColumns(sql, "queries");

    expect(queriesColumns).toEqual(["query_hash", "understood"]);
    expect(queriesColumns).not.toContain("raw_text");
    expect(queriesColumns).not.toContain("raw_query");
    expect(queriesColumns).not.toContain("query_text");
  });

  test("raw recommendation stories are isolated from anon-readable recommendations", () => {
    const sql = readFileSync(
      resolve(repoRoot, "supabase/migrations/0001_init.sql"),
      "utf8"
    );
    const recommendationColumns = extractCreateTableColumns(sql, "recommendations");

    expect(
      recommendationColumns.filter((column) => /original|raw/iu.test(column))
    ).toEqual([]);

    expect(extractCreateTableColumns(sql, "recommendation_originals")).toEqual(
      expect.arrayContaining(["recommendation_id", "original_story"])
    );
    expect(hasRowLevelSecurityEnabled(sql, "recommendation_originals")).toBe(true);
    expect(extractAnonPolicies(sql, "recommendation_originals")).toEqual([]);
  });
});

function extractCreateTableColumns(sql: string, tableName: string): string[] {
  const searchable = stripSqlComments(sql);
  const match = new RegExp(
    `create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?(?:public\\.)?${tableName}\\s*\\(`,
    "iu"
  ).exec(searchable);

  if (!match) {
    throw new Error(`create table statement not found for ${tableName}`);
  }

  const openParenIndex = match.index + match[0].lastIndexOf("(");
  const closeParenIndex = findMatchingParen(searchable, openParenIndex);
  const tableBody = searchable.slice(openParenIndex + 1, closeParenIndex);

  return splitTopLevelCommas(tableBody)
    .map((definition) => definition.trim())
    .filter((definition) => definition.length > 0)
    .filter((definition) => !/^(constraint|primary|foreign|unique|check)\b/iu.test(definition))
    .map((definition) => {
      const columnName = /^"([^"]+)"|^([a-z_][a-z0-9_]*)/iu.exec(definition);

      if (!columnName) {
        throw new Error(`unable to parse column definition: ${definition}`);
      }

      return columnName[1] ?? columnName[2] ?? "";
    });
}

function findMatchingParen(text: string, openParenIndex: number): number {
  let depth = 0;

  for (let index = openParenIndex; index < text.length; index += 1) {
    const character = text[index];

    if (character === "(") {
      depth += 1;
    }

    if (character === ")") {
      depth -= 1;
    }

    if (depth === 0) {
      return index;
    }
  }

  throw new Error("unterminated create table statement");
}

function splitTopLevelCommas(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (character === "(") {
      depth += 1;
    }

    if (character === ")") {
      depth -= 1;
    }

    if (character === "," && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }

  parts.push(text.slice(start));
  return parts;
}

function stripSqlComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//gu, (match) =>
      "\n".repeat(match.split(/\r?\n/).length - 1)
    )
    .replace(/--.*$/gmu, "");
}

function hasRowLevelSecurityEnabled(sql: string, tableName: string): boolean {
  const searchable = stripSqlComments(sql);
  return new RegExp(
    `alter\\s+table\\s+(?:public\\.)?${tableName}\\s+enable\\s+row\\s+level\\s+security\\s*;`,
    "iu"
  ).test(searchable);
}

function extractAnonPolicies(sql: string, tableName: string): string[] {
  const searchable = stripSqlComments(sql);
  const policies: string[] = [];

  for (const match of searchable.matchAll(/\bcreate\s+policy\b[\s\S]*?;/giu)) {
    const statement = match[0];
    const isTablePolicy = new RegExp(
      `\\bon\\s+(?:public\\.)?${tableName}\\b`,
      "iu"
    ).test(statement);

    if (isTablePolicy && /\bto\s+anon\b/iu.test(statement)) {
      policies.push(statement);
    }
  }

  return policies;
}
