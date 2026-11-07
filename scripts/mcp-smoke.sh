#!/usr/bin/env sh
set -eu

: "${MCP_URL:?Set MCP_URL to the full toolset endpoint URL}"
: "${MCP_TOOL:?Set MCP_TOOL to a tool name in this toolset}"

AUTH_HEADER=""
if [ -n "${MOCKAGENT_API_KEY:-}" ]; then
  AUTH_HEADER="Authorization: Bearer ${MOCKAGENT_API_KEY}"
fi
RUN_HEADER="X-Run-Id: ${MCP_RUN_ID:-mcp-smoke-run}"

post_rpc() {
  method="$1"
  body="$2"
  if [ -n "$AUTH_HEADER" ]; then
    curl --fail-with-body --silent --show-error "$MCP_URL" \
      -H "Content-Type: application/json" \
      -H "Accept: application/json, text/event-stream" \
      -H "MCP-Protocol-Version: 2026-07-28" \
      -H "Mcp-Method: $method" \
      -H "$RUN_HEADER" \
      -H "$AUTH_HEADER" \
      --data "$body"
  else
    curl --fail-with-body --silent --show-error "$MCP_URL" \
      -H "Content-Type: application/json" \
      -H "Accept: application/json, text/event-stream" \
      -H "MCP-Protocol-Version: 2026-07-28" \
      -H "Mcp-Method: $method" \
      -H "$RUN_HEADER" \
      --data "$body"
  fi
  printf '\n'
}

echo "Discover server"
post_rpc "server/discover" \
  '{"jsonrpc":"2.0","id":1,"method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28"}}}'

echo "List tools"
post_rpc "tools/list" \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28"}}}'

echo "Call tool (edit MCP_ARGUMENTS below to match the selected tool schema)"
if [ -z "${MCP_ARGUMENTS+x}" ]; then
  MCP_ARGUMENTS='{}'
fi
CALL_BODY=$(printf '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28"},"name":"%s","arguments":%s}}' "$MCP_TOOL" "$MCP_ARGUMENTS")
post_rpc "tools/call" \
  "$CALL_BODY"

cat <<'EOF'

Next checks:
1. Change MCP_ARGUMENTS to invalid data and confirm the result has isError: true
   and a useful field-level message.
2. Reuse an X-Run-Id header on calls to exercise sequences and scheduled faults.
   The calls appear in Dashboard > Execution Logs with an MCP badge and method.
3. Run `npx @modelcontextprotocol/inspector`, select remote Streamable HTTP,
   paste MCP_URL, and add Authorization when using API-key mode.
EOF
