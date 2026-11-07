import { Worker } from "node:worker_threads";
import type { ErrorObject } from "ajv";
import { inspectMcpSchema, type ValidationResult } from "./validators.ts";

export const MCP_VALIDATION_TIMEOUT_MS = 3_000;

const validationWorkerSource = `
  const { parentPort, workerData } = require("node:worker_threads");
  try {
    const AjvImport = require("ajv");
    const Ajv = AjvImport.default || AjvImport;
    const formatsImport = require("ajv-formats");
    const addFormats = formatsImport.default || formatsImport;
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(workerData.schema);
    const valid = validate(workerData.payload);
    parentPort.postMessage({ valid: Boolean(valid), errors: valid ? null : validate.errors || [] });
  } catch (error) {
    parentPort.postMessage({
      valid: false,
      invalidSchema: true,
      errors: [{
        instancePath: "",
        schemaPath: "",
        keyword: "invalidSchema",
        params: {},
        message: error instanceof Error ? error.message : "Tool schema is invalid."
      }]
    });
  }
`;

export async function validateAgainstSchemaWithTimeout(
  schema: Record<string, unknown>,
  payload: unknown,
  timeoutMs = MCP_VALIDATION_TIMEOUT_MS
): Promise<ValidationResult> {
  const schemaError = inspectMcpSchema(schema);
  if (schemaError) {
    return {
      valid: false,
      errors: [
        {
          instancePath: "",
          schemaPath: "",
          keyword: "invalidSchema",
          params: {},
          message: schemaError,
        } as ErrorObject,
      ],
    };
  }

  return new Promise((resolve) => {
    const worker = new Worker(validationWorkerSource, {
      eval: true,
      workerData: { schema, payload },
      resourceLimits: { maxOldGenerationSizeMb: 32, stackSizeMb: 2 },
    });
    let settled = false;
    const finish = (result: ValidationResult, terminateWorker = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (terminateWorker) void worker.terminate();
      resolve(result);
    };
    const timer = setTimeout(() => {
      finish({
        valid: false,
        errors: [
          {
            instancePath: "",
            schemaPath: "",
            keyword: "validationTimeout",
            params: {},
            message: "Argument validation exceeded the allowed time. Simplify the arguments and try again.",
          } as ErrorObject,
        ],
      }, true);
    }, timeoutMs);

    worker.once("message", (result: { valid: boolean; errors: ErrorObject[] | null }) => {
      finish({ valid: result.valid, errors: result.valid ? null : result.errors });
    });
    worker.once("error", () => {
      finish({
        valid: false,
        errors: [
          {
            instancePath: "",
            schemaPath: "",
            keyword: "invalidSchema",
            params: {},
            message: "Tool schema validation failed.",
          } as ErrorObject,
        ],
      });
    });
    worker.once("exit", (code) => {
      if (code !== 0 && !settled) {
        finish({
          valid: false,
          errors: [
            {
              instancePath: "",
              schemaPath: "",
              keyword: "invalidSchema",
              params: {},
              message: "Tool schema validation failed.",
            } as ErrorObject,
          ],
        });
      }
    });
  });
}
