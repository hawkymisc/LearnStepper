from __future__ import annotations

import logging
from typing import Any

from learnstepper.core import ApplicationCore
from learnstepper.errors import ApplicationError, validation_error

logger = logging.getLogger(__name__)


class LocalIPC:
    """Closed logical IPC envelope independent of the desktop IPC transport."""

    def __init__(self, core: ApplicationCore) -> None:
        self._core = core

    def handle(self, envelope: dict[str, Any]) -> dict[str, Any]:
        request_id: str | None = None
        try:
            if not isinstance(envelope, dict):
                raise validation_error("IPC envelope must be an object")
            envelope_type = envelope.get("type")
            if envelope_type == "command":
                self._closed_fields(
                    envelope,
                    required={"type", "name", "request_id", "payload"},
                )
                request_id = self._text(envelope["request_id"], "request_id")
                payload = self._payload(envelope["payload"])
                result = self._core.command(
                    name=self._text(envelope["name"], "name"),
                    payload=payload,
                    request_id=request_id,
                )
            elif envelope_type == "query":
                self._closed_fields(envelope, required={"type", "name", "payload"})
                result = self._core.query(
                    name=self._text(envelope["name"], "name"),
                    payload=self._payload(envelope["payload"]),
                )
            else:
                raise validation_error("IPC type must be command or query")
            return {"ok": True, "data": result}
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
            raise validation_error(
                "IPC envelope fields do not match the contract",
                details={
                    "missing": sorted(required - actual),
                    "unknown": sorted(actual - required),
                },
            )

    @staticmethod
    def _text(value: Any, field: str) -> str:
        if not isinstance(value, str) or not value.strip():
            raise validation_error(f"{field} must be a nonblank string")
        return value.strip()

    @staticmethod
    def _payload(value: Any) -> dict[str, Any]:
        if not isinstance(value, dict):
            raise validation_error("payload must be an object")
        return value
