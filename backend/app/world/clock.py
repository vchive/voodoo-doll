"""Server-owned logical clock.

The anchor is persisted in world metadata.  Clients can read the result but
cannot provide a day/minute that advances it.  `speed=1` means one game minute
per real minute, while tests and internal workers may supply a server `now`.
"""

from __future__ import annotations

import time
from typing import Any, Dict, Optional


DAY_MINUTES = 24 * 60


def default_clock(now: Optional[float] = None) -> Dict[str, Any]:
    return {
        "day": 1,
        "minute": 9 * 60,
        "timezone": "Asia/Shanghai",
        "speed": 1,
        "clockVersion": 0,
        "anchorEpoch": float(time.time() if now is None else now),
        "anchorDay": 1,
        "anchorMinute": 9 * 60,
    }


def _calculate(clock: Dict[str, Any], now: Optional[float]) -> Dict[str, Any]:
    now_value = float(time.time() if now is None else now)
    anchor = float(clock.get("anchorEpoch", now_value))
    speed = float(clock.get("speed", 1) or 0)
    elapsed_game_minutes = max(0.0, now_value - anchor) / 60.0 * speed
    total = int(clock.get("anchorMinute", clock.get("minute", 0)) + elapsed_game_minutes)
    anchor_day = int(clock.get("anchorDay", clock.get("day", 1)))
    day_offset, minute = divmod(total, DAY_MINUTES)
    return {
        "day": anchor_day + day_offset,
        "minute": minute,
        "timezone": str(clock.get("timezone", "Asia/Shanghai")),
        "speed": speed,
        "clockVersion": int(clock.get("clockVersion", 0)),
        "anchorEpoch": anchor,
        "anchorDay": anchor_day,
        "anchorMinute": int(clock.get("anchorMinute", clock.get("minute", 0))),
    }


def clock_snapshot(metadata: Dict[str, Any], now: Optional[float] = None) -> Dict[str, Any]:
    clock = metadata.get("clock") if isinstance(metadata, dict) else None
    return _calculate(dict(clock or default_clock(now)), now)


def advance_clock(metadata: Dict[str, Any], now: Optional[float] = None) -> tuple[Dict[str, Any], bool]:
    current = clock_snapshot(metadata, now)
    previous = metadata.get("clock") if isinstance(metadata, dict) else None
    old_minute = (previous or {}).get("minute")
    old_day = (previous or {}).get("day")
    changed = old_minute is None or old_day is None or (old_minute, old_day) != (current["minute"], current["day"])
    current["clockVersion"] = int((previous or {}).get("clockVersion", 0)) + (1 if changed else 0)
    metadata["clock"] = current
    return current, changed
