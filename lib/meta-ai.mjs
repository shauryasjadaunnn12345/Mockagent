export const META_DEFAULT_MODEL = "meta-models/muse-spark-open-1026";
export const META_DEFAULT_BASE_URL = "https://inference.baseten.co/v1";
export function getMetaConfig() {
  const apiKey = process.env.SEMANTIC_JUDGE_API_KEY?.trim() ?? "";
  const model = process.env.SEMANTIC_JUDGE_MODEL?.trim() || META_DEFAULT_MODEL;
  const baseUrl = (process.env.SEMANTIC_JUDGE_BASE_URL?.trim() || META_DEFAULT_BASE_URL).replace(/\/+$/, "");
  return { apiKey, model, baseUrl, configured: Boolean(apiKey) };
}
export async function metaChatCompletion(opts) {
  const { apiKey, model, baseUrl } = getMetaConfig();
  if (!apiKey) throw new Error("SEMANTIC_JUDGE_API_KEY not configured");
  const body = { model: opts.model ?? model, temperature: opts.temperature ?? 0, messages: opts.messages };
  if (opts.jsonMode) body.response_format = { type: "json_object" };
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  const res = await fetch(`${baseUrl}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: opts.signal });
  if (!res.ok) { const t = await res.text().catch(()=> ""); throw new Error(`Meta AI HTTP ${res.status}: ${t.slice(0,200)}`); }
  return res.json();
}
export async function generateToolDraft(prompt) {
  const json = await metaChatCompletion({ jsonMode: true, maxTokens: 1500, messages: [{ role: "system", content: "You generate JSON Schema for mock tools. Return JSON with { name, description, json_schema, mock_response, scenarios }. Keep concise." }, { role: "user", content: prompt.slice(0,3000) }] });
  const content = json?.choices?.[0]?.message?.content; return content ? JSON.parse(content) : null;
}
