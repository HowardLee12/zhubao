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

    expect(Object.keys(paths)).toHaveLength(123);
    expect(operations).toHaveLength(164);
    expect(Object.keys(schemas)).toHaveLength(297);
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

    expect(operationIds).toHaveLength(164);
    expect(new Set(operationIds).size).toBe(operationIds.length);
  });

  it("pins the implemented M3 pilot envelopes instead of aspirational full-resource DTOs", () => {
    expect(isRecord(parsedDocument)).toBe(true);
    if (!isRecord(parsedDocument)) return;
    const paths = parsedDocument.paths as JsonRecord;

    function responseRef(path: string, method: string, status: string): unknown {
      const pathItem = paths[path] as JsonRecord;
      const operation = pathItem[method] as JsonRecord;
      const responses = operation.responses as JsonRecord;
      const response = responses[status] as JsonRecord;
      const content = response.content as JsonRecord;
      const media = content["application/json"] as JsonRecord;
      return (media.schema as JsonRecord).$ref;
    }

    function requestRef(path: string, method: string): unknown {
      const pathItem = paths[path] as JsonRecord;
      const operation = pathItem[method] as JsonRecord;
      const requestBody = operation.requestBody as JsonRecord;
      const content = requestBody.content as JsonRecord;
      const media = content["application/json"] as JsonRecord;
      return (media.schema as JsonRecord).$ref;
    }

    expect(responseRef("/organizations/{orgId}/service-requests", "get", "200")).toBe(
      "#/components/schemas/PilotInboxListEnvelope",
    );
    expect(responseRef("/organizations/{orgId}/service-requests/{id}", "get", "200")).toBe(
      "#/components/schemas/PilotServiceRequestDetailEnvelope",
    );
    expect(responseRef("/organizations/{orgId}/service-requests/{id}", "patch", "200")).toBe(
      "#/components/schemas/PilotServiceRequestDetailEnvelope",
    );
    expect(requestRef("/organizations/{orgId}/service-requests/{id}", "patch")).toBe(
      "#/components/schemas/PilotUpdateServiceRequestSummaryRequest",
    );
    for (const action of ["triage", "start-quoting", "mark-quoted", "decline", "cancel"]) {
      expect(
        responseRef(
          `/organizations/{orgId}/service-requests/{id}/actions/${action}`,
          "post",
          "200",
        ),
      ).toBe("#/components/schemas/PilotServiceRequestActionEnvelope");
    }
    expect(
      responseRef(
        "/organizations/{orgId}/service-requests/{id}/actions/convert",
        "post",
        "201",
      ),
    ).toBe("#/components/schemas/PilotConversionEnvelope");
    expect(responseRef("/organizations/{orgId}/customers", "post", "201")).toBe(
      "#/components/schemas/PilotCustomerEnvelope",
    );
    expect(requestRef("/organizations/{orgId}/customers", "post")).toBe(
      "#/components/schemas/PilotCreateCustomerRequest",
    );
    expect(
      responseRef(
        "/organizations/{orgId}/customers/{customerId}/locations",
        "get",
        "200",
      ),
    ).toBe("#/components/schemas/PilotCustomerLocationListEnvelope");
    expect(
      responseRef(
        "/organizations/{orgId}/customers/{customerId}/assets",
        "get",
        "200",
      ),
    ).toBe("#/components/schemas/PilotCustomerAssetListEnvelope");
    expect(
      responseRef(
        "/organizations/{orgId}/service-requests/{id}/events",
        "get",
        "200",
      ),
    ).toBe("#/components/schemas/PilotServiceRequestEventListEnvelope");
    expect(
      responseRef(
        "/organizations/{orgId}/service-requests/{id}/photos",
        "get",
        "200",
      ),
    ).toBe("#/components/schemas/PilotServiceRequestPhotoListEnvelope");

    const markQuotedPath = paths[
      "/organizations/{orgId}/service-requests/{id}/actions/mark-quoted"
    ] as JsonRecord;
    const markQuotedPost = markQuotedPath.post as JsonRecord;
    expect(markQuotedPost).not.toHaveProperty("requestBody");

    const components = parsedDocument.components as JsonRecord;
    const schemas = components.schemas as JsonRecord;
    const convertWorkOrder = schemas.ConvertWorkOrderInput as JsonRecord;
    const convertProperties = convertWorkOrder.properties as JsonRecord;
    expect(convertProperties).not.toHaveProperty("assigneeMembershipIds");
    const preferredWindow = schemas.PreferredTimeWindow as JsonRecord;
    expect(preferredWindow.required).toEqual(["startsAt", "endsAt", "preferenceRank"]);
  });

  it("pins the implemented M4 quote workspace, secure-link and public response contracts", () => {
    expect(isRecord(parsedDocument)).toBe(true);
    if (!isRecord(parsedDocument)) return;
    const paths = parsedDocument.paths as JsonRecord;

    function responseRef(path: string, method: string, status: string): unknown {
      const operation = (paths[path] as JsonRecord)[method] as JsonRecord;
      const response = (operation.responses as JsonRecord)[status] as JsonRecord;
      const media = (response.content as JsonRecord)["application/json"] as JsonRecord;
      return (media.schema as JsonRecord).$ref;
    }

    function requestRef(path: string, method: string): unknown {
      const operation = (paths[path] as JsonRecord)[method] as JsonRecord;
      const content = (operation.requestBody as JsonRecord).content as JsonRecord;
      const media = content["application/json"] as JsonRecord;
      return (media.schema as JsonRecord).$ref;
    }

    expect(responseRef("/organizations/{orgId}/quotes", "post", "201")).toBe(
      "#/components/schemas/PilotQuoteWorkspaceEnvelope",
    );
    expect(requestRef("/organizations/{orgId}/quotes", "post")).toBe(
      "#/components/schemas/CreateQuoteRequest",
    );
    expect(responseRef("/organizations/{orgId}/quotes/{id}", "get", "200")).toBe(
      "#/components/schemas/PilotQuoteWorkspaceEnvelope",
    );
    expect(requestRef("/organizations/{orgId}/quote-versions/{versionId}", "patch")).toBe(
      "#/components/schemas/QuoteVersionInput",
    );
    expect(
      responseRef("/organizations/{orgId}/quote-versions/{versionId}", "patch", "200"),
    ).toBe("#/components/schemas/PilotQuoteWorkspaceEnvelope");
    expect(responseRef("/organizations/{orgId}/quotes/{id}/versions", "post", "201")).toBe(
      "#/components/schemas/PilotQuoteWorkspaceEnvelope",
    );
    expect(responseRef("/organizations/{orgId}/quotes/{id}/actions/send", "post", "200")).toBe(
      "#/components/schemas/PilotQuoteLinkEnvelope",
    );
    expect(
      responseRef(
        "/organizations/{orgId}/quotes/{id}/actions/rotate-public-link",
        "post",
        "200",
      ),
    ).toBe("#/components/schemas/PilotQuoteLinkEnvelope");
    expect(
      responseRef("/organizations/{orgId}/service-requests/{id}/quote", "get", "200"),
    ).toBe("#/components/schemas/PilotQuoteWorkspaceEnvelope");
    expect(responseRef("/public/quotes/current", "get", "200")).toBe(
      "#/components/schemas/PublicQuoteEnvelope",
    );
    expect(requestRef("/public/quotes/current/responses", "post")).toBe(
      "#/components/schemas/PublicQuoteResponseRequest",
    );
  });
});
