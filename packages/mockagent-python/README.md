# trymockagent

Dependency-free Python client for the MockAgent API. Supports Python 3.9+.

After publishing the package, install it with:

```bash
pip install trymockagent
```

```python
import os
import uuid

from trymockagent import MockAgent, MockAgentError

mock = MockAgent(
    tool_id="YOUR_TOOL_ID",
    api_key=os.getenv("MOCKAGENT_API_KEY"),  # optional unless the tool requires a key
)
run_id = str(uuid.uuid4())

try:
    result = mock.call({"user_id": "vip", "reason": "duplicate"}, run_id=run_id)
    print(result)
    # If this tool has final-answer QA criteria configured:
    qa = mock.submit_final_answer("The VIP refund was processed.", run_id=run_id)
    print(qa)
except MockAgentError as error:
    print(error.status, error.body, error.retryable, error.retry_after_seconds)
    raise
```

`get_tool()` fetches the tool's schema and description. `call(arguments,
run_id=...)` posts JSON and forwards the run ID in `x-mockagent-run-id`.
`submit_final_answer(text, run_id=...)` submits configured final-answer checks.
No automatic retries are made; inspect the exception and follow the response's
retry guidance. Set `base_url` for a self-hosted MockAgent instance.
