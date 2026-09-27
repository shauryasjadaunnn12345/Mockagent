import Ajv, { type ErrorObject } from "ajv";
import addFormats from "ajv-formats";

// A single AJV instance is reused across requests (cheaper than constructing
// per-call). `allErrors: true` so agents get every violation at once instead
// of fixing one field per retry.
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

export interface ValidationResult {
  valid: boolean;
  errors: ErrorObject[] | null;
}

export function validateSchemaDefinition(
  schema: Record<string, unknown>
): string | null {
  try {
    ajv.compile(schema);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "Invalid JSON Schema.";
  }
}

/**
 * Validates `payload` against a user-defined JSON Schema (draft-07 style).
 * Compiled validators are cached by AJV internally per schema object identity
 * within a single process; for high-traffic tools consider caching compiled
 * validators by tool id in a module-level Map keyed off an updated_at hash.
 */
export function validateAgainstSchema(
  schema: Record<string, unknown>,
  payload: unknown
): ValidationResult {
  try {
    const validate = ajv.compile(schema);
    const valid = validate(payload) as boolean;
    return { valid, errors: valid ? null : validate.errors ?? null };
  } catch (err) {
    // Malformed schema on the tool itself — treat as a schema violation so
    // the caller gets a useful 400 instead of a raw 500.
    return {
      valid: false,
      errors: [
        {
          instancePath: "",
          schemaPath: "",
          keyword: "invalidSchema",
          params: {},
          message:
            err instanceof Error
              ? `Tool's expected_json_schema is invalid: ${err.message}`
              : "Tool's expected_json_schema is invalid.",
        } as ErrorObject,
      ],
    };
  }
}
