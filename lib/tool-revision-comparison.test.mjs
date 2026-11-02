import assert from "node:assert/strict";
import test from "node:test";
import { compareToolRevision } from "./tool-revision-comparison.ts";

test("reports only changed configuration fields and ignores object key order", () => {
  const previous = {
    name: "lookup",
    description: "Find order",
    json_schema: { type: "object", properties: { id: { type: "string" } } },
    mock_response: { status: "old" },
  };
  const current = {
    ...previous,
    json_schema: { properties: { id: { type: "string" } }, type: "object" },
    mock_response: { status: "new" },
  };
  assert.deepEqual(compareToolRevision(previous, current)?.map(({ key }) => key), ["mock_response"]);
});

test("compares scenarios and labels schema changes", () => {
  const differences = compareToolRevision(
    { scenarios: [{ name: "A", response: { ok: false } }] },
    { scenarios: [{ name: "A", response: { ok: true } }] },
  );
  assert.equal(differences?.[0].label, "Scenarios");
  assert.match(differences?.[0].previous ?? "", /false/);
  assert.match(differences?.[0].current ?? "", /true/);
});

test("rejects malformed revision snapshots", () => {
  assert.equal(compareToolRevision(null, {}), null);
});
