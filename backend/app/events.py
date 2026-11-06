"""In-process event log for one debate: an append-only list that any number of readers tail.

Every event gets an increasing `seq` from 1, which the API sends as the SSE `id`, so a
reader can resume after any seq with no duplicates and no gaps. Publishing never blocks
on readers, and a debate runs the same with no reader attached.
"""

import asyncio
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Event:
    seq: int
    event: str
    data: dict[str, Any]


class EventLog:
    def __init__(self) -> None:
        self._events: list[Event] = []
        self._closed = False
        self._changed = asyncio.Event()

    def _wake_readers(self) -> None:
        self._changed.set()
        self._changed = asyncio.Event()

    def publish(self, event: str, data: dict[str, Any]) -> int:
        if self._closed:
            raise RuntimeError(f"event log is closed; cannot publish {event!r}")
        seq = len(self._events) + 1
        self._events.append(Event(seq=seq, event=event, data=data))
        self._wake_readers()
        return seq

    async def subscribe(self, after_seq: int = 0) -> AsyncIterator[Event]:
        """Yield every event after `after_seq`, then tail until the log is closed."""
        position = max(after_seq, 0)  # seq n sits at index n - 1
        while True:
            while position < len(self._events):
                yield self._events[position]
                position += 1
            if self._closed:
                return
            await self._changed.wait()

    def close(self) -> None:
        self._closed = True
        self._wake_readers()
