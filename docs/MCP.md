# Hosted MCP servers

MockAgent can expose a workspace toolset as a remote, stateless MCP server.
Create a toolset from the dashboard, choose its authentication mode, and copy
the URL from **Connect via MCP**:

```text
POST https://mockagent.online/api/mcp/{workspaceSlug}/{toolsetSlug}
```

Apply the current [`schema.sql`](../schema.sql) to the Supabase database before
using this feature. A toolset contains selected tools from one workspace;
duplicate tool names are not allowed in a toolset.

## Authentication

- **Workspace API key**: send `Authorization: Bearer <WORKSPACE_API_KEY>`.
  The key must belong to the toolset's workspace. A tool's existing
  `require_api_key` setting is still enforced for calls.
- **Open URL token**: the dashboard generates a high-entropy token and shows
  it only once. The copied URL contains `?token=...`; the database stores only
  its SHA-256 hash. Rotate the token from the dashboard if it is lost. For
  tools that require an API key, callers must also send the workspace key.

Treat either credential as a secret. Do not commit the URL or key to source
control, and avoid pasting open URLs into shared logs or tickets. Credentials
and authorization headers are not written to MockAgent execution logs.

## Protocol and limits

The endpoint supports the stateless `2026-07-28` revision and legacy
`initialize` clients through `2024-11-05`. It implements `server/discover`,
`tools/list`, `tools/call`, `ping`, and `notifications/initialized`. It does
not issue or require sessions and does not provide the deprecated HTTP+SSE
transport. Calls use JSON-RPC over `POST`; `GET` returns `405`.

The endpoint uses the same workspace quotas, tool execution engine, scenario
matching, response sequences, scheduled transient failures, and retention
policy as HTTP tool calls. Discovery/list requests are rate-limited but do not
consume call quota. Calls are logged with MCP transport and method metadata.
Invalid arguments and scenario/fault outcomes are model-readable MCP tool
results with `isError: true`; malformed JSON-RPC requests return protocol
errors.

Request bodies and complete JSON-RPC results are limited to 256 KiB. Schemas
exposed by MCP are bounded to 64 KiB and depth 20; external JSON Schema `$ref`
values are rejected. MCP validation has a 3-second worker timeout, and tool
execution is limited to 10 seconds.

## Client configuration

Use the dashboard snippets so the endpoint URL and selected auth mode match.
The authentication placeholders below must be replaced with a workspace API
key, or the open URL token must be used instead.

### Claude Code

For API-key mode, set `MOCKAGENT_API_KEY` in the shell and run:

```sh
claude mcp add --transport http mockagent \
  "https://mockagent.online/api/mcp/WORKSPACE/TOOLSET" \
  --header "Authorization: Bearer $MOCKAGENT_API_KEY"
```

For open mode, use the copied URL (including its token) and omit `--header`.
See the [Claude Code MCP guide](https://docs.anthropic.com/en/docs/claude-code/mcp).

### Cursor

Add a remote server to Cursor's MCP configuration. For API-key mode, configure
the key in the environment where Cursor runs:

```json
{
  "mcpServers": {
    "mockagent": {
      "url": "https://mockagent.online/api/mcp/WORKSPACE/TOOLSET",
      "headers": {
        "Authorization": "Bearer ${env:MOCKAGENT_API_KEY}"
      }
    }
  }
}
```

For open mode, use the copied token URL and omit `headers`. See Cursor's
[MCP documentation](https://cursor.com/docs/mcp).

### VS Code

Add the server to `.vscode/mcp.json`. Set `MOCKAGENT_API_KEY` in the
environment where VS Code connects to the server:

```json
{
  "servers": {
    "mockagent": {
      "type": "http",
      "url": "https://mockagent.online/api/mcp/WORKSPACE/TOOLSET",
      "headers": {
        "Authorization": "Bearer ${env:MOCKAGENT_API_KEY}"
      }
    }
  }
}
```

For open mode, use the copied token URL and omit `headers`. See the VS Code
[MCP configuration reference](https://code.visualstudio.com/docs/agents/reference/mcp-configuration).

### MCP Inspector

Run `npx @modelcontextprotocol/inspector`, select the remote/Streamable HTTP
transport, and paste the copied toolset URL. In API-key mode, add an
`Authorization` header with the workspace API key. Use **List Tools**, invoke a
tool, then inspect the MCP entries in the MockAgent dashboard logs.

For curl-based checks, see [`scripts/mcp-smoke.sh`](../scripts/mcp-smoke.sh).
