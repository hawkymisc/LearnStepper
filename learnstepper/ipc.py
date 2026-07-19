from __future__ import annotations

import json
import logging
import uuid
from typing import Any

from learnstepper.conversation import ConversationCoordinator
from learnstepper.core import ApplicationCore
from learnstepper.errors import ApplicationError, validation_error

logger = logging.getLogger(__name__)


class LocalIPC:
    """Closed logical IPC envelope independent of the desktop IPC transport."""

    MAX_ENVELOPE_BYTES = 1_048_576
    MAX_RESPONSE_BYTES = 1_048_576
    MAX_STRING_LENGTH = 65_536
    MAX_COLLECTION_ITEMS = 1_000
    MAX_DEPTH = 32

    def __init__(self, core: ApplicationCore, *, conversation: ConversationCoordinator) -> None:
        self._core = core
        self._conversation = conversation

    def handle(self, envelope: dict[str, Any]) -> dict[str, Any]:
        request_id: str | None = None
        try:
            if not isinstance(envelope, dict):
                raise validation_error("IPC envelope must be an object")
            self._validate_limits(envelope)
            envelope_type = envelope.get("type")
            if envelope_type == "command":
                self._closed_fields(
                    envelope,
                    required={"type", "name", "request_id", "payload"},
                )
                request_id = self._request_id(envelope["request_id"])
                payload = self._payload(envelope["payload"])
                name = self._text(envelope["name"], "name")
                if name in ConversationCoordinator.COMMANDS or self._conversation.handles_command(name):
                    result = self._conversation.command(name=name, payload=payload, request_id=request_id)
                else:
                    result = self._core.command(name=name, payload=payload, request_id=request_id)
            elif envelope_type == "query":
                self._closed_fields(envelope, required={"type", "name", "payload"})
                name = self._text(envelope["name"], "name")
                payload = self._payload(envelope["payload"])
                if name in ConversationCoordinator.QUERIES or self._conversation.handles_query(name):
                    result = self._conversation.query(name=name, payload=payload)
                else:
                    result = self._core.query(name=name, payload=payload)
            else:
                raise validation_error("IPC type must be command or query")
            response = {"ok": True, "data": result}
            response_size = len(json.dumps(response, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
            if response_size > self.MAX_RESPONSE_BYTES:
                raise ApplicationError(
                    "RESPONSE_TOO_LARGE",
                    "IPC response exceeds the maximum size; request a smaller page",
                )
            return response
        except ApplicationError as error:
            if error.request_id is None:
                error.request_id = request_id
            return {"ok": False, "error": error.to_dict()}
        except Exception as error:
            # Preserve the cause at this boundary for the caller's logger while
            # avoiding internal details or payload values in the response.
            logger.exception("[LocalIPC] unhandled application-core error")
            wrapped = ApplicationError(
                "INTERNAL_ERROR",
                "An internal application error occurred",
                request_id=request_id,
            )
            wrapped.__cause__ = error
            return {"ok": False, "error": wrapped.to_dict()}

    @staticmethod
    def _closed_fields(envelope: dict[str, Any], *, required: set[str]) -> None:
        actual = set(envelope)
        if actual != required:
            raise validation_error("IPC envelope fields do not match the contract")

    @staticmethod
    def _text(value: Any, field: str) -> str:
        if not isinstance(value, str) or not value.strip():
            raise validation_error(f"{field} must be a nonblank string")
        if len(value) > LocalIPC.MAX_STRING_LENGTH:
            raise validation_error(f"{field} exceeds the maximum length")
        return value.strip()

    @classmethod
    def _validate_limits(cls, envelope: dict[str, Any]) -> None:
        try:
            encoded = json.dumps(envelope, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        except (TypeError, ValueError) as error:
            raise validation_error("IPC envelope must contain JSON values") from error
        if len(encoded) > cls.MAX_ENVELOPE_BYTES:
            raise validation_error("IPC envelope exceeds the maximum size")
        stack: list[tuple[Any, int]] = [(envelope, 1)]
        while stack:
            value, depth = stack.pop()
            if depth > cls.MAX_DEPTH:
                raise validation_error("IPC payload exceeds the maximum nesting depth")
            if isinstance(value, str):
                if len(value) > cls.MAX_STRING_LENGTH:
                    raise validation_error("IPC string exceeds the maximum length")
            elif isinstance(value, dict):
                if len(value) > cls.MAX_COLLECTION_ITEMS:
                    raise validation_error("IPC object exceeds the maximum item count")
                stack.extend((item, depth + 1) for item in value.values())
            elif isinstance(value, list):
                if len(value) > cls.MAX_COLLECTION_ITEMS:
                    raise validation_error("IPC array exceeds the maximum item count")
                stack.extend((item, depth + 1) for item in value)

    @classmethod
    def _request_id(cls, value: Any) -> str:
        text = cls._text(value, "request_id")
        try:
            parsed = uuid.UUID(text)
        except ValueError as error:
            raise validation_error("request_id must be a UUID") from error
        if str(parsed) != text.lower():
            raise validation_error("request_id must use canonical UUID form")
        return str(parsed)

    @staticmethod
    def _payload(value: Any) -> dict[str, Any]:
        if not isinstance(value, dict):
            raise validation_error("payload must be an object")
        return value
