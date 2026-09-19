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
            text = "我现在不想谈这个。"
        return AgentProposal(actor, action, "YOU", text)


class EnvironmentResolver:
    version = "local-1"

    def feedback(self, request: Event, state: WorldState, seed: int) -> Dict[str, Any]:
        action = request.action
        if action == "move":
            return {"text": "脚步在房间里回响。", "ambient": "footsteps"}
        if action in ("use", "use_object", "toggle"):
            object_id = request.payload.get("object", request.payload.get("objectId", "object"))
            verb = request.payload.get("verb", "touch")
            return {"text": "你对" + str(object_id) + "做了" + str(verb) + "。", "object": object_id, "verb": verb}
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
            return {"text": "房间保持安静，所有在场者都能看见彼此。", "ambient": "still"}
        return {"text": "空气轻轻一动。", "ambient": "subtle"}
