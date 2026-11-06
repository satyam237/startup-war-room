"""Sliding-window rate limiter, per key (the client IP), kept in process memory.

`allowed` only reads and `record` only writes, so a caller can refuse a request before
doing paid work and count it only once it has earned a slot. In-process like the rest of
v1 state, which is why the app runs one worker. Expired keys are swept out so memory
stays bounded by the traffic of one window.
"""

import ipaddress
import time
from collections import deque
from collections.abc import Callable

from fastapi import Request


class RateLimiter:
    def __init__(self, limit: int, window_s: float, clock: Callable[[], float] = time.monotonic) -> None:
        self.limit = limit
        self.window_s = window_s
        self._clock = clock
        self._hits: dict[str, deque[float]] = {}
        self._last_sweep = clock()

    def _live(self, key: str, now: float) -> deque[float] | None:
        hits = self._hits.get(key)
        if hits is None:
            return None
        while hits and hits[0] <= now - self.window_s:
            hits.popleft()
        if not hits:
            del self._hits[key]
            return None
        return hits

    def _sweep(self, now: float) -> None:
        if now - self._last_sweep < self.window_s:
            return
        self._last_sweep = now
        for key in list(self._hits):
            self._live(key, now)

    def allowed(self, key: str) -> bool:
        """True if `key` has a slot left. Does not use it."""
        hits = self._live(key, self._clock())
        return hits is None or len(hits) < self.limit

    def record(self, key: str) -> None:
        now = self._clock()
        self._sweep(now)
        self._hits.setdefault(key, deque()).append(now)

    def check(self, key: str) -> bool:
        """`allowed` then `record`, for callers with nothing to do in between."""
        if not self.allowed(key):
            return False
        self.record(key)
        return True

    def retry_after_s(self, key: str) -> int:
        """Seconds until `key` has a slot again (at least 1)."""
        now = self._clock()
        hits = self._live(key, now)
        if hits is None or len(hits) < self.limit:
            return 1
        return max(1, int(hits[len(hits) - self.limit] + self.window_s - now) + 1)

    def tracked(self) -> int:
        return len(self._hits)


def client_ip(request: Request, trusted_hops: int) -> str:
    """The caller's address, for rate limiting.

    The socket peer is the only address a client cannot choose. With `trusted_hops` proxies in
    front (Heroku's router is 1), each appends the address it saw to X-Forwarded-For, so the
    entry `trusted_hops` from the right is the first one our own infrastructure vouches for;
    anything to its left is client-supplied. With 0 hops the header is ignored. A missing or
    malformed header falls back to the socket peer.
    """
    peer = request.client.host if request.client else "unknown"
    header = request.headers.get("x-forwarded-for")
    if trusted_hops < 1 or not header:
        return peer
    entries = [e.strip() for e in header.split(",")]
    if len(entries) < trusted_hops:
        return peer
    try:
        return str(ipaddress.ip_address(entries[-trusted_hops]))
    except ValueError:
        return peer
