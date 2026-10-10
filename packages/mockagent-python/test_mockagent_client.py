import io
import json
import unittest
from email.message import Message
from unittest.mock import patch

from trymockagent import MockAgent, MockAgentError


class MockAgentClientTests(unittest.TestCase):
    def test_default_base_url_uses_canonical_host(self):
        client = MockAgent("tool")
        self.assertEqual(client.tool_url, "https://www.mockagent.online/api/v1/mock/tool")

    def test_call_sends_json_bearer_key_and_run_id(self):
        response = io.BytesIO(b'{"ok":true}')
        response.status = 200
        response.headers = Message()
        with patch("trymockagent.urlopen", return_value=response) as open_url:
            client = MockAgent("tool id", api_key="secret")
            self.assertEqual(
                client.call({"value": 1}, run_id="run-1"),
                {"ok": True},
            )

        request = open_url.call_args.args[0]
        self.assertEqual(request.full_url, "https://www.mockagent.online/api/v1/mock/tool%20id")
        self.assertEqual(request.get_header("Authorization"), "Bearer secret")
        self.assertEqual(request.get_header("X-mockagent-run-id"), "run-1")
        self.assertEqual(json.loads(request.data), {"value": 1})

    def test_http_error_preserves_error_and_retry_guidance(self):
        response = io.BytesIO(b'{"error":"Try again","retryable":true}')
        response.status = 429
        response.headers = Message()
        response.headers["Retry-After"] = "3"
        with patch("trymockagent.urlopen", return_value=response):
            with self.assertRaises(MockAgentError) as raised:
                MockAgent("tool").call({})

        self.assertEqual(raised.exception.status, 429)
        self.assertTrue(raised.exception.retryable)
        self.assertEqual(raised.exception.retry_after_seconds, 3)
        self.assertEqual(raised.exception.body["error"], "Try again")

    def test_final_answer_requires_run_id_and_forwards_it(self):
        response = io.BytesIO(b'{"passed":true}')
        response.status = 200
        response.headers = Message()
        with patch("trymockagent.urlopen", return_value=response) as open_url:
            client = MockAgent("tool")
            with self.assertRaises(ValueError):
                client.submit_final_answer("done", run_id="")
            self.assertEqual(
                client.submit_final_answer("done", run_id="run-2"),
                {"passed": True},
            )

        request = open_url.call_args.args[0]
        self.assertEqual(request.get_header("X-mockagent-run-id"), "run-2")
        self.assertEqual(json.loads(request.data), {"final_answer": "done"})


if __name__ == "__main__":
    unittest.main()
