const DEFAULT_BASE_URL = "https://mockagent.online";

export class MockAgentError extends Error {
  constructor(message, { status = null, body = null, retryAfterSeconds = null } = {}) {
    super(message);
    this.name = "MockAgentError";
    this.status = status;
    this.body = body;
    this.retryAfterSeconds = retryAfterSeconds;
    this.retryable = body && typeof body === "object" && "retryable" in body
      ? body.retryable
      : null;
  }
}

export class MockAgent {
  constructor({ toolId, apiKey, baseUrl = DEFAULT_BASE_URL, fetch: fetchImplementation = globalThis.fetch }) {
    if (!toolId) throw new TypeError("toolId is required.");
    if (typeof fetchImplementation !== "function") {
      throw new TypeError("A Fetch API implementation is required.");
    }
    this.toolId = toolId;
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetch = fetchImplementation;
    this.toolUrl = `${this.baseUrl}/api/v1/mock/${encodeURIComponent(toolId)}`;
  }

  async getTool() {
    return this.request(this.toolUrl, { method: "GET" });
  }

  async call(arguments_, { runId } = {}) {
    return this.request(this.toolUrl, {
      method: "POST",
      body: JSON.stringify(arguments_),
      headers: runId ? { "x-mockagent-run-id": runId } : {},
    });
  }

  async submitFinalAnswer(finalAnswer, { runId } = {}) {
    if (!runId) throw new TypeError("runId is required to submit a final answer.");
    return this.request(`${this.toolUrl}/final-answer`, {
      method: "POST",
      body: JSON.stringify({ final_answer: finalAnswer }),
      headers: { "x-mockagent-run-id": runId },
    });
  }

  async request(url, { method, body, headers = {} }) {
    const requestHeaders = { ...headers };
    if (body !== undefined) requestHeaders["content-type"] = "application/json";
    if (this.apiKey) requestHeaders.authorization = `Bearer ${this.apiKey}`;

    const response = await this.fetch(url, {
      method,
      headers: requestHeaders,
      ...(body === undefined ? {} : { body }),
    });
    const text = await response.text();
    let responseBody = null;
    if (text) {
      try {
        responseBody = JSON.parse(text);
      } catch {
        throw new MockAgentError("MockAgent returned a non-JSON response.", {
          status: response.status,
          body: text,
        });
      }
    }

    if (!response.ok) {
      const message = responseBody && typeof responseBody === "object"
        ? responseBody.error ?? responseBody.message ?? `MockAgent request failed (${response.status}).`
        : `MockAgent request failed (${response.status}).`;
      const retryAfter = response.headers.get("retry-after");
      throw new MockAgentError(message, {
        status: response.status,
        body: responseBody,
        retryAfterSeconds: retryAfter === null ? null : Number(retryAfter),
      });
    }
    return responseBody;
  }
}
