from __future__ import annotations

from collections import deque
from collections.abc import Callable
from datetime import UTC, datetime
from threading import Lock
from typing import Any


class RendererEventBroker:
    """Bounded in-process typed event replay for Renderer reloads."""

    def __init__(
        self,
        *,
        capacity: int = 1_000,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        if capacity < 1:
            raise ValueError("capacity must be positive")
        self._events: deque[dict[str, Any]] = deque(maxlen=capacity)
        self._clock = clock or (lambda: datetime.now(UTC))
        self._sequence = 0
        self._lock = Lock()

    def publish(self, name: str, **fields: Any) -> dict[str, Any]:
        with self._lock:
            self._sequence += 1
            event = {
                "sequence": self._sequence,
                "name": name,
                "occurred_at": self._clock().astimezone(UTC).isoformat(),
                **{key: value for key, value in fields.items() if value is not None},
            }
            self._events.append(event)
            return dict(event)

    def after(self, sequence: int, *, limit: int = 100) -> list[dict[str, Any]]:
        if sequence < 0:
            raise ValueError("sequence must not be negative")
        if limit < 1 or limit > 200:
            raise ValueError("limit must be between 1 and 200")
        with self._lock:
            return [dict(event) for event in self._events if int(event["sequence"]) > sequence][:limit]
