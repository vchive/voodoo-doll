"""Deterministic local agents and environment resolver.

These rules are intentionally modest.  They guarantee a playable contract
without pretending that generated prose or relationships are authoritative.
"""

from dataclasses import dataclass
from typing import Any, Dict, Optional
import hashlib

from .actions import validate_agent_response
from .events import stable_seed
from .models import Event, WorldState


@dataclass(frozen=True)
class AgentProposal:
    actor: str
    action: str
    target: str
    text: Optional[str]
    source: str = "local"


class RuleAgent:
    """A local policy with stable output for a given turn and role."""

    def propose(self, actor: str, request: Event, state: WorldState) -> AgentProposal:
        profile = state.agents[actor].profile
        seed = stable_seed(request.turn_id, actor)
        choices = ["answer", "deny", "counter", "silence", "refuse"]
        # Traits bias behavior while the hash keeps it deterministic.
        if "defensive" in profile.traits:
            choices = ["deny", "counter", "refuse", "silence", "answer"]
        elif "evasive" in profile.traits:
            choices = ["lie", "deny", "silence", "counter", "answer"]
        elif "curious" in profile.traits:
            choices = ["answer", "counter", "accept", "silence", "refuse"]
        action = choices[seed % len(choices)]
        text = None
        if action == "answer":
            text = "我听到了，但我会按自己的方式回答。"
        elif action == "deny":
            text = "这件事不是你说的那样。"
        elif action == "lie":
            text = "我没有什么需要解释的。"
        elif action == "counter":
            text = "你为什么只问我，不问问自己？"
        elif action == "refuse":
            text = "我现在不想谈这个。你可以换个话题，或者等我忙完。"
        elif action == "silence":
            text = "他停下手里的动作，看了一眼墙上的钟，暂时没有回答。也许换个话题会好些。"
        elif action == "accept":
            text = "好，我愿意听你继续说。"
        return AgentProposal(actor, action, "YOU", text)


class EnvironmentResolver:
    version = "local-2"

    def feedback(self, request: Event, state: WorldState, seed: int) -> Dict[str, Any]:
        action = request.action
        if action == "move":
            from ..narrative import ROOM_LABELS
            room = state.agents["YOU"].room_id
            return {"text": "你来到" + ROOM_LABELS.get(room, room) + "。可以先观察这里，或打开面前的门。", "ambient": "footsteps"}
        if action in ("use", "use_object", "toggle"):
            object_id = request.payload.get("object", request.payload.get("objectId", "object"))
            verb = request.payload.get("verb", "touch")
            definition = state.objects.get(object_id, {})
            labels = {"lamp": "台灯", "bell": "铃铛", "altar": "置物台", "window": "窗户", "table": "桌子",
                      "desk": "办公桌", "kettle": "水壶", "streetlight": "路灯"}
            label = definition.get("label", labels.get(object_id, "这件物品"))
            reveals = definition.get("reveals", "你仔细查看了它的表面。")
            descriptions = {"open": f"{label}打开了。{reveals}", "close": f"你关上了{label}。",
                            "knock": f"你轻敲{label}，声音在附近回响。", "look": reveals,
                            "on": f"你打开了{label}，它开始运作。", "off": f"你关闭了{label}。",
                            "touch": f"你伸手碰了碰{label}。", "ring": f"{label}响起了清脆的声音。",
                            "use": f"你坐到{label}前，处理完手边的工作。"}
            return {"text": descriptions.get(verb, f"你操作了{label}。"), "object": object_id, "verb": verb}
        if action == "look":
            return {"text": "你看见周围的物件和在场者。", "ambient": "look"}
        if action == "wait":
            return {"text": "时间向前走了一小段。", "ambient": "wait"}
        if action in ("operate_vehicle", "board", "travel", "alight"):
            mobility = request.payload.get("mobility", {})
            kind = mobility.get("kind", "交通工具")
            mode = mobility.get("mode", "travel")
            if action == "board":
                text = f"你登上了{kind}。"
            elif action == "alight":
                text = f"你从{kind}上下车，抵达了{mobility.get('toRoom', '目的地')}。"
            elif action == "travel":
                text = f"{kind}驶向下一站。"
            else:
                text = f"你驾驶{kind}前往{mobility.get('toRoom', '目的地')}。"
            return {"text": text, "ambient": mode, "mobility": mobility}
        if action == "observe":
            if request.payload.get("waitMinutes"):
                return {"text": f"你等了{request.payload['waitMinutes']}分钟。角色会按照各自的日程继续生活。", "ambient": "wait"}
            from ..narrative import DOOR_IDS, ROOM_LABELS
            room = state.agents["YOU"].room_id
            reveals = state.objects.get(DOOR_IDS.get(room), {}).get("reveals", "你可以留意这里的物件与在场人物。")
            return {"text": ROOM_LABELS.get(room, room) + "里，" + reveals + "你可以开门探索，也可以选择推荐行动。", "ambient": "look"}
        return {"text": "空气轻轻一动。", "ambient": "subtle"}
