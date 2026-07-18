from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class ApplicationError(Exception):
    code: str
    message: str
    retryable: bool = False
    retry_at: str | None = None
    request_id: str | None = None
    details: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        Exception.__init__(self, self.message)

    def to_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            "retryable": self.retryable,
            "retry_at": self.retry_at,
            "request_id": self.request_id,
            "details": self.details,
        }


def validation_error(message: str, *, details: dict[str, Any] | None = None) -> ApplicationError:
    return ApplicationError("VALIDATION_ERROR", message, details=details or {})
