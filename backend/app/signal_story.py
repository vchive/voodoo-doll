"""Authored tutorial inspired by Charles Dickens' public-domain *The Signal-Man*.

The chapter is an original adaptation: the railway warning, a tired signalman,
and the player's evidence work are new fiction.  This module owns only the
bounded, deterministic story state.  The WorldKernel remains the authority for
rooms, time, schedules and events; no model is required to finish the chapter.
"""
from __future__ import annotations

import copy
import time
from typing import Any, Mapping, Optional

from .domain.models import Event, ValidationError, WorldState
from .world.clock import clock_snapshot, default_clock

SIGNAL_TEMPLATE_ID = "signal-rain-v1"
SIGNAL_TEMPLATE_VERSION = 1
STORY_TITLE = "红灯下的第三次回声"
STORY_DESCRIPTION = (
    "改编自狄更斯《信号员》的原创开放世界教程。暴雨夜里，一盏被忽略的红灯、"
    "一段录音和一份提前送达的回执，把主人公带进三天的车站生活。你要在自己的工作、"
    "NPC 的时间表和可核验的证据之间作出选择。"
)
SIGNAL_STEPS = (
    "arrival", "depart", "station", "signal-clue", "office", "dossier", "meeting",
    "day1-choice", "day1-home", "sleep1", "day2-start", "day2-station", "day2-kitchen",
    "day2-office", "sleep2", "day3-archive", "day3-hearing", "day3-decision", "day3-home", "complete",
)
SIGNAL_ROOMS = {"arrival": "parlor", "depart": "parlor", "station": "station", "signal-clue": "station",
                "office": "office", "dossier": "office", "meeting": "office", "day1-choice": "office",
                "day1-home": "home", "sleep1": "home", "day2-start": "home", "day2-station": "station",
                "day2-kitchen": "kitchen", "day2-office": "office", "sleep2": "home", "day3-archive": "office",
                "day3-hearing": "office", "day3-decision": "office", "day3-home": "home"}


def _line(speaker: str, kind: str, text: str) -> dict:
    return {"speakerId": speaker, "kind": kind, "text": text}


def _action(identifier: str, label: str, intent: str, minutes: Optional[int], reason: str = "") -> dict:
    return {"id": identifier, "label": label, "intent": intent, "minutes": minutes, "reason": reason}


def _names(state: WorldState) -> dict:
    raw = state.metadata.get("profile", {}).get("names", {})
    return raw if isinstance(raw, Mapping) else {}


def _clock_set(state: WorldState, day: int, minute: int) -> dict:
    now = time.time()
    old = state.metadata.get("clock", {})
    clock = {"day": day, "minute": minute, "timezone": "Asia/Shanghai", "speed": 1,
             "clockVersion": int(old.get("clockVersion", 0)) + 1, "anchorEpoch": now,
             "anchorDay": day, "anchorMinute": minute}
    state.metadata["clock"] = clock
    return clock


def signal_schedules() -> list[dict]:
    """Published timetable. Intervals are half-open [start,end)."""
    def block(agent: str, day: int, start: int, end: int, room: str, activity: str) -> dict:
        return {"id": f"{agent}-signal-{day}-{start}", "agentId": agent,
                "recurrence": {"kind": "daily", "days": [day]}, "startMinute": start,
                "endMinute": end, "location": {"roomId": room}, "activity": activity, "priority": 10}
    return [
        block("A", 1, 540, 600, "office", "signal-review"), block("A", 1, 600, 1440, "home", "care"),
        block("B", 1, 0, 1440, "home", "rest"), block("C", 1, 0, 1440, "home", "rest"),
        block("A", 2, 0, 1440, "home", "care"), block("B", 2, 600, 720, "kitchen", "recording"),
        block("B", 2, 720, 1440, "home", "work"), block("C", 2, 540, 660, "station", "handover"),
        block("C", 2, 660, 1440, "bar", "rest"), block("A", 3, 540, 720, "office", "hearing"),
        block("A", 3, 720, 1440, "home", "care"), block("B", 3, 0, 1440, "home", "rest"),
        block("C", 3, 0, 1440, "bar", "rest"),
    ]


def is_signal_template(state: WorldState) -> bool:
    return state.metadata.get("narrative", {}).get("templateId") == SIGNAL_TEMPLATE_ID


def initialize_story(state: WorldState, metadata: Mapping[str, Any], draft_id: str) -> None:
    profile = metadata.get("singlePlayerProfile")
    if not isinstance(profile, Mapping) or metadata.get("templateId") != SIGNAL_TEMPLATE_ID:
        return
    state.metadata["profile"] = {**copy.deepcopy(dict(profile)), "onboardingPhase": "names-confirmed"}
    state.metadata["singlePlayerStoryDraftId"] = draft_id
    state.metadata["narrative"] = {
        "templateId": SIGNAL_TEMPLATE_ID, "version": SIGNAL_TEMPLATE_VERSION, "step": "arrival",
        "startedDay": 1, "day": 1, "completed": False, "ending": None, "choice": None,
        "finalChoice": None, "day2Route": None, "facts": {
            "passSeen": False, "signalNotice": False, "manualRed": False, "dossierRead": False,
            "manualWarning": False, "tapeHeard": False, "auditSaved": False, "receiptSeen": False,
        }, "clues": [], "missedWindows": [],
    }
    state.metadata["clock"] = default_clock()
    state.metadata["schedules"] = {"version": state.metadata.get("schedules", {}).get("version", 0) + 1,
                                   "blocks": signal_schedules()}
    state.metadata.setdefault("publishedWorld", {})["schedules"] = copy.deepcopy(state.metadata["schedules"])
    state.metadata["activation"] = {"leases": {}, "agents": {}, "enabled": True}
    state.metadata["presenceProjections"] = {}
    state.room_id = "parlor"
    for actor in ("YOU", "PLAYER_DOLL", "A", "B", "C"):
        if actor in state.agents:
            state.agents[actor].room_id = "parlor"
            state.agents[actor].active = True
    state.present = ["YOU", "A", "B", "C"]
    state.environment.update(weather="rain", light="warm", sound="distant-trains")
    for door_id in (key for key in state.objects if key == "door" or key.endswith("Door")):
        if door_id in state.objects:
            state.objects[door_id]["isOpen"] = False
            state.objects[door_id].pop("lastAction", None)
    state.metadata.pop("playerZoneId", None)
    state.metadata.pop("mobility", None)
    install_props(state)


def install_props(state: WorldState) -> None:
    # Props are ordinary registered objects. Their actions still go through
    # normalize_player_action and the Kernel transaction.
    state.objects.update({
        "signal-lever": {"roomId": "station", "actions": ["look", "touch", "use"],
                         "label": "信号机手柄", "reveals": "红灯记录和一枚磨损的黄铜钥匙。"},
        "handover-book": {"roomId": "station", "actions": ["look", "use"],
                          "label": "交班簿", "reveals": "06-17，手写‘手动红灯’，签名被雨水晕开。"},
        "dossier": {"roomId": "office", "actions": ["look", "use"],
                    "label": "事故档案夹", "reveals": "06-17事故报告、明日收件回执和一张未寄出的便笺。"},
        "recorder": {"roomId": "kitchen", "actions": ["look", "use"],
                      "label": "旧录音机", "reveals": "磁带标着 06-17，播放键还没有按下。"},
    })
    state.objects["desk"].update(label="档案馆事故档案桌", reveals="今日校对的是 06-17 事故报告和明日收件回执。")


def action_minutes(action: str, payload: Mapping[str, Any]) -> int:
    if payload.get("sleepUntil"):
        return 120
    if action == "use" and payload.get("objectId") in ("dossier", "recorder") and payload.get("verb") == "use":
        return 8
    if action == "use" and payload.get("objectId") == "desk":
        return 10
    if action == "move":
        return 5
    if action in ("ask", "tell"):
        return 3
    if action == "observe" and payload.get("waitMinutes"):
        return int(payload["waitMinutes"])
    return 2


def _append(n: dict, clue: str) -> None:
    if clue not in n.setdefault("clues", []):
        n["clues"].append(clue)


def _deadline_missed(n: Mapping[str, Any], clock: Mapping[str, Any]) -> Optional[str]:
    step = n.get("step")
    day, minute = int(clock.get("day", 1)), int(clock.get("minute", 0))
    if step in SIGNAL_STEPS[:8] and (day != 1 or minute >= 600):
        return "day1-meeting"
    if step == "day2-station" and "day2-station" not in n.get("missedWindows", []) and (day != 2 or minute >= 660):
        return "day2-station"
    if step == "day2-kitchen" and (day != 2 or minute >= 720):
        return "day2-kitchen"
    if step in ("day3-archive", "day3-hearing", "day3-decision") and (day != 3 or minute >= 720):
        return "day3-hearing"
    return None


def _mark_missed(n: dict, window: str) -> None:
    if window not in n.setdefault("missedWindows", []):
        n["missedWindows"].append(window)


def expire_story(state: WorldState, clock: Mapping[str, Any]) -> Optional[str]:
    if not is_signal_template(state):
        return None
    n = state.metadata["narrative"]
    if n.get("completed"):
        return None
    missed = _deadline_missed(n, clock)
    if not missed:
        return None
    _mark_missed(n, missed)
    # Missed character windows become public evidence paths. This keeps the
    # world alive after the character leaves and never fabricates their reply.
    if missed == "day1-meeting":
        # The first conversation is the chapter's only direct hand-off from
        # Lin Chuan. Once that window closes, the player may inspect public
        # records, but cannot retroactively change this ending.
        n.update(step="complete", completed=True, ending="missed", choice="missed", finalChoice="missed")
    elif missed == "day2-kitchen":
        n["step"] = "day2-office"
    elif missed == "day3-hearing":
        n.update(step="complete", completed=True, ending="missed", finalChoice="missed")
    return guidance(state).get("passage")


def reconcile_story(state: WorldState, clock: Mapping[str, Any]) -> Optional[dict]:
    """Lifecycle hook for the kernel; only closes authored windows.

    Signal facts are written by confirmed events. Reconciliation deliberately
    does not infer a clue from a room or from a stale client cursor.
    """
    if not is_signal_template(state) or state.metadata.get("narrative", {}).get("completed"):
        return None
    n = state.metadata["narrative"]
    before = (n.get("step"), tuple(n.get("missedWindows", [])))
    expire_story(state, clock)
    after = (n.get("step"), tuple(n.get("missedWindows", [])))
    if before != after:
        return {"fromStep": before[0], "toStep": after[0], "reason": "signal_window_expired"}
    return None


def _set_next_day(state: WorldState, day: int, minute: int) -> None:
    n = state.metadata["narrative"]
    n["day"] = day
    _clock_set(state, day, minute)


def advance_story(state: WorldState, request: Event, started_clock: Mapping[str, Any]) -> Optional[str]:
    if not is_signal_template(state):
        return None
    n = state.metadata["narrative"]
    if n.get("completed"):
        return None
    old = n["step"]
    room = state.agents["YOU"].room_id
    action, payload, text, target = request.action, request.payload, request.payload.get("text", "") or "", request.target
    facts = n.setdefault("facts", {})
    now = clock_snapshot(state.metadata)
    missed = _deadline_missed(n, now)
    if missed:
        expire_story(state, now)
    elif old == "arrival" and action == "observe" and not payload.get("waitMinutes") and room == "parlor":
        facts["passSeen"] = True; n["step"] = "depart"; _append(n, "tomorrow-review")
    elif old == "depart" and action == "use" and room == "parlor" and payload.get("verb") == "open":
        n["step"] = "station"
    elif old == "station" and action == "move" and room == "station":
        n["step"] = "signal-clue"
    elif old == "signal-clue" and room == "station" and action == "use" and payload.get("objectId") in ("signal-lever", "handover-book") and payload.get("verb") in ("look", "use"):
        facts["signalNotice"] = True; facts["manualRed"] = True; n["step"] = "office"
        _append(n, "manual-red"); _append(n, "06-17")
    elif old == "office" and action == "move" and room == "office":
        n["step"] = "dossier"
    elif old == "dossier" and action == "use" and room == "office" and payload.get("objectId") in ("dossier", "desk"):
        facts["dossierRead"] = True; n["step"] = "meeting"; _append(n, "receipt")
    elif old == "meeting" and action in ("ask", "tell") and target == "A" and room == "office":
        n["step"] = "day1-choice"
    elif old == "day1-choice" and action in ("ask", "tell") and target == "A" and room == "office":
        if any(word in text for word in ("保护", "不要公开", "暂不公开", "沉默")):
            n.update(choice="protect", day2Route="protect"); _append(n, "care-first")
        elif any(word in text for word in ("审计", "公开", "证据", "保存")):
            n.update(choice="audit", day2Route="audit"); _append(n, "audit-request")
        elif any(word in text for word in ("署名", "一起查", "相信", "记录留下")):
            n.update(choice="trust", day2Route="trust"); _append(n, "joint-signature")
        else:
            # An arbitrary reply is not a hidden trust choice. Keep the
            # conversation open until the player states a bounded stance.
            return None
        n["step"] = "day1-home"
    elif old == "day1-home" and action == "move" and room == "home":
        n["step"] = "sleep1"
    elif old == "sleep1" and action == "observe" and payload.get("sleepUntil") and room == "home":
        _set_next_day(state, 2, 600); n["step"] = "day2-start"
    elif old == "day2-start" and action == "move" and room == "station":
        n.update(step="day2-station", day2Route="station")
    elif old == "day2-start" and action == "move" and room == "kitchen":
        n.update(step="day2-kitchen", day2Route="kitchen")
    elif old == "day2-station" and room == "station" and action in ("ask", "tell", "observe", "use"):
        inspected_card = action == "use" and payload.get("objectId") == "handover-book"
        heard_from_zhou = action in ("ask", "tell") and target == "C"
        if inspected_card or heard_from_zhou:
            facts["manualWarning"] = True; facts["auditSaved"] = True; _append(n, "handover-06-17"); n["step"] = "day2-office"
    elif old == "day2-kitchen" and room == "kitchen" and action in ("observe", "use", "ask"):
        heard_tape = action == "use" and payload.get("objectId") == "recorder" and payload.get("verb") == "use"
        heard_from_shen = action == "ask" and target == "B"
        if heard_tape or heard_from_shen:
            facts["tapeHeard"] = True; facts["auditSaved"] = True; _append(n, "shen-tape"); n["step"] = "day2-office"
    elif old == "day2-office" and room == "office" and action == "use" and payload.get("objectId") in ("dossier", "desk"):
        facts["auditSaved"] = True; _append(n, "evidence-file"); n["step"] = "sleep2"
    elif old == "sleep2" and action == "observe" and payload.get("sleepUntil") and room == "home":
        _set_next_day(state, 3, 540); n["step"] = "day3-archive"
    elif old == "day3-archive" and room == "office" and action == "use" and payload.get("objectId") in ("dossier", "desk"):
        facts["receiptSeen"] = True; _append(n, "future-receipt"); n["step"] = "day3-hearing"
    elif old == "day3-hearing" and room == "office" and action in ("ask", "tell") and target == "A":
        n["step"] = "day3-decision"
    elif old == "day3-decision" and room == "office" and action in ("ask", "tell") and target == "A":
        if any(word in text for word in ("保护", "不要公开", "暂不公开", "沉默")):
            final = "protect"
        elif any(word in text for word in ("审计", "公开", "证据", "保存")) and facts.get("auditSaved"):
            final = "audit"
        elif any(word in text for word in ("署名", "一起查", "相信", "写回", "记录留下")) and facts.get("manualRed") and facts.get("dossierRead"):
            final = "trust"
        else:
            return None
        n["finalChoice"] = final
        # Missing the first face-to-face window is a durable consequence. The
        # player may still inspect public evidence and express a stance, but
        # cannot rewrite the missed ending as if the NPC had been present.
        if n.get("ending") != "missed":
            n.update(ending=final, choice=final)
        n["step"] = "day3-home"
    elif old == "day3-home" and action == "move" and room == "home":
        n.update(step="complete", completed=True)
    if n.get("step") != old:
        return guidance(state).get("passage")
    return None


def story_response(state: WorldState, actor: str, request: Event) -> Optional[str]:
    if not is_signal_template(state) or actor not in ("A", "B", "C"):
        return None
    n = state.metadata["narrative"]
    room = state.agents["YOU"].room_id
    if state.agents[actor].room_id != room:
        return None
    facts = n.get("facts", {})
    if actor == "C":
        if room == "station" and n.get("day", 1) == 2:
            return "06-17 不是鬼故事，是我在暴雨里看到的一次手动红灯。车停住了，却没人把原因写进正式报告。交班簿在手边，你可以自己核对。"
        return "我不在检票口时，不会替自己补一句话。公开的交班簿还在车站，去那里看会比听传闻可靠。"
    if actor == "B":
        if room == "kitchen" and n.get("day", 1) == 2:
            return "录音里有一个信号员的声音：‘别下来。’那不是幽灵，是有人在红灯亮起时喊给乘客听的。录音结束后我还要去工作。"
        return "我只在厨房的午饭前有空。想听清录音，就按我的时间来。"
    if n.get("step") in ("meeting", "day1-choice") and room == "office":
        return "原稿写着：21:11 警报，21:14 有人喊话，21:17 顾师傅扳下手动红灯。我没有在现场，却把最后一行改成了设备故障。我怕丢掉工作，父亲每周的治疗费也靠这份工资。"
    if n.get("step") == "day3-hearing":
        return "明日回执不是预言，是我提前送出的更正预约。我们只能把实际拿到的材料写进去，缺的就列为待查。三分钟里发生的事，不该再用一个词抹平。"
    if n.get("ending") == "protect":
        return "谢谢你先替我挡住审查，但沉默只能换来今晚。手动红灯的记录还等着有人把它写回去。"
    if n.get("ending") == "audit":
        return "公开审计会改变我的工作。把取得的材料和还没查清的地方分别列好，这次我不会再改掉不愿意面对的字。"
    return "如果你愿意和我一起署名，我会把父亲的照护安排也写进说明。真相不能只靠一个人记住。"


def _dialogue(state: WorldState, step: str, objective: str) -> dict:
    from .signal_content import render_scene
    from .world.schedule import project_presence
    projected = state.clone()
    project_presence(projected, clock_snapshot(projected.metadata))
    room = projected.agents["YOU"].room_id
    here = [actor for actor in projected.present if projected.agents[actor].room_id == room]
    n = state.metadata["narrative"]
    rendered = render_scene(step, n, room, here, _names(state))
    identity = ":".join([step, room, ",".join(here), str(n.get("ending")), ",".join(n.get("missedWindows", []))])
    return {"dialogueId": f"{SIGNAL_TEMPLATE_ID}:dialogue-v{SIGNAL_TEMPLATE_VERSION}:{identity}", "dialogue": rendered}


def scene_actions(state: WorldState) -> list[dict]:
    room = state.agents["YOU"].room_id
    n = state.metadata["narrative"]
    step = n.get("step", "arrival")
    actions: list[dict] = [_action("observe", "观察这里", "观察周围", 2, "查看当前公开信息")]
    if step == "arrival" and room == "parlor":
        actions = [_action("signal-arrival", "查看通行证与便笺", "观察周围", 2)]
    elif room == "parlor" and step == "depart":
        actions = [_action("signal-depart", "打开出门的门", "开门", 2)]
    elif step == "station" and room != "station":
        actions = [_action("signal-station", "去地铁站", "去地铁站", 5)]
    elif step == "signal-clue" and room == "station":
        actions = [_action("signal-handover", "查看交班簿和信号机", "看看交班簿", 2)]
    elif step == "office" and room != "office":
        actions = [_action("signal-office", "去档案馆办公室", "去办公室", 5)]
    elif step == "dossier" and room == "office":
        actions = [_action("signal-dossier", "查看事故档案夹", "使用事故档案夹", 8)]
    elif step == "meeting" and room == "office":
        a = _names(state).get("A", "林川")
        actions = [_action("signal-meeting", f"问{a}：红灯记录怎么回事？", f"问{a}：昨晚红灯记录怎么回事？", 3)]
    elif step == "day1-choice" and room == "office":
        a = _names(state).get("A", "林川")
        actions = [_action("signal-trust", "共同署名，留下红灯记录", f"问{a}：我们共同署名，把记录留下。", 3),
                   _action("signal-audit", "公开审计，保存全部证据", f"问{a}：公开审计，保存全部证据。", 3),
                   _action("signal-protect", "先保护林川，暂不公开", f"问{a}：我先保护你，暂时不要公开。", 3)]
    elif step == "day1-home" and room != "home":
        actions = [_action("signal-home", "回家整理证据", "回家", 5)]
    elif step == "sleep1" and room == "home":
        actions = [_action("signal-sleep1", "睡觉到第二天 10:00", "睡觉到第二天", None, "结束今天的安排，直接到翌日 10:00")]
    elif step == "day2-start" and room == "home":
        actions = [_action("signal-day2-station", "去车站找周野（10:00–11:00）", "去地铁站", 5),
                   _action("signal-day2-kitchen", "去厨房找沈青（10:00–12:00）", "去厨房", 5)]
    elif step == "day2-station" and room == "station":
        actions = [_action("signal-day2-card", "问周野或查看交班簿", "问周野：06-17 的手动红灯是什么？", 3),
                   _action("signal-day2-public", "查看公开交班簿", "看看交班簿", 2)]
    elif step == "day2-kitchen" and room == "kitchen":
        actions = [_action("signal-day2-tape", "听沈青的录音", "使用录音机", 8)]
    elif step == "day2-office" and room != "office":
        actions = [_action("signal-day2-office", "回办公室整理证据", "去办公室", 5)]
    elif step == "day2-office" and room == "office":
        actions = [_action("signal-day2-file", "校对并归档已经取得的证据", "使用事故档案夹", 8)]
    elif step == "sleep2" and room != "home":
        actions = [_action("signal-day2-home", "回家，结束今天的调查", "回家", 5)]
    elif step == "sleep2" and room == "home":
        actions = [_action("signal-sleep2", "睡觉到第三天 09:00", "睡觉到第三天", None, "结束今天的安排，直接到翌日 09:00")]
    elif step == "day3-archive" and room != "office":
        actions = [_action("signal-day3-office", "去办公室查看明日回执", "去办公室", 5)]
    elif step == "day3-archive" and room == "office":
        actions = [_action("signal-day3-receipt", "查看明日收件回执原件", "使用事故档案夹", 8)]
    elif step == "day3-hearing" and room == "office":
        a = _names(state).get("A", "林川")
        actions = [_action("signal-day3-hearing", f"问{a}：为什么提前送来回执？", f"问{a}：为什么提前送来明日回执？", 3)]
    elif step == "day3-decision" and room == "office":
        a = _names(state).get("A", "林川")
        actions = [_action("signal-final-trust", "共同署名，恢复手动红灯记录", f"问{a}：共同署名，把红灯记录写回去。", 3),
                   _action("signal-final-audit", "公开审计，所有证据入档", f"问{a}：公开审计，所有证据一起入档。", 3),
                   _action("signal-final-protect", "保护林川，暂不公开", f"问{a}：先保护你，暂时不要公开。", 3)]
    elif step == "day3-home" and room != "home":
        actions = [_action("signal-final-home", "回家收好最后一页", "回家", 5)]
    elif step == "complete":
        actions = [_action("observe", "继续自由探索", "观察周围", 2)]
    expected_room = SIGNAL_ROOMS.get(step)
    if step == "day2-start" and room != "home":
        actions = [_action("signal-return", "回家查看今日安排", "回家", 5)]
    elif expected_room and room != expected_room and not any(item["intent"].startswith(("去", "回")) for item in actions):
        from .narrative import ROOM_LABELS
        actions = [_action("signal-return", "返回" + ROOM_LABELS[expected_room], "去" + ROOM_LABELS[expected_room], 5)]
    if step == "day2-station" and "day2-station" in n.get("missedWindows", []) and room == "station":
        actions = [_action("signal-day2-public", "周野已交班，查看公开交班簿", "看看交班簿", 2)]
    return actions


def journal(n: Mapping[str, Any]) -> list[dict]:
    labels = {
        "tomorrow-review": ("明天的通行证", "日期比今天早到一天，背面有红灯图案；来源待查。"),
        "manual-red": ("公开信号记录", "21:17 的手动红灯，与印刷告示的设备延迟不一致。"),
        "06-17": ("事故编号", "车站与档案馆记录使用同一个 06-17 编号。"),
        "receipt": ("校对原稿", "21:11 警报、21:14 呼喊、21:17 手动红灯；修订稿合并了记录。"),
        "audit-request": ("第一天的立场", "要求公开核验，最终决定留到第三天。"),
        "care-first": ("第一天的立场", "先保护照护安排，最终决定留到第三天。"),
        "joint-signature": ("第一天的立场", "愿意共同署名，仍需核验证据。"),
        "handover-06-17": ("第二天交班卡", "顾师傅是信号员，周野是交班见证人；保留手动红灯备注。"),
        "shen-tape": ("沈青的录音", "确认听过 21:14 的呼喊；不确定的声音与公开用途仍需注明。"),
        "evidence-file": ("证据归档", "只归入实际核验的材料，缺项仍空白。"),
        "future-receipt": ("回执原件", "编号对应档案馆的更正预约，证明登记来源。"),
    }
    return [{"id": key, "title": labels[key][0], "text": labels[key][1]} for key in n.get("clues", []) if key in labels]


def guidance(state: WorldState) -> dict:
    if not is_signal_template(state):
        return {}
    n = state.metadata["narrative"]
    step = n.get("step", "arrival")
    names = _names(state)
    a, b, c = names.get("A", "林川"), names.get("B", "沈青"), names.get("C", "周野")
    room = state.agents["YOU"].room_id
    titles = {
        "arrival": ("第一天 · 日期不对的纸片", "查看通行证和便笺，开始自己的工作。"), "depart": ("第一天 · 雨中的通勤", "开门去车站，沿着自己的时间表行动。"),
        "station": ("第一天 · 红灯", "到车站查看公开的信号记录。"), "signal-clue": ("第一天 · 21:17", "核对交班簿里的手动红灯。"),
        "office": ("第一天 · 档案馆", "回办公室，完成今天的事故档案校对。"), "dossier": ("第一天 · 三个时间点", "查看事故档案夹，再问林川。"),
        "meeting": ("第一天 · 校对员的改写", "十点前听完林川的解释。"), "day1-choice": ("第一天 · 写下还是擦掉", "决定如何处理红灯记录。"),
        "day1-home": ("第一天 · 把证据带回家", "回家，准备第二天的线索。"), "sleep1": ("第一天 · 明确睡去", "睡觉到第二天十点。"),
        "day2-start": ("第二天 · 两个见证人", "选择车站的周野或厨房的沈青。"), "day2-station": ("第二天 · 交班前", "在十一点前问周野或查看交班簿。"),
        "day2-kitchen": ("第二天 · 录音", "在十二点前听沈青的录音。"), "day2-office": ("第二天 · 证据合页", "回办公室把证据放在同一份档案里。"),
        "sleep2": ("第二天 · 明天的决定", "睡觉到第三天九点。"), "day3-archive": ("第三天 · 明日回执", "在办公室查看回执原件。"),
        "day3-hearing": ("第三天 · 林川的解释", "在中午前听完最后一段说明。"), "day3-decision": ("第三天 · 最后一页", "共同署名、公开审计，或保护林川。"),
        "day3-home": ("第三天 · 雨停以前", "回家收好记录，结束教程。"), "complete": ("教程完成 · 城市继续运转", "继续自由探索，已确认的证据和选择会保留。"),
    }
    chapter, objective = titles.get(step, titles["arrival"])
    dialogue = _dialogue(state, step, objective)
    passage = dialogue["dialogue"][0]["text"]
    clock = clock_snapshot(state.metadata)
    return {"title": STORY_TITLE, "description": STORY_DESCRIPTION, "chapter": chapter, "objective": objective,
            "passage": passage, **dialogue, "completed": step == "complete",
            "ending": n.get("ending"), "actions": scene_actions(state),
            "playerRoutine": "今日身份：档案馆校对员 · 故事日程：第" + str(clock.get("day", 1)) + "天",
            "scheduleHint": f"{a}：第1天 09:00–10:00办公室；{c}：第2天 10:00–11:00车站；{b}：第2天 10:00–12:00厨房；第3天{a} 09:00–12:00办公室。错过谈话会留下失约结尾；公开记录仍可查看。",
            "journal": journal(n)}


def validate_saved_narrative(value: Any) -> dict:
    if not isinstance(value, Mapping) or value.get("templateId") != SIGNAL_TEMPLATE_ID or value.get("version") != SIGNAL_TEMPLATE_VERSION:
        raise ValidationError("saved signal narrative is invalid", "invalid_save_payload")
    if value.get("step") not in SIGNAL_STEPS or type(value.get("completed")) is not bool:
        raise ValidationError("saved signal narrative step is invalid", "invalid_save_payload")
    if value.get("ending") not in (None, "trust", "audit", "protect", "missed"):
        raise ValidationError("saved signal narrative ending is invalid", "invalid_save_payload")
    if (value.get("step") == "complete") != value.get("completed"):
        raise ValidationError("saved signal narrative completion is invalid", "invalid_save_payload")
    facts = value.get("facts")
    if not isinstance(facts, Mapping) or any(type(facts.get(key)) is not bool for key in (
        "passSeen", "signalNotice", "manualRed", "dossierRead", "manualWarning", "tapeHeard", "auditSaved", "receiptSeen"
    )):
        raise ValidationError("saved signal narrative facts are invalid", "invalid_save_payload")
    for key in ("choice", "finalChoice"):
        if value.get(key) not in (None, "trust", "audit", "protect", "missed"):
            raise ValidationError("saved signal choice is invalid", "invalid_save_payload")
    for key in ("clues", "missedWindows"):
        items = value.get(key)
        if not isinstance(items, list) or len(items) > 64 or any(not isinstance(item, str) or len(item) > 100 for item in items):
            raise ValidationError("saved signal clues are invalid", "invalid_save_payload")
    if type(value.get("day")) is not int or value["day"] not in (1, 2, 3):
        raise ValidationError("saved signal day is invalid", "invalid_save_payload")
    if value.get("completed") and value.get("ending") is None:
        raise ValidationError("saved signal ending is required", "invalid_save_payload")
    return copy.deepcopy(dict(value))
