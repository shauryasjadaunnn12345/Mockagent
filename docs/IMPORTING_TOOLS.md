# Importing mock tools

Open **Dashboard → Mock Tools → Import tools**, select a source format, paste
the definition, preview the generated contracts and example responses, then
create the selected mocks. The flow creates local mocks only; it does not call
an upstream API or connect to a pasted MCP server.

Supported inputs:

- **OpenAPI**: JSON or YAML OpenAPI documents. Each supported HTTP operation
  becomes one tool. Path/query/header parameters and JSON request fields form
  the tool's root argument object. Local `#/...` references are resolved;
  external references are rejected and never fetched. Successful response
  examples or schema examples seed the mock response.
- **OpenAI / Anthropic**: a function tool, a list of function tools, or an
  object containing `tools`. OpenAI `function.parameters`, Anthropic
  `input_schema`, and compatible camel-case `inputSchema` are supported.
- **MCP**: a `tools/list` result or an object containing a `tools` array.
  MCP `inputSchema` is used as the argument contract and `outputSchema`
  provides a sample response when possible.
- **HAR 1.2**: an exported browser/proxy capture with `log.entries`. Each
  supported HTTP method and normalized path becomes a tool. Query, path, and
  JSON/form request values become a nested `query`, `path`, and/or `body`
  argument object. Recorded request/response pairs become exact-match
  scenarios; repeated identical safe requests become response sequences that
  use MockAgent's normal run-ID behavior.

Imports are limited to 256 KiB and 50 tools per pass; HAR imports are further
limited to 200 entries and 64 KiB per response. HAR import is offline: it does
not make requests to captured hosts. Only JSON response bodies are retained;
response status and headers are not emulated. Request headers (including
authorization/cookies) are not imported, sensitive-name fields are omitted
from requests and redacted in responses, and common credential-shaped strings
are scrubbed. These heuristics are not a guarantee that arbitrary personal or
confidential data has been removed. Inspect the preview and remove sensitive
data before creating mocks.

Tool names must be unique within the pasted import, schemas must be valid
object schemas, and workspace plan limits are checked before insertion.
Generated mocks use available response examples or schema defaults/enums;
otherwise they use a small success-shaped placeholder. Review and edit the
response and scenarios after creation to make the mock reflect the behavior
your agent should test.

The preview helps catch unsupported shapes before creation. If import fails,
check that the pasted content matches the selected format and that the
workspace has enough tool capacity.
