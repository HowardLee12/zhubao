import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type JsonRecord = Record<string, unknown>;

const HTTP_METHODS = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
] as const;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectLocalReferences(value: unknown, references: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectLocalReferences(item, references);
    return references;
  }

  if (!isRecord(value)) return references;
  if (typeof value.$ref === "string") references.push(value.$ref);
  for (const child of Object.values(value)) collectLocalReferences(child, references);
  return references;
}

function resolveLocalReference(document: JsonRecord, reference: string): unknown {
  if (!reference.startsWith("#/")) return undefined;

  return reference
    .slice(2)
    .split("/")
    .map((segment) => decodeURIComponent(segment.replaceAll("~1", "/").replaceAll("~0", "~")))
    .reduce<unknown>((current, segment) => {
      if (!isRecord(current) || !Object.hasOwn(current, segment)) return undefined;
      return current[segment];
    }, document);
}

const documentPath = resolve(process.cwd(), "docs/openapi.yaml");
const parsedDocument: unknown = parse(readFileSync(documentPath, "utf8"), {
  maxAliasCount: -1,
});

describe("OpenAPI contract", () => {
  it("parses as the published OpenAPI 3.1 inventory", () => {
    expect(isRecord(parsedDocument)).toBe(true);
    if (!isRecord(parsedDocument)) return;

    expect(parsedDocument.openapi).toBe("3.1.0");

    const paths = isRecord(parsedDocument.paths) ? parsedDocument.paths : {};
    const components = isRecord(parsedDocument.components) ? parsedDocument.components : {};
    const schemas = isRecord(components.schemas) ? components.schemas : {};
    const operations = Object.values(paths).flatMap((pathItem) => {
      if (!isRecord(pathItem)) return [];
      return HTTP_METHODS.flatMap((method) => {
        const operation = pathItem[method];
        return isRecord(operation) ? [operation] : [];
      });
    });

    expect(Object.keys(paths)).toHaveLength(117);
    expect(operations).toHaveLength(158);
    expect(Object.keys(schemas)).toHaveLength(256);
  });

  it("keeps every internal reference resolvable", () => {
    expect(isRecord(parsedDocument)).toBe(true);
    if (!isRecord(parsedDocument)) return;

    const references = collectLocalReferences(parsedDocument);
    expect(references.length).toBeGreaterThan(0);
    for (const reference of references) {
      expect(reference, `external or invalid reference: ${reference}`).toMatch(/^#\//);
      expect(resolveLocalReference(parsedDocument, reference), `missing reference: ${reference}`).toBeDefined();
    }
  });

  it("uses a unique operationId for every operation", () => {
    expect(isRecord(parsedDocument)).toBe(true);
    if (!isRecord(parsedDocument)) return;

    const paths = isRecord(parsedDocument.paths) ? parsedDocument.paths : {};
    const operationIds = Object.values(paths).flatMap((pathItem) => {
      if (!isRecord(pathItem)) return [];
      return HTTP_METHODS.flatMap((method) => {
        const operation = pathItem[method];
        if (!isRecord(operation) || typeof operation.operationId !== "string") return [];
        return [operation.operationId];
      });
    });

    expect(operationIds).toHaveLength(158);
    expect(new Set(operationIds).size).toBe(operationIds.length);
  });
});
