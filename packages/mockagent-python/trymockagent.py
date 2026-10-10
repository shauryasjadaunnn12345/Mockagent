"""A dependency-free Python client for the MockAgent API."""

from __future__ import annotations

import json
from typing import Any, Dict, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


class MockAgentError(Exception):
    """An HTTP, network, or response-format error from MockAgent."""

    def __init__(
        self,
        message: str,
        *,
        status: Optional[int] = None,
        body: Any = None,
        retry_after_seconds: Optional[int] = None,
        cause: Optional[BaseException] = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.body = body
        self.retry_after_seconds = retry_after_seconds
        self.retryable = body.get("retryable") if isinstance(body, dict) else None
        if cause is not None:
            self.__cause__ = cause


class MockAgent:
    """Call one MockAgent tool and submit final-answer QA for its runs."""

    def __init__(
        self,
        tool_id: str,
        *,
        api_key: Optional[str] = None,
        base_url: str = "https://www.mockagent.online",
        timeout: Optional[float] = 30,
    ) -> None:
        if not tool_id:
            raise ValueError("tool_id is required.")
        self.tool_id = tool_id
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.tool_url = "{}/api/v1/mock/{}".format(self.base_url, quote(tool_id, safe=""))

    def get_tool(self) -> Any:
        """Fetch the tool's description and expected JSON schema."""
        return self._request(self.tool_url, "GET")

    def call(self, arguments: Any, *, run_id: Optional[str] = None) -> Any:
        """Post tool-call arguments, optionally associating them with a run."""
        headers = {"x-mockagent-run-id": run_id} if run_id else {}
        return self._request(self.tool_url, "POST", arguments, headers)

    def submit_final_answer(self, final_answer: str, *, run_id: str) -> Any:
        """Submit the final answer for configured checks on this run."""
        if not run_id:
            raise ValueError("run_id is required to submit a final answer.")
        return self._request(
            self.tool_url + "/final-answer",
            "POST",
            {"final_answer": final_answer},
            {"x-mockagent-run-id": run_id},
        )

    def _request(
        self,
        url: str,
        method: str,
        body: Any = None,
        extra_headers: Optional[Dict[str, str]] = None,
    ) -> Any:
        headers = dict(extra_headers or {})
        if body is not None:
            headers["Content-Type"] = "application/json"
        if self.api_key:
            headers["Authorization"] = "Bearer " + self.api_key
        encoded_body = None if body is None else json.dumps(body).encode("utf-8")
        request = Request(url, data=encoded_body, headers=headers, method=method)

        try:
            with urlopen(request, timeout=self.timeout) as response:
                status = response.status
                response_headers = response.headers
                raw_body = response.read()
        except HTTPError as error:
            status = error.code
            response_headers = error.headers
            try:
                raw_body = error.read()
            finally:
                error.close()
        except URLError as error:
            raise MockAgentError(
                "Could not connect to MockAgent.",
                cause=error,
            ) from error

        text = raw_body.decode("utf-8")
        try:
            parsed_body = json.loads(text) if text else None
        except json.JSONDecodeError as error:
            raise MockAgentError(
                "MockAgent returned a non-JSON response.",
                status=status,
                body=text,
                cause=error,
            ) from error

        if status < 200 or status >= 300:
            message = "MockAgent request failed ({})".format(status)
            if isinstance(parsed_body, dict):
                message = parsed_body.get("error") or parsed_body.get("message") or message
            retry_after = response_headers.get("Retry-After")
            try:
                retry_after_seconds = int(retry_after) if retry_after is not None else None
            except ValueError:
                retry_after_seconds = None
            raise MockAgentError(
                message,
                status=status,
                body=parsed_body,
                retry_after_seconds=retry_after_seconds,
            )
        return parsed_body
