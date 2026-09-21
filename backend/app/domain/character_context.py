"""Small, explicit character identity and present-life context.

This module never exports narrative facts, future timetable entries, the whole
profile metadata, or another character's memory. It does not plan or act.
"""

from __future__ import annotations

import re
from typing import Any, Dict, Mapping, Optional

from .models import WorldState


def _mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _text(value: Any, fallback: str = "", limit: int = 240) -> str:
    return value.strip()[:limit] if isinstance(value, str) and value.strip() else fallback


def _signal_a(state: WorldState, actor: str) -> bool:
    metadata = _mapping(getattr(state, "metadata", None))
    return actor == "A" and _mapping(metadata.get("narrative")).get("templateId") == "signal-rain-v1"


def build_character_context(state: WorldState, viewer: str) -> Dict[str, Any]:
    """Return only this role's identity and its current published situation."""
    agent = state.agents.get(viewer)
    if agent is None:
        return {}
    names = _mapping(_mapping(state.metadata.get("profile")).get("names"))
    character = {
        "id": viewer,
        "name": _text(names.get(viewer), viewer, 32),
        "persona": "你是这个世界里的一位角色，只讲自己可知的事情，保留自己的立场。",
        "traits": [_text(item, limit=80) for item in agent.profile.traits if isinstance(item, str)][:12],
        "goals": [_text(item, limit=120) for item in agent.profile.goals if isinstance(item, str)][:12],
    }
    if _signal_a(state, viewer):
        character.update({
            "persona": "档案馆校对员，与玩家是同事。说话克制、具体，关心手头工作，也保留个人生活边界。",
            "traits": ["谨慎", "克制", "认真"],
            "goals": ["完成当下的校对工作", "留出照顾家人的时间"],
        })
    projection = _mapping(_mapping(state.metadata.get("presenceProjections")).get(viewer))
    # A stale projection from another room must not describe this encounter.
    activity = _text(projection.get("activity"), "available", 80) if projection.get("roomId") == agent.room_id else "available"
    clock = _mapping(state.metadata.get("clock"))
    day, minute = clock.get("day"), clock.get("minute")
    situation = {
        "roomId": agent.room_id,
        "activity": activity,
        "clock": {
            "day": day if type(day) is int and day >= 1 else 1,
            "minute": minute if type(minute) is int and 0 <= minute < 1440 else 0,
        },
    }
    return {"character": character, "situation": situation}


def _request_text(request: Any) -> str:
    payload = getattr(request, "payload", {})
    return _text(_mapping(payload).get("text"), limit=600)


def _last_player_words(memory: Any) -> Optional[str]:
    """Recall only a committed YOU utterance in this character's own memory.

    The old memory schema stores summaries rather than typed actions. Only
    unambiguous directed-speech prefixes are quoted, never movement/action
    summaries or uncommitted events supplied with the current request.
    """
    if not isinstance(memory, (list, tuple)):
        return None
    for raw in reversed(memory):
        item = _mapping(raw)
        if not item.get("eventId") or not item.get("turnId") or item.get("channel") not in ("public", "private"):
            continue
        summary = item.get("summary")
        if not isinstance(summary, str) or not summary.startswith("YOU："):
            continue
        words = summary[len("YOU："):].strip()
        if not re.match(r"^(?:问|询问|告诉|对|和)", words):
            continue
        if re.search(r"(?:记得|记住|上次|刚才|之前).{0,12}(?:说|讲|聊|什么)|(?:说|讲|聊)过", words):
            continue
        # Keep the words as an attributed quote, not proof their claims are true.
        words = re.split(r"[：:]", words, maxsplit=1)[-1].strip()
        return words[:100] + ("…" if len(words) > 100 else "")
    return None


def signal_a_life_response(actor: str, request: Any, state: WorldState) -> Optional[str]:
    """Bounded life-chat fallback for signal A; other roles/templates unchanged."""
    if not _signal_a(state, actor):
        return None
    context = _mapping(getattr(request, "context", None))
    if context.get("viewer") == actor:
        situation = _mapping(context.get("situation"))
        memory = context.get("memory", [])
    else:
        # Compatibility with the old Event hook: still use only A's own state.
        situation = build_character_context(state, actor)["situation"]
        memory = state.agents[actor].memory
    text = re.split(r"[：:]", _request_text(request), maxsplit=1)[-1].strip()
    activity = situation.get("activity", "available")
    working = activity in ("work", "signal-review", "hearing")

    if re.search(r"(?:记得|记住|上次|刚才|之前).{0,12}(?:说|讲|聊|什么)|(?:说|讲|聊)过", text):
        remembered = _last_player_words(memory)
        if remembered:
            return f"记得。你说过：『{remembered}』这句话我听进去了。"
        return "我还没有记下你之前说过的具体话。你可以再告诉我一遍，我会认真听。"
    if any(word in text for word in ("父亲", "爸爸", "家人", "家里人")):
        return "谢谢你关心父亲。照顾家人的安排我想自己慢慢说，今天先别替我担心。"
    if any(word in text for word in ("工作", "校对", "忙", "上班")):
        if working:
            return "我在核对手边的文字。校对很容易漏掉一个字，所以有点忙；短短聊几句还是可以的。"
        if activity == "care":
            return "这会儿不是我的办公时间，我正留时间给家里的安排。工作的事，等回到办公室再细聊吧。"
        return "这会儿没有正在进行的校对安排。工作上的具体情况，我只想说自己确定的部分。"
    if any(word in text for word in ("安排", "计划", "现在在", "做什么", "干什么", "方便聊", "接下来")):
        if working:
            return "现在我在办公室，手头还有文字要核对。可以聊一会儿，但我也得留时间把它看仔细。"
        if activity == "care":
            return "我现在把时间留给家里。今天的事情想慢慢安排，你若有话，可以先说给我听。"
        return "我在这里，暂时没有需要向你说明的固定安排。你想聊什么？"
    if any(word in text for word in ("你好", "早上好", "早安", "下午好", "晚上好", "今天怎么样", "还好吗")):
        return "你好。见到熟人会轻松一点。今天想先好好把眼前的事做完，你呢？"
    if any(word in text for word in ("累", "辛苦", "休息", "喝水")):
        return "谢谢你惦记着。我有点绷得紧，聊几句能松一口气；眼前的事情还得慢慢来。"
    if not re.search(r"[？?]|吗|什么|怎么|为何|为什么|是否|哪|呢", text):
        return "嗯，我听着。你愿意再多说一点吗？"
    return "这个问题我现在还没有确定的答案。我们可以聊聊眼前的工作、今天的安排，或者你刚才想告诉我的事。"
