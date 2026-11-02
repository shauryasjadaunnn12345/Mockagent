# Delayed-order refund agent example

This small Node.js agent calls real MockAgent HTTP tools through the published
`trymockagent` SDK. It demonstrates a reproducible agent bug: the buggy version
submits a refund after the first order lookup returns `pending`. The fixed
version waits for the next sequence response, verifies inventory, and submits
the refund only when the order is `ready`.

The sample uses mock endpoints only. Do not configure production systems or
real payment/refund credentials.

## Configure MockAgent

Create these three active tools in a MockAgent workspace. Copy each tool ID
from its dashboard card. Protecting the tools with a workspace API key is
recommended.

### `lookup_order`

- Schema: `{"type":"object","properties":{"order_id":{"type":"string"}},"required":["order_id"],"additionalProperties":false}`
- Default response: `{"order_id":"order-42","status":"ready"}`
- Scenario named **Delayed order becomes ready**
  - Match schema: `{"type":"object","properties":{"order_id":{"const":"order-42"}},"required":["order_id"]}`
  - Response sequence: `[{"order_id":"order-42","status":"pending"},{"order_id":"order-42","status":"ready"}]`

### `check_inventory`

- Schema: `{"type":"object","properties":{"sku":{"type":"string"}},"required":["sku"],"additionalProperties":false}`
- Default response: `{"sku":"sku-17","available":true,"quantity":3}`

### `issue_refund`

- Schema: `{"type":"object","properties":{"order_id":{"type":"string"},"reason":{"type":"string","enum":["delivery_delay","damaged_item"]},"order_status":{"type":"string","enum":["pending","ready","cancelled"]}},"required":["order_id","reason","order_status"],"additionalProperties":false}`
- Default response: `{"success":true,"refund_id":"refund-demo","status":"processed"}`
- Scenario named **Block pending refund**
  - Match schema: `{"type":"object","properties":{"order_status":{"const":"pending"}},"required":["order_status"]}`
  - Response: `{"success":false,"error":"Order is still pending; no refund was issued."}`

The explicit status argument and scenario make the unsafe action visible in
MockAgent logs. The script also checks the returned response and reports the
bug as a nonzero exit.

## Run the agent

Node.js 18 or later is required. Install the SDK from npm:

```powershell
npm install trymockagent
$env:MOCKAGENT_LOOKUP_ORDER_TOOL_ID = "your-lookup-tool-id"
$env:MOCKAGENT_CHECK_INVENTORY_TOOL_ID = "your-inventory-tool-id"
$env:MOCKAGENT_ISSUE_REFUND_TOOL_ID = "your-refund-tool-id"
$env:MOCKAGENT_API_KEY = "your-workspace-api-key"
node examples/delayed-order-refund/agent.mjs
```

`MOCKAGENT_API_KEY` is optional only if the tools are not key-protected.
`MOCKAGENT_BASE_URL` defaults to `https://mockagent.online`; set it for a
self-hosted deployment. Each run uses one run ID across tool calls so the
ordered response sequence is replayed consistently.

To reproduce the bug:

```powershell
node examples/delayed-order-refund/agent.mjs --buggy
```

The buggy mode exits with code `1` and logs the pending-order refund attempt.
The corrected mode should exit `0` and log this sequence:

```text
lookup_order → lookup_order → check_inventory → issue_refund
```

Run the offline SDK integration tests without an account or network:

```powershell
node --test examples/delayed-order-refund/agent.test.mjs
```

## Catch a saved-suite regression in CI

MockAgent's saved-suite CI runner exits `1` if any saved regression check
fails. Configure `MOCKAGENT_BASE_URL` and `MOCKAGENT_API_KEY` as CI secrets and
select the suite IDs that exercise the delayed-order flow:

```yaml
- name: Run MockAgent regression suites
  env:
    MOCKAGENT_BASE_URL: ${{ secrets.MOCKAGENT_BASE_URL }}
    MOCKAGENT_API_KEY: ${{ secrets.MOCKAGENT_API_KEY }}
    MOCKAGENT_SUITE_IDS: ${{ vars.MOCKAGENT_REFUND_SUITE_IDS }}
  run: node scripts/mockagent-ci.mjs
```

For example, set `MOCKAGENT_REFUND_SUITE_IDS` to a saved suite that expects
`lookup_order → lookup_order → check_inventory → issue_refund` and asserts that
the final answer reports the ready status. If the suite reports a failed
check, `scripts/mockagent-ci.mjs` prints the failure and exits nonzero, causing
the workflow step to fail. The manual workflow
[`../../.github/workflows/mockagent-regression.yml`](../../.github/workflows/mockagent-regression.yml)
shows the same runner with optional suite selection.
