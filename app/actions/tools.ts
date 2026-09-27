"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { validateSchemaDefinition } from "@/lib/validators";
import type { Json } from "@/types/database";

export interface CreateToolInput {
  name: string;
  description: string;
  jsonSchema: string; // raw JSON text from the form, parsed here
  mockResponse: string; // raw JSON text from the form, parsed here
}

export interface ActionResult {
  success: boolean;
  error?: string;
}

function safeJsonParse(raw: string, fieldLabel: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error(`${fieldLabel} must be a JSON object.`);
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      err instanceof Error && err.message.includes("must be a JSON object")
        ? err.message
        : `${fieldLabel} is not valid JSON.`
    );
  }
}

export async function createTool(input: CreateToolInput): Promise<ActionResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: "You must be signed in." };
  }

  if (!input.name.trim()) {
    return { success: false, error: "Tool name is required." };
  }

  let jsonSchema: Record<string, unknown>;
  let mockResponse: Record<string, unknown>;
  try {
    jsonSchema = safeJsonParse(input.jsonSchema, "Expected JSON Schema");
    mockResponse = safeJsonParse(input.mockResponse, "Mock response body");
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Invalid JSON." };
  }

  const schemaError = validateSchemaDefinition(jsonSchema);
  if (schemaError) {
    return {
      success: false,
      error: `Expected JSON Schema is invalid: ${schemaError}`,
    };
  }

  const { error } = await supabase.from("tools").insert({
    user_id: user.id,
    name: input.name.trim(),
    description: input.description.trim() || null,
    json_schema: jsonSchema as Json,
    mock_response: mockResponse as Json,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/dashboard");
  return { success: true };
}

export async function toggleToolActive(toolId: string, isActive: boolean): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("tools").update({ is_active: isActive }).eq("id", toolId);

  if (error) return { success: false, error: error.message };
  revalidatePath("/dashboard");
  return { success: true };
}

export async function deleteTool(toolId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("tools").delete().eq("id", toolId);

  if (error) return { success: false, error: error.message };
  revalidatePath("/dashboard");
  return { success: true };
}
