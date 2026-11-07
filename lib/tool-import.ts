import { load as loadYaml } from "js-yaml";
import { parseToolConfiguration, type ToolConfigurationInput } from "./tool-definition.ts";
import { inspectMcpSchema } from "./validators.ts";
import type { MockScenario } from "./scenarios.ts";

export type ToolImportFormat = "openapi" | "function_tools" | "mcp_tools" | "har";

export interface ImportedTool {
  name: string;
  description: string;
  jsonSchema: Record<string, unknown>;
  mockResponse: Record<string, unknown>;
  scenarios: MockScenario[];
}

const MAX_IMPORT_BYTES = 256 * 1024;
const MAX_IMPORTED_TOOLS = 50;
const MAX_HAR_ENTRIES = 200;
const MAX_HAR_RESPONSE_BYTES = 64 * 1024;
const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "options", "head"]);
const SENSITIVE_FIELD = /authorization|cookie|password|secret|token|api[-_]?key|client[-_]?secret|access[-_]?key|session/i;
const SENSITIVE_VALUE = /\b(?:bearer\s+\S+|(?:ma_live|sk|pk|ghp|gho|github_pat|xox[baprs])[_-][A-Za-z0-9_-]{12,}|AIza[0-9A-Za-z_-]{20,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/gi;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSource(format: ToolImportFormat, source: string): unknown {
  if (typeof source !== "string") {
    throw new Error("Paste the tool definition as text.");
  }
  if (new TextEncoder().encode(source).byteLength > MAX_IMPORT_BYTES) {
    throw new Error("Import text must be 256 KiB or smaller.");
  }
  try {
    if (format === "openapi") {
      return loadYaml(source);
    }
    return JSON.parse(source);
  } catch (error) {
    throw new Error(
      error instanceof Error ? `Could not parse import: ${error.message}` : "Could not parse import."
    );
  }
}

function resolveLocalRefs(value: unknown, document: unknown, seen = new Set<string>(), depth = 0): unknown {
  if (depth > 20) throw new Error("OpenAPI schema references exceed the maximum depth.");
  if (Array.isArray(value)) {
    return value.map((item) => resolveLocalRefs(item, document, seen, depth + 1));
  }
  if (!isRecord(value)) return value;

  if (typeof value.$ref === "string") {
    const ref = value.$ref;
    if (!ref.startsWith("#/")) {
      throw new Error("External OpenAPI $ref values are not supported. Paste a self-contained specification.");
    }
    if (seen.has(ref)) throw new Error("Circular OpenAPI $ref values cannot be imported.");
    const pointer = ref.slice(2).split("/").map((part) =>
      part.replace(/~1/g, "/").replace(/~0/g, "~")
    );
    let target: unknown = document;
    for (const part of pointer) {
      if (!isRecord(target) || !(part in target)) {
        throw new Error(`OpenAPI reference "${ref}" does not resolve within the pasted document.`);
      }
      target = target[part];
    }
    const nextSeen = new Set(seen);
    nextSeen.add(ref);
    const resolved = resolveLocalRefs(target, document, nextSeen, depth + 1);
    const siblings = Object.fromEntries(
      Object.entries(value).filter(([key]) => key !== "$ref")
    );
    return Object.keys(siblings).length
      ? { allOf: [resolved, resolveLocalRefs(siblings, document, seen, depth + 1)] }
      : resolved;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      resolveLocalRefs(child, document, seen, depth + 1),
    ])
  );
}

function exampleFromSchema(value: unknown, depth = 0): unknown {
  if (depth > 12 || !isRecord(value)) return {};
  if ("example" in value) return value.example;
  if ("default" in value) return value.default;
  if (Array.isArray(value.enum) && value.enum.length) return value.enum[0];
  if (value.type === "object" || isRecord(value.properties)) {
    const properties = isRecord(value.properties) ? value.properties : {};
    return Object.fromEntries(
      Object.entries(properties).map(([key, child]) => [key, exampleFromSchema(child, depth + 1)])
    );
  }
  if (value.type === "array") {
    return [exampleFromSchema(value.items, depth + 1)];
  }
  if (value.type === "string") return "example";
  if (value.type === "integer" || value.type === "number") return 1;
  if (value.type === "boolean") return false;
  return null;
}

function responseExample(response: unknown, document: unknown): Record<string, unknown> {
  const resolved = resolveLocalRefs(response, document);
  if (!isRecord(resolved)) return {};
  const content = isRecord(resolved.content) ? resolved.content : {};
  const jsonContent = isRecord(content["application/json"])
    ? content["application/json"]
    : Object.values(content).find(isRecord);
  if (!isRecord(jsonContent)) return {};
  if ("example" in jsonContent) {
    return isRecord(jsonContent.example) ? jsonContent.example : { result: jsonContent.example };
  }
  if (isRecord(jsonContent.examples)) {
    const example = Object.values(jsonContent.examples).find(isRecord);
    if (example && "value" in example) {
      return isRecord(example.value) ? example.value : { result: example.value };
    }
  }
  const schema = resolveLocalRefs(jsonContent.schema, document);
  const generated = exampleFromSchema(schema);
  return isRecord(generated) ? generated : { result: generated };
}

function scrubCapturedValue(value: unknown, depth = 0): unknown {
  if (depth > 20) throw new Error("HAR data exceeds the maximum nesting depth.");
  if (Array.isArray(value)) {
    return value.map((item) => scrubCapturedValue(item, depth + 1));
  }
  if (!isRecord(value)) {
    return typeof value === "string" ? value.replace(SENSITIVE_VALUE, "[REDACTED]") : value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !SENSITIVE_FIELD.test(key))
      .map(([key, child]) => [key, scrubCapturedValue(child, depth + 1)])
  );
}

function inferCapturedSchema(values: unknown[], depth = 0): Record<string, unknown> {
  if (depth > 20) throw new Error("HAR request data exceeds the maximum schema depth.");
  const definedValues = values.filter((value) => value !== undefined && value !== null);
  if (definedValues.length === 0) return {};
  const types = new Set(definedValues.map((value) => {
    if (Array.isArray(value)) return "array";
    if (isRecord(value)) return "object";
    if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
    return typeof value;
  }));
  if (types.size > 1) {
    return { anyOf: [...types].map((type) =>
      inferCapturedSchema(definedValues.filter((value) => {
        const valueType = Array.isArray(value) ? "array"
          : isRecord(value) ? "object"
            : typeof value === "number" && Number.isInteger(value) ? "integer"
              : typeof value;
        return valueType === type;
      }), depth + 1)
    ) };
  }
  const type = [...types][0];
  if (type === "object") {
    const records = definedValues.filter(isRecord);
    const keys = [...new Set(records.flatMap((record) => Object.keys(record)))];
    const properties = Object.fromEntries(keys.map((key) => [
      key,
      inferCapturedSchema(records.map((record) => record[key]), depth + 1),
    ]));
    const required = keys.filter((key) => records.every((record) => key in record));
    return {
      type: "object",
      properties,
      ...(required.length ? { required } : {}),
      additionalProperties: false,
    };
  }
  if (type === "array") {
    const items = definedValues.filter(Array.isArray).flat();
    return { type: "array", items: inferCapturedSchema(items, depth + 1) };
  }
  return { type };
}

function capturedMatchSchema(value: unknown): Record<string, unknown> {
  if (Array.isArray(value) || !isRecord(value)) return { const: value };
  const properties = Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, capturedMatchSchema(child)])
  );
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

function parseHarJson(text: unknown, label: string): unknown {
  if (typeof text !== "string" || !text.trim()) {
    throw new Error(`HAR ${label} must contain a JSON body.`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`HAR ${label} is not valid JSON.`);
  }
}

function isDynamicPathSegment(segment: string, previousSegment?: string): boolean {
  const reservedPathName = /^(search|list|create|update|delete|status|health|me|self|current)$/i;
  return /^\d+$/.test(segment) ||
    /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment) ||
    (segment.length >= 24 && /[0-9]/.test(segment) && /[a-z]/i.test(segment)) ||
    /[@]/.test(segment) ||
    (Boolean(previousSegment && /(?:s|ies)$/i.test(previousSegment)) && !reservedPathName.test(segment));
}

function harTools(document: unknown): ImportedTool[] {
  const log = isRecord(document) && isRecord(document.log) ? document.log : null;
  if (!log || !Array.isArray(log.entries)) {
    throw new Error("HAR import must contain a log.entries array.");
  }
  if (log.entries.length > MAX_HAR_ENTRIES) {
    throw new Error(`A HAR import may contain at most ${MAX_HAR_ENTRIES} entries.`);
  }

  const groups = new Map<string, {
    method: string;
    path: string;
    samples: Array<{ args: Record<string, unknown>; response: Record<string, unknown> }>;
  }>();
  for (const [index, rawEntry] of log.entries.entries()) {
    if (!isRecord(rawEntry) || !isRecord(rawEntry.request) || !isRecord(rawEntry.response)) continue;
    const request = rawEntry.request;
    const response = rawEntry.response;
    if (typeof request.method !== "string" || typeof request.url !== "string") continue;
    const method = request.method.toLowerCase();
    if (!HTTP_METHODS.has(method)) continue;

    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      continue;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;

    const originalSegments = url.pathname.split("/").filter(Boolean);
    const pathSegments: string[] = [];
    const pathArgs: Record<string, unknown> = {};
    for (const [segmentIndex, segment] of originalSegments.entries()) {
      if (isDynamicPathSegment(segment, originalSegments[segmentIndex - 1])) {
        const key = `param${Object.keys(pathArgs).length + 1}`;
        pathSegments.push(`{${key}}`);
        pathArgs[key] = segment;
      } else {
        pathSegments.push(segment);
      }
    }
    const path = `/${pathSegments.join("/")}` || "/";

    const query: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const [key, value] of url.searchParams.entries()) {
      if (SENSITIVE_FIELD.test(key)) continue;
      if (!Object.hasOwn(query, key)) query[key] = value;
    }
    const requestBody = isRecord(request.postData) ? request.postData : null;
    const mimeType = typeof requestBody?.mimeType === "string"
      ? requestBody.mimeType.toLowerCase()
      : "";
    let body: unknown;
    if (requestBody && mimeType.includes("json") && typeof requestBody.text === "string") {
      try {
        body = JSON.parse(requestBody.text);
      } catch {
        continue;
      }
    } else if (requestBody && Array.isArray(requestBody.params)) {
      const form: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      for (const parameter of requestBody.params) {
        if (
          isRecord(parameter) &&
          typeof parameter.name === "string" &&
          typeof parameter.value === "string" &&
          !SENSITIVE_FIELD.test(parameter.name)
        ) {
          form[parameter.name] = parameter.value;
        }
      }
      if (Object.keys(form).length) body = form;
    } else if (requestBody && typeof requestBody.text === "string" && requestBody.text.trim()) {
      continue;
    }
    const args = scrubCapturedValue({
      ...(Object.keys(pathArgs).length ? { path: pathArgs } : {}),
      ...(Object.keys(query).length ? { query } : {}),
      ...(body === undefined ? {} : { body }),
    }) as Record<string, unknown>;

    const content = isRecord(response.content) ? response.content : null;
    const responseText = typeof content?.text === "string" ? content.text : "";
    let responseValue: unknown;
    try {
      responseValue = parseHarJson(responseText, `response ${index + 1}`);
    } catch {
      continue;
    }
    let sanitizedResponse: unknown;
    try {
      sanitizedResponse = scrubCapturedValue(responseValue);
    } catch {
      continue;
    }
    const serializedResponse = JSON.stringify(sanitizedResponse);
    if (new TextEncoder().encode(serializedResponse).byteLength > MAX_HAR_RESPONSE_BYTES) continue;
    const responseObject = isRecord(sanitizedResponse)
      ? sanitizedResponse
      : { result: sanitizedResponse };
    const key = `${method}:${path}`;
    const group = groups.get(key) ?? { method, path, samples: [] };
    group.samples.push({ args, response: responseObject });
    groups.set(key, group);
  }

  if (!groups.size) {
    throw new Error("No suitable JSON HTTP request/response pairs were found in this HAR capture.");
  }
  if (groups.size > MAX_IMPORTED_TOOLS) {
    throw new Error(`A HAR import may create at most ${MAX_IMPORTED_TOOLS} tools.`);
  }

  const usedNames = new Set<string>();
  return [...groups.values()].map((group) => {
    const rawName = `${group.method}_${group.path}`;
    const baseName = rawName
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 90) || "captured_request";
    let name = baseName;
    let suffix = 2;
    while (usedNames.has(name)) {
      name = `${baseName.slice(0, 90 - String(suffix).length - 1)}_${suffix}`;
      suffix += 1;
    }
    usedNames.add(name);
    const sampleArgs = group.samples.map((sample) => sample.args);
    const properties = Object.fromEntries(
      [...new Set(sampleArgs.flatMap((args) => Object.keys(args)))].map((key) => [
        key,
        inferCapturedSchema(sampleArgs.map((args) => args[key])),
      ])
    );
    const scenariosByArguments = new Map<string, MockScenario>();
    for (const sample of group.samples) {
      const signature = JSON.stringify(sample.args);
      const existing = scenariosByArguments.get(signature);
      if (existing) {
        const responses = existing.responses ?? (existing.response ? [existing.response] : []);
        if (responses.length < 20) responses.push(sample.response);
        scenariosByArguments.set(signature, { name: existing.name, match: existing.match, responses });
        continue;
      }
      scenariosByArguments.set(signature, {
        name: `Captured case ${scenariosByArguments.size + 1}`,
        match: capturedMatchSchema(sample.args),
        response: sample.response,
      });
    }
    const scenarios = [...scenariosByArguments.values()];
    const configuration: ToolConfigurationInput = {
      name,
      description: `Captured ${group.method.toUpperCase()} ${group.path}. Captured credentials and sensitive-name fields are omitted or redacted.`,
      jsonSchema: JSON.stringify({
        type: "object",
        properties,
        additionalProperties: false,
      }),
      mockResponse: JSON.stringify(group.samples[0].response),
      scenarios: JSON.stringify(scenarios),
      finalAnswerAssertions: "[]",
      semanticCriteria: "",
    };
    const parsed = parseToolConfiguration(configuration);
    return {
      name: parsed.name,
      description: parsed.description ?? "",
      jsonSchema: parsed.json_schema as Record<string, unknown>,
      mockResponse: parsed.mock_response as Record<string, unknown>,
      scenarios: parsed.scenarios as unknown as MockScenario[],
    };
  });
}

function operationToolName(operation: Record<string, unknown>, method: string, path: string): string {
  const rawName = typeof operation.operationId === "string"
    ? operation.operationId
    : `${method}_${path}`;
  const name = rawName.trim().replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  if (!name) throw new Error(`Could not derive a tool name for ${method.toUpperCase()} ${path}.`);
  return name.slice(0, 100);
}

function openApiTools(document: unknown): ImportedTool[] {
  if (!isRecord(document) || !isRecord(document.paths)) {
    throw new Error("OpenAPI import must contain a paths object.");
  }
  const output: ImportedTool[] = [];
  for (const [path, rawPathItem] of Object.entries(document.paths)) {
    const pathItem = resolveLocalRefs(rawPathItem, document);
    if (!isRecord(pathItem)) continue;
    for (const [method, rawOperation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method.toLowerCase()) || !isRecord(rawOperation)) continue;
      const operation = resolveLocalRefs(rawOperation, document);
      if (!isRecord(operation)) continue;

      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      const pathParameters = Array.isArray(pathItem.parameters) ? pathItem.parameters : [];
      const operationParameters = Array.isArray(operation.parameters) ? operation.parameters : [];
      const parameters = new Map<string, Record<string, unknown>>();
      for (const parameter of [...pathParameters, ...operationParameters]) {
        const resolvedParameter = resolveLocalRefs(parameter, document);
        if (
          isRecord(resolvedParameter) &&
          typeof resolvedParameter.name === "string" &&
          typeof resolvedParameter.in === "string"
        ) {
          parameters.set(`${resolvedParameter.in}:${resolvedParameter.name}`, resolvedParameter);
        }
      }
      for (const parameter of parameters.values()) {
        const name = String(parameter.name);
        const schema = isRecord(parameter.schema) ? parameter.schema : {};
        properties[name] = schema;
        if (parameter.required === true || parameter.in === "path") required.push(name);
      }

      const requestBody = resolveLocalRefs(operation.requestBody, document);
      if (isRecord(requestBody)) {
        const content = isRecord(requestBody.content) ? requestBody.content : {};
        const bodyContent = isRecord(content["application/json"])
          ? content["application/json"]
          : Object.values(content).find(isRecord);
        if (isRecord(bodyContent) && bodyContent.schema !== undefined) {
          const schema = resolveLocalRefs(bodyContent.schema, document);
          if (isRecord(schema) && (schema.type === "object" || isRecord(schema.properties))) {
            const bodyProperties = isRecord(schema.properties) ? schema.properties : {};
            Object.assign(properties, bodyProperties);
            if (Array.isArray(schema.required)) {
              required.push(...schema.required.filter((item): item is string => typeof item === "string"));
            }
          } else {
            properties.body = schema;
            if (requestBody.required === true) required.push("body");
          }
        }
      }

      const responses = isRecord(operation.responses) ? operation.responses : {};
      const preferredResponse =
        responses["200"] ??
        responses["201"] ??
        responses["202"] ??
        Object.entries(responses).find(([status]) => status.startsWith("2"))?.[1] ??
        Object.values(responses)[0];
      const summary = typeof operation.summary === "string" ? operation.summary : "";
      const description = typeof operation.description === "string" ? operation.description : summary;
      output.push({
        name: operationToolName(operation, method, path),
        description: description.slice(0, 1000),
        jsonSchema: {
          type: "object",
          properties,
          ...(required.length ? { required: [...new Set(required)] } : {}),
          additionalProperties: false,
        },
        mockResponse: responseExample(preferredResponse, document),
        scenarios: [],
      });
      if (output.length > MAX_IMPORTED_TOOLS) {
        throw new Error(`An import may contain at most ${MAX_IMPORTED_TOOLS} operations.`);
      }
    }
  }
  return output;
}

function extractFunctionTools(document: unknown): unknown[] {
  if (Array.isArray(document)) return document;
  if (!isRecord(document)) return [];
  if (Array.isArray(document.tools)) return document.tools;
  if (isRecord(document.result) && Array.isArray(document.result.tools)) {
    return document.result.tools;
  }
  if (document.type === "function" && isRecord(document.function)) return [document];
  if (typeof document.name === "string") return [document];
  return [];
}

function functionTool(tool: unknown): ImportedTool {
  if (!isRecord(tool)) throw new Error("Each tool definition must be a JSON object.");
  const fn = isRecord(tool.function) ? tool.function : tool;
  if (typeof fn.name !== "string" || !fn.name.trim()) {
    throw new Error("Each function tool must have a non-empty name.");
  }
  const input = isRecord(fn.parameters)
    ? fn.parameters
    : isRecord(fn.input_schema)
      ? fn.input_schema
      : isRecord(fn.inputSchema)
        ? fn.inputSchema
        : { type: "object", properties: {} };
  const schema = structuredClone(input);
  if (!schema.type) schema.type = "object";
  const outputSchema = isRecord(fn.output_schema)
    ? fn.output_schema
    : isRecord(fn.outputSchema)
      ? fn.outputSchema
      : null;
  const mockResponse = outputSchema ? exampleFromSchema(outputSchema) : { success: true };
  return {
    name: fn.name,
    description: typeof fn.description === "string" ? fn.description.slice(0, 1000) : "",
    jsonSchema: schema,
    mockResponse: isRecord(mockResponse) ? mockResponse : { result: mockResponse },
    scenarios: [],
  };
}

function parseImport(format: ToolImportFormat, source: string): ImportedTool[] {
  if (!["openapi", "function_tools", "mcp_tools", "har"].includes(format)) {
    throw new Error("Choose an import format.");
  }
  const document = parseSource(format, source);
  const tools = format === "har"
    ? harTools(document)
    : format === "openapi"
    ? openApiTools(document)
    : extractFunctionTools(document).map(functionTool);
  if (tools.length === 0) {
    throw new Error("No tool definitions were found. Check the selected format and pasted content.");
  }
  if (tools.length > MAX_IMPORTED_TOOLS) {
    throw new Error(`An import may contain at most ${MAX_IMPORTED_TOOLS} tools.`);
  }

  const names = new Set<string>();
  return tools.map((tool) => {
    if (names.has(tool.name)) throw new Error(`Import contains duplicate tool name "${tool.name}".`);
    names.add(tool.name);
    if (tool.jsonSchema.type !== undefined && tool.jsonSchema.type !== "object") {
      throw new Error(`Tool "${tool.name}" must have an object input schema.`);
    }
    if (tool.jsonSchema.type === undefined) tool.jsonSchema.type = "object";
    const schemaIssue = inspectMcpSchema(tool.jsonSchema);
    if (schemaIssue) throw new Error(`Tool "${tool.name}" has an unsafe input schema: ${schemaIssue}`);
    const configuration: ToolConfigurationInput = {
      name: tool.name,
      description: tool.description,
      jsonSchema: JSON.stringify(tool.jsonSchema),
      mockResponse: JSON.stringify(tool.mockResponse),
      scenarios: JSON.stringify(tool.scenarios),
      finalAnswerAssertions: "[]",
      semanticCriteria: "",
    };
    const parsed = parseToolConfiguration(configuration);
    return {
      name: parsed.name,
      description: parsed.description ?? "",
      jsonSchema: parsed.json_schema as Record<string, unknown>,
      mockResponse: parsed.mock_response as Record<string, unknown>,
      scenarios: parsed.scenarios as unknown as MockScenario[],
    };
  });
}

export function previewToolImport(format: ToolImportFormat, source: string): ImportedTool[] {
  return parseImport(format, source);
}

export function prepareImportedToolConfigurations(
  format: ToolImportFormat,
  source: string,
  selectedNames: string[]
): ImportedTool[] {
  if (!Array.isArray(selectedNames) || selectedNames.length === 0) {
    throw new Error("Select at least one tool to import.");
  }
  const requestedNames = new Set(selectedNames);
  if (requestedNames.size !== selectedNames.length) {
    throw new Error("A tool was selected more than once.");
  }
  const allTools = parseImport(format, source);
  const selected = allTools.filter((tool) => requestedNames.has(tool.name));
  if (selected.length !== requestedNames.size) {
    throw new Error("The selected tools do not match the pasted import. Preview again.");
  }
  return selected;
}
