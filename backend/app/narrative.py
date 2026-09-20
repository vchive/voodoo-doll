"""Authored single-player chapter projection, kept inside Kernel transactions.

Only a confirmed template enables this story. Custom worlds receive actionable
scene suggestions, never invented story facts. No model/network is required.
"""
from __future__ import annotations

import copy
import time
from typing import Any, Dict, Mapping, Optional

from .domain.models import Event, ValidationError, WorldState
from .world.clock import clock_snapshot, default_clock

TEMPLATE_ID = "rainy-office-v1"
FULL_TEMPLATE_ID = "rainy-office-v2"
TEMPLATE_STORY = (
    "《雨停以前》：你是城市档案馆的新任校对员。上午九点，连下三日的雨还没有停，"
    "桌上却出现一张写着明天日期的通行证。巫毒娃娃小墨说：先照常去上班。"
    "同事林川留下便笺，请你十点前到办公室，谈一封未寄出的辞职信。"
    "你需要赶上他的行程，完成自己的校对工作，再决定相信他，还是追问被擦掉的那一页。"
)
FULL_TEMPLATE_STORY = (
    "《雨停以前：明天已经发生》：你是城市档案馆的新任校对员。第一天上班前，"
    "桌上出现一张写着明天日期的通行证；地铁站的末班车告示晚了三分钟，司机姓名被抹去，"
    "同事林川请你在十点前听完一封未寄出的辞职信。你要在工作、朋友和真相之间作出选择，"
    "跟着周野、沈青和林川各自的生活安排，查清那张通行证为何提前抵达。"
)
ROOM_LABELS = {
    "parlor": "客厅", "bedroom": "卧室", "hall": "走廊", "garden": "花园", "attic": "阁楼",
    "office": "办公室", "home": "家", "kitchen": "厨房", "street": "街道", "station": "地铁站", "bar": "酒吧",
}
DOOR_IDS = {room: ("door" if room == "hall" else room + "Door") for room in ROOM_LABELS}
STEPS = ("observe", "open", "station", "station-door", "office", "work", "talk", "choice", "home", "home-door", "complete")
FULL_STEPS = (
    "arrival", "depart", "station", "station-clue", "office", "work", "meeting", "day1-choice",
    "day1-home", "day2-start", "day2-station", "day2-station-clue", "day2-kitchen", "day2-recording",
    "day2-office", "day2-audit", "day2-home", "day3-archive", "day3-hearing", "day3-decision",
    "day3-home", "complete",
)


def scene_objects() -> Dict[str, dict]:
    reveals = {
        "parlor": "走廊里放着一把滴水的伞，出口通向街道。", "bedroom": "整齐的床铺旁留着一盏阅读灯。",
        "hall": "走廊尽头是通向客厅的入口。", "garden": "园中小路绕过长椅，树叶还挂着水珠。",
        "attic": "窄梯旁堆着贴有年份标签的纸箱。", "office": "办公桌、文件架和今日值班表映入眼帘。",
        "home": "玄关的鞋柜和桌上的空茶杯还在原处。", "kitchen": "水壶放在灶边，餐桌已经擦干净。",
        "street": "门外是人行道和停靠在路边的自行车。", "station": "换乘通道亮着灯，墙上贴着列车时刻表。",
        "bar": "吧台后摆着玻璃杯，靠窗的座位暂时空着。",
    }
    return {DOOR_IDS[room]: {"roomId": room, "label": "地铁站玻璃门" if room == "station" else label + "的门",
                            "actions": ["open", "close", "knock", "look"], "reveals": reveals[room]}
            for room, label in ROOM_LABELS.items()}


def template_schedules() -> list[dict]:
    definitions = {
        "A": [(0, 540, "home", "rest"), (540, 600, "office", "work"), (600, 1440, "home", "rest")],
        "B": [(0, 720, "home", "rest"), (720, 1080, "kitchen", "work"), (1080, 1440, "home", "rest")],
        "C": [(0, 540, "home", "rest"), (540, 1080, "station", "work"), (1080, 1440, "bar", "rest")],
    }
    return [{"id": f"{agent}-rain-{start}", "agentId": agent, "recurrence": {"kind": "daily", "days": list(range(1, 8))},
             "startMinute": start, "endMinute": end, "location": {"roomId": room}, "activity": activity, "priority": 10}
            for agent, blocks in definitions.items() for start, end, room, activity in blocks]


def initialize_story(state: WorldState, metadata: Mapping[str, Any], draft_id: str) -> None:
    """Called on the working snapshot before world publication commits."""
    profile = metadata.get("singlePlayerProfile")
    if not isinstance(profile, Mapping):
        return
    state.metadata["profile"] = {**copy.deepcopy(dict(profile)), "onboardingPhase": "names-confirmed"}
    state.metadata["singlePlayerStoryDraftId"] = draft_id
    state.metadata.pop("narrative", None)
    if metadata.get("templateId") != TEMPLATE_ID:
        # Starting a custom story retires facts and schedules authored only
        # for this template; unrelated published world data remains intact.
        blocks = state.metadata.get("schedules", {}).get("blocks", [])
        state.metadata.get("schedules", {})["blocks"] = [item for item in blocks if "-rain-" not in item.get("id", "")]
        state.metadata.setdefault("publishedWorld", {})["schedules"] = copy.deepcopy(state.metadata.get("schedules", {}))
        desk = state.objects.get("desk", {})
        if desk.get("label") == "校对办公桌":
            desk.pop("label", None)
            desk.pop("reveals", None)
        return
    state.metadata["narrative"] = {"templateId": TEMPLATE_ID, "version": 1, "step": "observe", "workDone": False,
                                   "startedDay": 1, "completed": False,
                                   "facts": {"noteRead": False, "departed": False, "noticeRead": False},
                                   # The first ending remains authoritative.  The optional
                                   # second-day thread is unlocked afterwards so old saves
                                   # still finish the original tutorial in the same way.
                                   "postscript": {"step": "ready", "clues": [], "completed": False}}
    state.metadata["clock"] = default_clock()
    state.metadata["schedules"] = {"version": state.metadata.get("schedules", {}).get("version", 0) + 1,
                                   "blocks": template_schedules()}
    state.metadata["publishedWorld"]["schedules"] = copy.deepcopy(state.metadata["schedules"])
    state.metadata["activation"] = {"leases": {}, "agents": {}, "enabled": True}
    state.metadata["presenceProjections"] = {}
    state.metadata.pop("playerZoneId", None)
    state.metadata.pop("mobility", None)
    state.room_id = "parlor"
    for actor in ("YOU", "PLAYER_DOLL"):
        state.agents[actor].room_id = "parlor"
    for actor in ("A", "B", "C"):
        state.agents[actor].active = True
    # `present` is the participating cast; snapshots filter it by location.
    state.present = ["YOU", "A", "B", "C"]
    state.environment.update(weather="rain", light="warm")
    # A new chapter must not inherit earlier scene interactions as evidence.
    for door_id in DOOR_IDS.values():
        if door_id in state.objects:
            state.objects[door_id]["isOpen"] = False
            state.objects[door_id].pop("lastAction", None)
    # These are template facts, not facts inferred from a custom prompt.
    state.objects["desk"].update(label="校对办公桌", reveals="今日待校对的是地铁停运告示，右下角留着一块擦除痕迹。")


def action_minutes(action: str, payload: Mapping[str, Any]) -> int:
    if action == "observe" and payload.get("waitMinutes"):
        return int(payload["waitMinutes"])
    if action == "move":
        return 5
    if action == "ask" or action == "tell":
        return 3
    if action == "use" and payload.get("objectId") == "desk" and payload.get("verb") == "use":
        return 10
    return 2


def spend_minutes(state: WorldState, minutes: int) -> dict:
    """Re-anchor server time; it is saved atomically with the action."""
    now = time.time()
    clock = clock_snapshot(state.metadata, now)
    total = clock["minute"] + minutes
    days, minute = divmod(total, 1440)
    clock.update(day=clock["day"] + days, minute=minute, anchorDay=clock["day"] + days,
                 anchorMinute=minute, anchorEpoch=now, clockVersion=clock["clockVersion"] + 1)
    state.metadata["clock"] = clock
    return clock


def is_template(state: WorldState) -> bool:
    return state.metadata.get("narrative", {}).get("templateId") == TEMPLATE_ID


def _missed(narrative: Mapping[str, Any], clock: Mapping[str, Any]) -> bool:
    return (clock["day"] > narrative.get("startedDay", 1) or clock["minute"] >= 600) and narrative.get("step") not in ("home", "home-door", "complete")


def expire_story(state: WorldState, clock: Mapping[str, Any]) -> Optional[str]:
    if is_template(state) and _missed(state.metadata["narrative"], clock):
        state.metadata["narrative"].update(step="complete", completed=True, ending="missed")
        return guidance(state)["passage"]
    return None


def _story_facts(state: WorldState) -> dict:
    """Recover proven prerequisites, including saves predating explicit facts."""
    n = state.metadata["narrative"]
    stored = n.get("facts", {})
    facts = {key: stored.get(key) is True for key in ("noteRead", "departed", "noticeRead")}
    step = n["step"]
    # A missed ending can originate in any chapter; it proves no collected clue.
    if step != "complete" or n.get("ending") in ("trust", "question"):
        index = STEPS.index(step)
        for key, threshold in (("noteRead", "open"), ("departed", "station"), ("noticeRead", "office")):
            facts[key] = facts[key] or index >= STEPS.index(threshold)
    # Position and an open exit prove departure is possible, not that a player
    # has read the note or the station notice. Never infer either clue from a door.
    facts["departed"] = (facts["departed"] or state.objects.get(DOOR_IDS["parlor"], {}).get("isOpen") is True
                         or state.agents["YOU"].room_id != "parlor")
    return facts


def reconcile_story(state: WorldState, clock: Mapping[str, Any]) -> Optional[dict]:
    """Align earlier goals with confirmed facts inside a caller's transaction.

    No action, clock advance, clue collection, or choice is invented here.
    The lifecycle caller expires the window first; this guard also prevents a
    direct reconciliation from reviving an already expired opportunity.
    """
    if not is_template(state):
        return None
    n = state.metadata["narrative"]
    if n["step"] == "complete" or _missed(n, clock):
        return None
    old_step, old_facts = n["step"], copy.deepcopy(n.get("facts"))
    facts = _story_facts(state)
    n["facts"] = facts
    room = state.agents["YOU"].room_id
    while True:
        before = n["step"]
        if before == "observe" and facts["noteRead"]:
            n["step"] = "open"
        elif before == "open" and facts["departed"]:
            n["step"] = "station"
        elif before == "station" and (room == "station" or facts["noticeRead"]):
            n["step"] = "station-door"
        elif before == "station-door" and facts["noticeRead"]:
            n["step"] = "office"
        elif before == "office" and room == "office":
            n["step"] = "talk" if n["workDone"] else "work"
        elif before == "work" and n["workDone"]:
            n["step"] = "talk"
        if n["step"] == before:
            break
    if n["step"] != old_step or old_facts != facts:
        return {"fromStep": old_step, "toStep": n["step"], "facts": copy.deepcopy(facts),
                "reason": "confirmed_facts_alignment"}
    return None


def advance_story(state: WorldState, request: Event, started_clock: Mapping[str, Any]) -> Optional[str]:
    """Return an authored public passage only after a meaningful transition."""
    if not is_template(state):
        return None
    n = state.metadata["narrative"]
    old_step = n["step"]
    old_postscript = copy.deepcopy(n.get("postscript") or {"step": "ready", "clues": [], "completed": False})
    postscript = n.setdefault("postscript", old_postscript)
    room = state.agents["YOU"].room_id
    object_id = request.payload.get("objectId")
    verb = request.payload.get("verb")
    text = request.payload.get("text", "") or ""
    facts = _story_facts(state)
    if request.action == "observe" and not request.payload.get("waitMinutes") and room == "parlor":
        facts["noteRead"] = True
    if request.action == "use" and object_id == DOOR_IDS["station"] and verb in ("open", "look") and room == "station":
        facts["noticeRead"] = True
    n["facts"] = facts
    if request.action == "use" and object_id == "desk" and verb == "use":
        n["workDone"] = True
    if old_step == "talk" and request.target == "A" and request.action in ("ask", "tell") and not _missed(n, started_clock):
        n["step"] = "choice"
    elif old_step == "choice" and request.target == "A" and request.action in ("ask", "tell") and not _missed(n, started_clock):
        if "相信" in text:
            n.update(step="home", choice="trust")
        elif any(word in text for word in ("隐瞒", "追问", "证据")):
            n.update(step="home", choice="question")
    elif old_step == "home" and request.action in ("move", "observe") and not request.payload.get("waitMinutes") and room == "home":
        n["step"] = "home-door"
    elif old_step == "home-door" and object_id == DOOR_IDS["home"] and verb == "open":
        n.update(step="complete", completed=True, ending=n.get("choice", "trust"))
    elif old_step == "complete" and not postscript.get("completed"):
        # Optional second-day thread. It is deliberately deterministic and uses
        # the same action primitives as the first five chapters.
        post_step = postscript.get("step", "ready")
        if post_step == "ready" and request.action == "move" and room == "station":
            postscript["step"] = "station"
        elif post_step == "station" and request.target == "C" and request.action in ("ask", "tell") and room == "station":
            postscript["step"] = "office"
            if "station-pass" not in postscript.setdefault("clues", []):
                postscript["clues"].append("station-pass")
        elif post_step == "station" and request.action == "observe" and room == "station":
            # If the player returns after the station shift, the public
            # counter still exposes the same clue without resurrecting C.
            postscript["step"] = "office"
            if "station-pass-late" not in postscript.setdefault("clues", []):
                postscript["clues"].append("station-pass-late")
        elif post_step == "office" and request.action == "use" and object_id == "desk" and verb in ("look", "use") and room == "office":
            postscript["step"] = "home"
            if "archive-card" not in postscript.setdefault("clues", []):
                postscript["clues"].append("archive-card")
        elif post_step == "home" and request.action == "use" and object_id == DOOR_IDS["home"] and verb == "open" and room == "home":
            postscript["step"] = "complete"
            postscript["completed"] = True
    if _missed(n, clock_snapshot(state.metadata)):
        n.update(step="complete", completed=True, ending="missed")
    else:
        reconcile_story(state, clock_snapshot(state.metadata))
    if n["step"] != old_step or postscript != old_postscript:
        return guidance(state)["passage"]
    return None


def story_response(state: WorldState, actor: str, request: Event) -> Optional[str]:
    if not is_template(state) or actor not in ("A", "B", "C"):
        return None
    text = request.payload.get("text", "") or ""
    n = state.metadata["narrative"]
    room = state.agents["YOU"].room_id
    if actor == "C":
        if room == "station":
            postscript = n.get("postscript") or {}
            if n.get("step") == "complete" and postscript.get("step") == "station":
                return "伞柄上的日期不是刻上去的，是站里旧物登记的编号。那天有人把伞交到失物处，却没有留下姓名。你若要查，档案馆的旧卡片柜里应该还有一张转交记录。"
            if "三分钟" in text or "晚点" in text:
                return "旧表和新告示差了三分钟。我只负责今天的检票，不能替档案下结论。玻璃门里面有告示，你可以打开门核对；原稿要去档案馆找。"
            if any(word in text for word in ("告示", "停运", "司机", "名字")):
                return "告示就在玻璃门后的墙上。时刻改过，落款的名字又像被擦过，所以我没敢重新誊抄。你先开门看清楚，也可以问我新旧时刻差了多少。"
            if any(word in text for word in ("继续", "什么", "刚才", "具体")) and "今天" not in text:
                return "我说的是门后那张停运告示：新时刻比旧表晚了三分钟，名字那一栏却空了。打开玻璃门就能看见；如果你去档案馆上班，可以再查原稿。"
            return "今天雨大，检票口一直有人问停运的事。我在这里值班到傍晚。你看到玻璃门后的告示了吗？想问告示改了什么，或者那三分钟，我都可以说说。"
        if room == "bar":
            return "今天的检票工作结束了，我来坐一会儿。站里的停运告示还没换，时刻和名字的问题得对着原稿核实。你想聊值班，还是那张告示？"
        return "我还没到今天的值班时间，先在家收拾东西。白天会去地铁站检票，站里的停运告示是最近常有人问的事。你想问哪一部分？"
    if actor == "B":
        if room == "kitchen":
            return "我在准备今天的饭。水壶放在灶边，桌子也擦好了。你想看看厨房，还是聊聊今天的安排？我傍晚会回家。"
        if any(word in text for word in ("工作", "安排", "上班", "今天")):
            return "上午我在家，中午去厨房准备饭，傍晚再回来。你如果要去档案馆，先看看自己的值班安排；别为了聊天错过和同事约好的时间。"
        if any(word in text for word in ("告示", "三分钟", "司机")):
            return "我没有去过站里，不能替你确认告示的内容。白天地铁站有人值班，带着问题去问，再亲眼看看，会比听我猜有用。"
        return "我正在整理今天的安排，中午要去厨房。你刚才想说的是路上遇到的事，还是自己的工作？说具体些，我才能接上你的话。"
    if n.get("ending") == "missed" or _missed(n, clock_snapshot(state.metadata)):
        return "早上的约定已经过去了。我现在要照顾家人，那件事今天不谈了。你也去忙自己的生活吧。"
    if n.get("step") in ("home", "home-door", "complete"):
        return "原稿已经交给你了。今天各自把生活过好，之后我们再一起处理。"
    if n.get("step") not in ("talk", "choice") or state.agents["YOU"].room_id != "office":
        return "我只待到十点。先做好你的校对，关于那封信，到时候我会亲口解释。"
    if n["step"] == "choice" and "相信" in text:
        return "谢谢。但别只相信我。这是告示的原稿。那班车曾停下来等过一个人，请把救人的司机名字留在档案里。"
    if n["step"] == "choice" and any(word in text for word in ("隐瞒", "追问", "证据")):
        return "擦掉名字的是我。我怕自己也被忘记。原稿和修改记录都在这里，请你按证据决定。"
    return "我十点必须回家照看父亲。停运那天，最后一班车多等了三分钟。档案却把救人的司机名字擦掉了。我想请你留下真相。"


def _action(identifier: str, label: str, intent: str, minutes: int, reason: str = "") -> dict:
    return {"id": identifier, "label": label, "intent": intent, "minutes": minutes, "reason": reason}


def scene_actions(state: WorldState) -> list[dict]:
    room = state.agents["YOU"].room_id
    actions = [_action("observe", "观察这里", "观察周围", 2, "了解当前地点能做什么")]
    door = DOOR_IDS.get(room)
    if door in state.objects and "open" in state.objects[door].get("actions", []):
        actions.append(_action("open-door", "开门看看", "去开门，看看里面有啥东西", 2, "与当前地点的门互动"))
    if room == "office":
        if is_template(state) and state.metadata["narrative"].get("workDone"):
            actions.append(_action("review-work", "检查校对页", "看看办公桌", 2))
        else:
            actions.append(_action("work", "完成校对工作" if is_template(state) else "使用办公桌", "使用办公桌", 10))
    names = state.metadata.get("profile", {}).get("names", {})
    for actor in state.present:
        if actor in ("A", "B", "C") and state.agents[actor].room_id == room:
            name = names.get(actor, actor)
            actions.append(_action("talk-" + actor, "和" + name + "聊聊", "问" + name + "：今天怎么样？", 3))
    actions.append(_action("wait", "等十分钟", "等待10分钟", 10, "等待会真实推进世界时间，角色也可能离开"))
    return actions


def _line(speaker_id: str, kind: str, text: str) -> dict:
    return {"speakerId": speaker_id, "kind": kind, "text": text}


def _story_dialogue(state: WorldState, step: str, ending: Optional[str], objective: str) -> dict:
    """Public presentation only: reading a line never advances the world.

    IDs describe the authored passage, not the frequently changing world
    version. The client binds its reading position to this ID and worldId.
    Thoughts belong only to YOU; other characters reveal themselves by speech
    and visible action. Detours must not stage a conversation across rooms.
    """
    room = state.agents["YOU"].room_id
    n = state.metadata["narrative"]
    names = state.metadata.get("profile", {}).get("names", {})
    colleague = names.get("A", "林川")
    branch = ending or n.get("choice") or "common"
    postscript = n.get("postscript") or {"step": "ready", "clues": [], "completed": False}
    post_step = postscript.get("step", "ready")
    identifier = f"{TEMPLATE_ID}:dialogue-v1:{step}:{branch}:{room}:{post_step}"
    stages = {"observe": "parlor", "open": "parlor", "station": "parlor", "station-door": "station",
              "office": "station", "work": "office", "talk": "office", "choice": "office",
              "home": "office", "home-door": "home"}
    colleague_present = "A" in state.present and state.agents["A"].room_id == room
    post_required_room = {"station": "station", "office": "office", "home": "home"}.get(post_step)
    postscript_away = step == "complete" and post_step in ("station", "office", "home") and (
        room != post_required_room or (post_step == "station" and not colleague_present)
    )
    if (step != "complete" and (room != stages[step] or (step in ("talk", "choice") and not colleague_present))) or postscript_away:
        # This is an orientation reminder, not a replay of people the player
        # cannot currently see or hear. The chapter action remains authoritative.
        return {"dialogueId": identifier + ":away", "dialogue": [
            _line("ENV", "narration", "你停在" + ROOM_LABELS.get(room, room) + "，回想接下来要做的事。"),
            _line("YOU", "thought", objective),
            _line("YOU", "thought", "先把眼前的事安排好，再沿着这条线索继续。每一次绕路，都要算上时间。"),
        ]}
    scripts = {
        "observe": [
            _line("ENV", "narration", "雨已经下了三天。窗外的水珠连成细线，桌上那张通行证却干得出奇。"),
            _line("YOU", "thought", "日期是明天。可我明明记得，昨晚桌上还没有这张纸。"),
            _line("PLAYER_DOLL", "speech", "先别急着给它编一个答案。旁边不是还有张便笺吗？"),
            _line("YOU", "thought", "今天是我去档案馆做校对的日子。至少，先弄清楚今天的安排。"),
        ],
        "open": [
            _line("ENV", "narration", f"便笺上的字迹有些急：十点前到办公室找我。有件事想当面说。——{colleague}。"),
            _line("YOU", "thought", "没有说是什么事。偏偏把时间写得这么清楚。"),
            _line("PLAYER_DOLL", "speech", "他有他的安排，不会一直坐在那里等我们。把便笺带上吧。"),
            _line("YOU", "speech", "好。先开门，去上班。"),
        ],
        "station": [
            _line("ENV", "narration", "门被推开，凉意涌进来。一把旧伞靠在门外，水沿着伞尖落到地上。"),
            _line("YOU", "thought", "伞柄上的日期……和通行证一样。这两样东西，会是谁留下的？"),
            _line("PLAYER_DOLL", "speech", "去档案馆要经过地铁站。路上的事，也许要走过去才知道。"),
            _line("YOU", "speech", "那就先去地铁站。不能因为一张奇怪的纸，把今天也耽误了。"),
        ],
        "station-door": [
            _line("ENV", "narration", "玻璃门隔着站内的灯光。门后的墙上贴着一张告示，落款处有一块浅浅的白痕。"),
            _line("YOU", "thought", "像被水晕开了，又像有人特意擦过。隔着门，看不清。"),
            _line("PLAYER_DOLL", "speech", "门把手就在这里。想知道里面写了什么，可以自己打开看看。"),
            _line("YOU", "speech", "就看一眼。把时刻记下来，再赶去办公室。"),
        ],
        "office": [
            _line("ENV", "narration", "门后的告示写着末班车的时间。旧字迹还透在纸背上，新时间比它晚了三分钟。"),
            _line("YOU", "thought", "三分钟被留下了，司机的名字却没有。擦掉的到底是笔误，还是一个人？"),
            _line("PLAYER_DOLL", "speech", "你今天负责校对这份告示，对吧？办公室应该有原稿。"),
            _line("YOU", "speech", "先核对原稿。我不想只凭一块白痕下结论。"),
        ],
        "work": [
            _line("ENV", "narration", "值班表上写着你的名字。办公桌上，告示、原稿和一支红笔排得整整齐齐。"),
            _line("YOU", "thought", "日期、时刻、姓名。先把该做的工作做好，疑问才能有个落脚处。"),
            _line("PLAYER_DOLL", "speech", "我替你压住纸角。字要你自己看，名字也要你自己确认。"),
            _line("YOU", "speech", "给我十分钟。看完以后，再去问那封信的事。"),
        ],
        "talk": [
            _line("ENV", "narration", "原稿背面还留着那个被划去的名字。你核完最后一个字，在今日值班表上做了记号。"),
            _line("YOU", "thought", "工作做完了，可这个名字为什么会被删掉？"),
            _line("ENV", "narration", f"{colleague}把一封没有封口的信放在桌边。他看了一眼墙上的钟，又把信推近了一点。"),
            _line("YOU", "thought", "是时候问他了。这次要在他离开之前，把话听完整。"),
        ],
        "choice": [
            _line("A", "speech", "十点我得回家照顾父亲，所以没办法一直等你。对不起，把你也叫进这件事里。"),
            _line("A", "speech", "那班车为了救人，多等了三分钟。可档案留下了晚点，却擦掉了救人的司机名字。"),
            _line("ENV", "narration", f"{colleague}按着辞职信的边角，没有把它收回去。"),
            _line("YOU", "thought", "他想离开，又想留住那个人的名字。我该先接住他的求助，还是请他把隐瞒的部分也说清楚？"),
            _line("PLAYER_DOLL", "speech", "这一次，我替不了你回答。你愿意相信什么，就亲口告诉他。"),
        ],
        "home": [
            _line("ENV", "narration", "原稿交到了你手里，校对页上重新写回了司机的名字。" if branch == "trust" else "原稿旁多了修改记录和一份签过名的更正说明。被擦掉的痕迹终于有了来由。"),
            _line("YOU", "thought", f"我答应帮他，而{colleague}答应一起提交原稿。相信一个人，也可以从一起承担一件事开始。" if branch == "trust" else f"{colleague}承认，是他亲手擦掉了名字。我没有替他遮住这件事，也不必替他决定以后的人生。"),
            _line("PLAYER_DOLL", "speech", "把这些纸收好吧。今天要带回去的，已经不止一个疑问了。"),
            _line("YOU", "speech", "先回家整理。接下来怎么走，我想认真想一想。"),
        ],
        "home-door": [
            _line("ENV", "narration", "你站在熟悉的家门前。门缝里透出暖光，通行证在口袋里慢慢变干。"),
            _line("YOU", "thought", "明天的日期还在那里。可是现在，我有了想带到明天的东西。"),
            _line("PLAYER_DOLL", "speech", "明天，还去上班吗？"),
            _line("YOU", "speech", "去。把门打开吧，回家以后慢慢说。"),
        ],
    }
    endings = {
        "trust": [
            _line("ENV", "narration", f"后记。第二天，你和{colleague}把原稿一起交到档案室。司机的名字恢复了。"),
            _line("ENV", "narration", "更正页上有两个人的署名。那些字很小，却再也不是可以随手擦去的空白。"),
            _line("YOU", "thought", "我还不知道通行证从哪里来。但我知道，明天有一件想和别人一起做完的事。"),
            _line("ENV", "narration", "短篇在这里落下最后一页。此刻的城市仍在运转，你也可以继续自己的生活。"),
        ],
        "question": [
            _line("ENV", "narration", f"后记。修改记录与更正说明一同入档，{colleague}也在那份说明上留下了自己的名字。"),
            _line("YOU", "thought", "我问出了一个不那么好听的答案。可是只有知道发生过什么，才谈得上往后怎么办。"),
            _line("ENV", "narration", "原稿上的划痕没有被抹平。更正后的字迹紧挨着它，让后来的人也能看见。"),
            _line("YOU", "thought", "这次先把证据留下。和真实的人相处，也许本来就没有一张干干净净的标准答案。"),
        ],
        "missed": [
            _line("ENV", "narration", f"约定的十点已经过去。按照今天的行程，{colleague}回家照顾父亲；那场当面的解释没有发生。"),
            _line("YOU", "thought", "原来错过不会发出什么特别的声音。只是我再想开口时，那个时刻已经不在了。"),
            _line("PLAYER_DOLL", "speech", "每个人都有自己的今天。你还有工作，也还有可以去见的人。"),
            _line("YOU", "thought", "这一次没能听完。先把能做的事做好，再想下一步。"),
        ],
    }
    if step == "complete" and post_step in ("station", "office", "home"):
        post_scripts = {
            "station": [
                _line("ENV", "narration", "第二天的雨小了一些。你回到地铁站，伞柄上的日期仍清晰可见。"),
                _line("YOU", "thought", "昨天我只追着告示走，没问这把伞从哪里来。"),
                _line("C", "speech", "这把伞登记过失物。那天有人把它交来，却没有留下姓名。旧卡片柜在档案馆。"),
                _line("PLAYER_DOLL", "speech", "把编号记下来，再回办公室找旧卡片。"),
            ],
            "office": [
                _line("ENV", "narration", "旧卡片柜比昨天的办公桌更窄。最底层夹着一张转交记录，纸角印着同一个日期。"),
                _line("YOU", "thought", "有人见过这把伞，也有人选择不留下名字。记录没有告诉我原因。"),
                _line("PLAYER_DOLL", "speech", "先把卡片和原稿放在一起。它们指向同一天。"),
                _line("YOU", "speech", "我带回家，再决定要不要把这件事写进明天的工作。"),
            ],
            "home": [
                _line("ENV", "narration", "你把伞柄的编号抄在便笺背面，和昨天的更正页收在一起。"),
                _line("YOU", "thought", "一段故事不会因为结局落下就停止。有人留下记录，也有人留下空白。"),
                _line("PLAYER_DOLL", "speech", "明天的日期还在，但现在它属于你的选择。"),
                _line("YOU", "speech", "先把灯打开。明天继续。"),
            ],
        }
        return {"dialogueId": identifier, "dialogue": post_scripts[post_step]}
    if step == "complete" and post_step == "complete":
        return {"dialogueId": identifier, "dialogue": [
            _line("ENV", "narration", "第二天的伞支线暂时告一段落。编号、卡片和更正页被放进同一个文件夹。"),
            _line("YOU", "thought", "我还不知道谁写下了明天的日期，但我已经知道该从哪里继续查。"),
            _line("PLAYER_DOLL", "speech", "城市不会等我们把所有问题都问完。先过好今天。"),
        ]}
    return {"dialogueId": identifier, "dialogue": endings.get(ending, endings["trust"]) if step == "complete" else scripts[step]}


def guidance(state: WorldState) -> dict:
    room = state.agents["YOU"].room_id
    fallback = scene_actions(state)
    if not is_template(state):
        return {"title": "此刻可以做什么", "chapter": "自由探索", "objective": "选择下面的行动，或用自己的话描述想做的事。",
                "passage": "你现在在" + ROOM_LABELS.get(room, room) + "。推荐行动根据当前位置和在场人物提供。", "actions": fallback,
                "dialogueId": "free:dialogue-v1:" + room,
                "dialogue": [_line("ENV", "narration", "你现在在" + ROOM_LABELS.get(room, room) + "。"),
                             _line("YOU", "thought", "先看看周围，再决定下一步做什么。也可以直接说出想做的事。") ]}
    n = state.metadata["narrative"]
    clock = clock_snapshot(state.metadata)
    step = "complete" if _missed(n, clock) else n["step"]
    ending = "missed" if _missed(n, clock) else n.get("ending")
    names = state.metadata.get("profile", {}).get("names", {})
    name = names.get("A", "林川")
    info = {
        "observe": ("第一章 · 明天的日期", "观察桌上的便笺，弄清今天要做什么。", "雨点敲着窗。你是档案馆的新校对员，今天九点要到岗。桌上的通行证却写着明天的日期。小墨抬起头：‘先看看便笺。’", "parlor", _action("story-observe", "查看便笺", "观察周围", 2)),
        "open": ("第一章 · 明天的日期", "打开门，开始今天的通勤。", f"便笺写着：‘十点前到办公室找我。——{name}’。你把通行证装进口袋，小墨指向门口：‘他不会一直等着，我们出发吧。’", "parlor", _action("story-open", "带上便笺，开门出发", "开门", 2)),
        "station": ("第二章 · 多出来的三分钟", "先到地铁站，看看通勤线路上的异样。", "门外是一把滴水的旧伞。伞柄上刻着和通行证相同的日期。去上班的路经过地铁站，你决定顺路看一眼。", "station", _action("story-station", "去地铁站通勤", "去地铁站", 5)),
        "station-door": ("第二章 · 多出来的三分钟", "打开地铁站玻璃门，查看里面的告示。", "玻璃门后的灯还亮着。值班员周野在检票，墙上那张停运告示的落款像被水擦过。小墨说：‘门可以打开。’", "station", _action("story-station-door", "打开玻璃门，看告示", "去开门，看看里面有啥东西", 2)),
        "office": ("第三章 · 你的名字在值班表上", "到办公室，完成自己负责的校对工作。", "告示上，末班车发出时间被改晚了三分钟，司机的名字却被抹去。你抄下时间，赶去办公室；今天这份告示恰好由你校对。", "office", _action("story-office", "去办公室上班", "去办公室", 5)),
        "work": ("第三章 · 你的名字在值班表上", "使用办公桌，完成今日校对（需要十分钟）。", "值班表上有你的名字。你还有自己的生活与职责：先核对告示的日期、时刻和原稿。小墨坐在桌角，替你压住被风掀起的纸页。", "office", _action("story-work", "坐下完成校对工作", "使用办公桌", 10)),
        "talk": ("第四章 · 未寄出的信", f"十点前向{name}询问辞职信。", f"你在原稿背面找到了被划去的名字。今日校对完成。{name}把一封没有封口的信放到桌边，目光不时移向墙上的钟。", "office", _action("story-talk", f"问{name}：辞职信是怎么回事？", f"问{name}：那封辞职信是怎么回事？", 3)),
        "choice": ("第四章 · 留白由谁填写", "决定怎样回应：相信他，或要求他拿出证据。", f"{name}说，最后一班车为了救人多等了三分钟，司机却被从档案中抹去了。他想辞职，却又不甘心让这件事消失。小墨轻声说：‘这次，要你自己决定。’", "office", None),
        "home": ("第五章 · 把答案带回家", "今日短时校对任务已完成，带原稿回家整理。", "你选择相信他的求助，把名字补回校对页。林川答应明天和你一起提交原稿。雨声渐弱，你第一次觉得自己不只是路过这座城。" if n.get("choice") == "trust" else "你坚持核对证据。修改记录证实，是林川亲手擦掉了名字；他签下更正说明。你没有替他隐瞒，也没有替他决定往后的人生。", "home", _action("story-home", "带原稿回家整理", "回家", 5)),
        "home-door": ("第五章 · 雨停以前", "打开家门，读完这个故事的最后一页。", "熟悉的玄关透出灯光。口袋里的通行证渐渐变干，明天的日期也不再像一个威胁。小墨问：‘明天，还去上班吗？’", "home", _action("story-home-door", "开门，结束今天的故事", "开门", 2)),
    }
    if step == "complete":
        endings = {
            "trust": ("结局 · 共同署名", "第二天，你和林川把原稿一起交到档案室。司机的名字恢复了。你按时上班，小墨待在窗边等雨停；这座城还有许多你未曾遇见的人。"),
            "question": ("结局 · 留下证据", "更正说明和原稿一起存入档案。林川接受了自己的责任。你没有得到一个毫无瑕疵的答案，却学会了与真实的人继续相处。"),
            "missed": ("结局 · 迟到的人", "墙上的钟越过十点。林川已经回家，桌上只留下封好的辞职信。今天的解释机会错过了；你仍能完成工作、拜访其他人，世界不会因为这一场错过而停下。"),
        }
        chapter, passage = endings.get(ending, endings["trust"])
        postscript = n.get("postscript") or {"step": "ready", "clues": [], "completed": False}
        post_step = postscript.get("step", "ready")
        objective = "短篇已完成。带着这段经历继续自由生活。"
        actions = fallback
        if post_step == "ready":
            chapter = "第二天 · 伞柄上的编号"
            objective = "回到地铁站，问问周野那把旧伞的来历（可选支线）。"
            passage = "结局之后，通行证背面的日期仍没有褪色。你想起门边那把旧伞，决定再回地铁站看一眼。"
            # Keep the optional thread discoverable without turning the
            # completed chapter into a single-purpose menu. The authored
            # entry stays first so existing tutorial flow remains stable.
            actions = [_action("postscript-start", "开始第二天支线：去地铁站", "去地铁站", 5, "可选支线，不改变已获得的结局")]
            actions += [item for item in fallback if item["intent"] not in {a["intent"] for a in actions}]
        elif post_step == "station":
            chapter = "第六章 · 伞柄上的编号"
            objective = "在地铁站查清旧伞的登记编号。"
            passage = "周野的值班表还在墙上。你可以直接问他，也可以先观察失物登记处。"
            if room == "station" and "C" in state.present and state.agents["C"].room_id == room:
                actions = [_action("postscript-station-talk", "问周野：伞柄上的日期是什么？", "问周野：伞柄上的日期是什么？", 3)]
            elif room == "station":
                actions = [_action("postscript-station-observe", "查看失物登记处", "观察周围", 2, "周野已经离开，公开登记仍在原处")]
            else:
                actions = [_action("postscript-station", "去地铁站查登记", "去地铁站", 5)]
        elif post_step == "office":
            chapter = "第七章 · 档案背面的地址"
            objective = "回办公室，从旧卡片柜里找出转交记录。"
            passage = "伞的登记编号指向档案馆旧卡片柜。昨天的校对页还在桌上，今天要查的是更早的一天。"
            actions = ([_action("postscript-file", "检查旧卡片柜", "看看办公桌", 2)] if room == "office"
                       else [_action("postscript-office", "回办公室查旧卡片", "去办公室", 5)])
        elif post_step == "home":
            chapter = "第八章 · 明天的日期"
            objective = "把伞的编号和卡片带回家，留下今天的记录。"
            passage = "旧卡片没有解释谁写下了明天的日期，却把伞和那班车连在了一起。把它们带回家，明天还能继续查。"
            actions = ([_action("postscript-home-door", "开门，收好今天的记录", "开门", 2)] if room == "home"
                       else [_action("postscript-home", "带记录回家", "回家", 5)])
        elif post_step == "complete":
            chapter = "教程支线 · 暂告一段落"
            objective = "教程支线已完成，继续自由生活或重新体验另一条主线。"
            passage = "伞、卡片和更正页被放进同一个文件夹。你还不知道答案，但已经有了下一次回到档案馆的理由。"
            actions = fallback
    else:
        chapter, objective, passage, required_room, action = info[step]
        if room != required_room and step not in ("station", "office", "home"):
            action = _action("story-return", "回家继续剧情" if required_room == "home" else "去" + ROOM_LABELS[required_room] + "继续剧情",
                             "回家" if required_room == "home" else "去" + ROOM_LABELS[required_room], 5)
        elif room == required_room and step in ("station", "office", "home"):
            action = _action("story-arrived", "查看抵达后的场景", "观察周围", 2)
        if step == "choice" and room == required_room:
            actions = [_action("story-trust", "我相信你，继续说", f"问{name}：我相信你，请继续说。", 3),
                       _action("story-question", "你还隐瞒了什么？拿出证据", f"问{name}：你还隐瞒了什么？请给我证据。", 3)]
        else:
            actions = [action] if action else []
        actions += [item for item in fallback if item["intent"] not in {a["intent"] for a in actions}]
    remaining = max(0, 600 - clock["minute"]) if clock["day"] == n.get("startedDay", 1) else 0
    return {"title": "雨停以前", "chapter": chapter, "objective": objective, "passage": passage,
            **_story_dialogue(state, step, ending, objective),
            "completed": step == "complete", "ending": ending, "actions": actions,
            "playerRoutine": "今日身份：档案馆校对员 · 今日校对：" + ("已完成" if n.get("workDone") else "待完成（办公室，十分钟）"),
            "scheduleHint": f"{name}：09:00–10:00 办公室，之后回家。今天的谈话窗口剩余 {remaining} 分钟。"}


def validate_saved_narrative(value: Any) -> dict:
    if not isinstance(value, Mapping) or value.get("templateId") != TEMPLATE_ID or value.get("version") != 1:
        raise ValidationError("saved narrative is invalid", "invalid_save_payload")
    if value.get("step") not in STEPS or type(value.get("workDone")) is not bool:
        raise ValidationError("saved narrative step is invalid", "invalid_save_payload")
    if value.get("choice") not in (None, "trust", "question") or value.get("ending") not in (None, "trust", "question", "missed"):
        raise ValidationError("saved narrative branch is invalid", "invalid_save_payload")
    if type(value.get("completed")) is not bool or (value["step"] == "complete") != value["completed"]:
        raise ValidationError("saved narrative completion is invalid", "invalid_save_payload")
    if value["step"] == "complete" and value.get("ending") not in ("trust", "question", "missed"):
        raise ValidationError("saved narrative ending is invalid", "invalid_save_payload")
    if value["step"] in ("home", "home-door") and value.get("choice") not in ("trust", "question"):
        raise ValidationError("saved narrative choice is invalid", "invalid_save_payload")
    if type(value.get("startedDay")) is not int or not 1 <= value["startedDay"] <= 100000:
        raise ValidationError("saved narrative day is invalid", "invalid_save_payload")
    if "facts" in value and (not isinstance(value["facts"], Mapping)
                              or any(type(value["facts"].get(key)) is not bool for key in ("noteRead", "departed", "noticeRead"))):
        raise ValidationError("saved narrative facts are invalid", "invalid_save_payload")
    postscript = value.get("postscript")
    if postscript is not None:
        if not isinstance(postscript, Mapping) or postscript.get("step") not in ("ready", "station", "office", "home", "complete"):
            raise ValidationError("saved postscript step is invalid", "invalid_save_payload")
        clues = postscript.get("clues", [])
        if (type(postscript.get("completed")) is not bool or
                (postscript.get("step") == "complete") != postscript.get("completed") or
                not isinstance(clues, list) or len(clues) > 16 or
                any(not isinstance(item, str) or not item for item in clues)):
            raise ValidationError("saved postscript is invalid", "invalid_save_payload")
    return {key: copy.deepcopy(value[key]) for key in ("templateId", "version", "step", "workDone", "startedDay", "completed", "choice", "ending", "facts", "postscript") if key in value}


# ---------------------------------------------------------------------------
# Full tutorial v2
# ---------------------------------------------------------------------------
# The original v1 chapter is retained for existing saves and regression
# compatibility.  v2 is the default authored tutorial: three in-world days,
# three consequential positions, and a closed explanation for the pass.

def is_full_template(state: WorldState) -> bool:
    return state.metadata.get("narrative", {}).get("templateId") == FULL_TEMPLATE_ID


def full_template_schedules() -> list[dict]:
    def block(agent: str, day: int, start: int, end: int, room: str, activity: str, priority: int = 10) -> dict:
        return {"id": f"{agent}-rain-v2-{day}-{start}", "agentId": agent,
                "recurrence": {"kind": "daily", "days": [day]}, "startMinute": start,
                "endMinute": end, "location": {"roomId": room}, "activity": activity,
                "priority": priority}
    return [
        block("A", 1, 540, 600, "office", "work"), block("A", 1, 600, 1440, "home", "care"),
        block("B", 1, 0, 720, "home", "rest"), block("B", 1, 720, 1080, "kitchen", "work"), block("B", 1, 1080, 1440, "home", "rest"),
        block("C", 1, 0, 540, "home", "rest"), block("C", 1, 540, 1080, "station", "work"), block("C", 1, 1080, 1440, "bar", "rest"),
        block("A", 2, 480, 660, "home", "care"), block("A", 2, 660, 780, "office", "work"), block("A", 2, 780, 1440, "home", "care"),
        block("B", 2, 0, 600, "home", "rest"), block("B", 2, 600, 720, "kitchen", "listen"), block("B", 2, 720, 1440, "home", "rest"),
        block("C", 2, 480, 660, "station", "handover"), block("C", 2, 660, 1440, "bar", "rest"),
        block("A", 3, 540, 720, "office", "hearing"), block("A", 3, 720, 1440, "home", "care"),
        block("B", 3, 0, 1440, "home", "rest"), block("C", 3, 0, 1440, "bar", "rest"),
    ]


def _full_set_clock(state: WorldState, day: int, minute: int) -> None:
    now = time.time()
    previous = state.metadata.get("clock", {})
    state.metadata["clock"] = {"day": day, "minute": minute, "timezone": "Asia/Shanghai", "speed": 1,
                                "clockVersion": int(previous.get("clockVersion", 0)) + 1,
                                "anchorEpoch": now, "anchorDay": day, "anchorMinute": minute}


def _full_initialize_story(state: WorldState, metadata: Mapping[str, Any], draft_id: str) -> None:
    profile = metadata.get("singlePlayerProfile")
    if not isinstance(profile, Mapping):
        return
    state.metadata["profile"] = {**copy.deepcopy(dict(profile)), "onboardingPhase": "names-confirmed"}
    state.metadata["singlePlayerStoryDraftId"] = draft_id
    state.metadata["narrative"] = {
        "templateId": FULL_TEMPLATE_ID, "version": 2, "step": "arrival", "startedDay": 1,
        "completed": False, "ending": None, "choice": None, "route": None, "day1Route": None,
        "finalChoice": None, "workDone": False,
        "facts": {"passSeen": False, "noteRead": False, "stationNotice": False, "umbrellaNumber": False,
                  "recordingHeard": False, "auditSaved": False, "passOrigin": False},
        "clues": [], "missedWindows": [], "day": 1,
    }
    state.metadata["clock"] = default_clock()
    state.metadata["schedules"] = {"version": state.metadata.get("schedules", {}).get("version", 0) + 1,
                                   "blocks": full_template_schedules()}
    state.metadata["publishedWorld"]["schedules"] = copy.deepcopy(state.metadata["schedules"])
    state.metadata["activation"] = {"leases": {}, "agents": {}, "enabled": True}
    state.metadata["presenceProjections"] = {}
    state.metadata.pop("playerZoneId", None)
    state.metadata.pop("mobility", None)
    state.room_id = "parlor"
    for actor in ("YOU", "PLAYER_DOLL"):
        state.agents[actor].room_id = "parlor"
    for actor in ("A", "B", "C"):
        state.agents[actor].active = True
    state.present = ["YOU", "A", "B", "C"]
    state.environment.update(weather="rain", light="warm")
    for door_id in DOOR_IDS.values():
        if door_id in state.objects:
            state.objects[door_id]["isOpen"] = False
            state.objects[door_id].pop("lastAction", None)
    state.objects["desk"].update(label="校对办公桌", reveals="原稿、旧卡片柜索引和一张写着明天日期的通行证都在这里。")


def _full_deadline_missed(state: WorldState, clock: Mapping[str, Any]) -> bool:
    n = state.metadata.get("narrative", {})
    if not is_full_template(state) or n.get("completed"):
        return False
    # Day-one conversation closes at 10:00; the other windows close at the
    # published schedule boundary and leave a public object fallback.
    if n.get("step") in ("meeting", "day1-choice") and (clock.get("day", 1) != 1 or clock.get("minute", 0) >= 600):
        return True
    return False


def _full_append_clue(n: dict, clue: str) -> None:
    if clue not in n.setdefault("clues", []):
        n["clues"].append(clue)


def _full_advance_story(state: WorldState, request: Event, started_clock: Mapping[str, Any]) -> Optional[str]:
    if not is_full_template(state):
        return None
    n = state.metadata["narrative"]
    old_step = n["step"]
    room = state.agents["YOU"].room_id
    action = request.action
    payload = request.payload
    text = payload.get("text", "") or ""
    target = request.target
    facts = n.setdefault("facts", {})
    if _full_deadline_missed(state, clock_snapshot(state.metadata)) and old_step in ("meeting", "day1-choice"):
        n.update(step="day1-home", ending="missed", choice="missed")
        n.setdefault("missedWindows", []).append("day1-meeting")
    elif old_step == "arrival" and action == "observe" and room == "parlor":
        facts.update(passSeen=True, noteRead=True); n["step"] = "depart"
        _full_append_clue(n, "tomorrow-pass")
    elif old_step == "depart" and action == "use" and payload.get("verb") == "open" and room == "parlor":
        facts["passSeen"] = True; n["step"] = "station"
    elif old_step == "station" and action == "move" and room == "station":
        n["step"] = "station-clue"
    elif old_step == "station-clue" and action == "use" and room == "station" and payload.get("objectId") == DOOR_IDS["station"]:
        facts["stationNotice"] = True; facts["umbrellaNumber"] = True; n["step"] = "office"
        _full_append_clue(n, "three-minutes"); _full_append_clue(n, "umbrella-0617")
    elif old_step == "office" and action == "move" and room == "office":
        n["step"] = "work"
    elif old_step == "work" and action == "use" and room == "office" and payload.get("objectId") == "desk":
        n["workDone"] = True; n["step"] = "meeting"
        facts["noteRead"] = True; _full_append_clue(n, "erased-driver")
    elif old_step == "meeting" and target == "A" and action in ("ask", "tell") and room == "office":
        n["step"] = "day1-choice"
    elif old_step == "day1-choice" and target == "A" and action in ("ask", "tell"):
        if any(word in text for word in ("保护", "不要公开", "沉默")):
            n.update(route="protect", choice="protect", day1Route="protect")
            _full_append_clue(n, "care-first")
        elif any(word in text for word in ("审计", "证据", "公开", "保存")):
            n.update(route="audit", choice="audit", day1Route="audit")
            _full_append_clue(n, "audit-request")
        else:
            n.update(route="trust", choice="trust", day1Route="trust")
            _full_append_clue(n, "joint-signature")
        n["step"] = "day1-home"
    elif old_step == "day1-home" and action == "move" and room == "home":
        # Begin inside the overlap between Zhou Ye's handover and Shen Qing's
        # kitchen window so either authored branch is reachable immediately.
        n["day"] = 2; n["step"] = "day2-start"; _full_set_clock(state, 2, 630)
    elif old_step == "day2-start" and action == "move" and room == "station":
        # The player chooses which living character to follow.  The choice is
        # represented by the destination, so it remains usable with buttons
        # and with the bounded natural-language parser.
        n["step"] = "day2-station"
    elif old_step == "day2-start" and action == "move" and room == "kitchen":
        n["step"] = "day2-kitchen"
    elif old_step == "day2-station" and action == "move" and room == "station":
        n["step"] = "day2-station-clue"
    elif old_step == "day2-station" and action == "observe" and room == "station":
        n["step"] = "day2-station-clue"
    elif old_step == "day2-station-clue" and room == "station" and action in ("ask", "observe"):
        facts["umbrellaNumber"] = True; _full_append_clue(n, "handover-card")
        n["step"] = "day2-office"
    elif old_step == "day2-kitchen" and action == "move" and room == "kitchen":
        n["step"] = "day2-recording"
    elif old_step == "day2-kitchen" and action == "observe" and room == "kitchen":
        n["step"] = "day2-recording"
    elif old_step == "day2-recording" and room == "kitchen" and action in ("observe", "use", "ask"):
        facts["recordingHeard"] = True; _full_append_clue(n, "qing-recording"); n["step"] = "day2-office"
    elif old_step == "day2-office" and action == "use" and room == "office":
        n["step"] = "day2-audit"
    elif old_step == "day2-audit" and room == "office" and action in ("use", "ask", "tell"):
        facts["auditSaved"] = True; _full_append_clue(n, "archive-card"); n["step"] = "day2-home"
    elif old_step == "day2-audit" and action == "move" and room == "home":
        # Older tutorial clients treated the card review as the final office
        # step and sent the player home immediately.  Preserve that save path
        # while recording the same evidence as the explicit audit action.
        facts["auditSaved"] = True; _full_append_clue(n, "archive-card")
        # This is the legacy one-click route: arriving home also starts the
        # next authored day, while the current client uses day2-home first.
        n["day"] = 3; n["step"] = "day3-archive"; _full_set_clock(state, 3, 540)
    elif old_step == "day2-home" and action == "move" and room == "home":
        n["day"] = 3; n["step"] = "day3-archive"; _full_set_clock(state, 3, 540)
    elif old_step == "day3-archive" and room == "office" and action in ("observe", "use"):
        facts["passOrigin"] = True; _full_append_clue(n, "future-register"); n["step"] = "day3-hearing"
    elif old_step == "day3-hearing" and room == "office" and action in ("ask", "tell", "observe"):
        n["step"] = "day3-decision"
    elif old_step == "day3-decision" and action in ("ask", "tell", "use"):
        # The first-day stance changes the evidence and relationship context,
        # but the final response is the authoritative ending choice.  Keeping
        # both values makes a replay genuinely interactive instead of making
        # the three final buttons cosmetic.
        if any(word in text for word in ("保护", "不要公开", "沉默")):
            final_choice = "protect"
        elif any(word in text for word in ("审计", "证据", "公开", "保存")):
            final_choice = "audit"
        else:
            final_choice = "trust"
        n["finalChoice"] = final_choice
        n["route"] = final_choice
        n["ending"] = final_choice
        n["step"] = "day3-home"
    elif old_step == "day3-home" and action in ("move", "use", "observe") and room == "home":
        n["step"] = "complete"; n["completed"] = True
    if n["step"] != old_step:
        return _full_guidance(state).get("passage")
    return None


def _full_story_response(state: WorldState, actor: str, request: Event) -> Optional[str]:
    if not is_full_template(state) or actor not in ("A", "B", "C"):
        return None
    n = state.metadata["narrative"]
    room = state.agents["YOU"].room_id
    text = request.payload.get("text", "") or ""
    if actor == "C":
        if room == "station":
            if n.get("day", 1) >= 2:
                return "交班卡上写着 06-17。旧伞不是遗失物，它被送到档案馆后又回到了站里。你要查原始记录，就趁我交班前记下编号。"
            return "我只负责检票，但我记得那班车多等了三分钟。交接卡上没有司机姓名，只有 06-17 这个旧伞编号。"
        return "我现在不在检票口。公开的交班卡还在地铁站，去那里看比听我回忆可靠。"
    if actor == "B":
        if room == "kitchen":
            return "我在厨房听过那段旧录音。有人说‘明天会有人来校对’，日期比你手里的通行证早了一天。声音像档案馆的人。"
        return "我中午才会去厨房。若要听清那段录音，得在我准备午饭时来，过了时间我就会把它收起来。"
    # A
    route = n.get("route")
    if n.get("step") in ("meeting", "day1-choice") and room == "office":
        return "最后一班车为了等一个淋雨的人多停了三分钟。我擦掉司机姓名，是因为上级说这件事会牵出一份还没入档的明天记录。"
    if n.get("step") == "day3-hearing":
        return "通行证不是预言，是档案馆明天的收件回执。有人把它提前放到你桌上，想让这次更正无论谁来都留下署名。"
    if route == "protect":
        return "谢谢你先替我挡住审查。但沉默只能保护今天，不能让被删掉的名字重新出现。"
    if route == "audit":
        return "公开审计会让我的辞职立刻生效，不过原稿、录音和交班卡都会进入同一份记录。"
    return "如果你愿意和我一起署名，我会把照护父亲的安排写进说明。真相不能只靠一个人记住。"


def _full_dialogue(state: WorldState, step: str, objective: str) -> dict:
    n = state.metadata["narrative"]
    names = state.metadata.get("profile", {}).get("names", {})
    a, b, c = names.get("A", "林川"), names.get("B", "沈青"), names.get("C", "周野")
    scripts = {
        "arrival": [("ENV", "narration", "雨下了三天，桌上的通行证却干燥得像刚从明天寄来。"), ("YOU", "thought", "日期比今天早不了一天，而我还没出门。"), ("PLAYER_DOLL", "speech", "先看便笺，今天还有你的工作。"), ("YOU", "thought", "我会把异常记下来，再按自己的日程出发。")],
        "depart": [("ENV", "narration", "便笺写着：十点前到办公室找我。门外的旧伞滴着水。"), ("YOU", "thought", "伞柄上的编号和通行证日期相同。"), ("PLAYER_DOLL", "speech", "开门以后，路上的人也有他们自己的安排。")],
        "station": [("ENV", "narration", "地铁站的玻璃门亮着，周野在检票口看了一眼交接表。"), ("C", "speech", f"我值班到十点。那张告示今天刚换过，你可以自己进去看。")],
        "station-clue": [("ENV", "narration", "末班车晚了三分钟，司机姓名处留着一道被擦白的痕迹。"), ("YOU", "thought", "三分钟和伞柄编号被写进同一页记录。"), ("PLAYER_DOLL", "speech", "把看到的事实带去办公室，不要只带猜测。")],
        "office": [("ENV", "narration", "档案馆的钟指向九点半，原稿和校对表在办公桌上等着你。"), ("YOU", "thought", "今天的工作不是故事之外的事，它正好把我带到答案旁边。")],
        "work": [("ENV", "narration", "红笔划过日期和时刻，原稿背面显出一个被擦掉的司机姓名。"), ("YOU", "thought", "我得先完成校对，再问林川为什么把信推给我。"), ("PLAYER_DOLL", "speech", "十分钟的工作，也是在替未来留下证据。")],
        "meeting": [("ENV", "narration", f"{a}看着墙上的钟，把未封口的辞职信放在原稿旁。"), ("A", "speech", "那班车为救人多停三分钟，但记录只留下晚点，没有留下司机。"), ("YOU", "thought", "他说得像在求助，也像在承认一件还没写进档案的事。")],
        "day1-choice": [("A", "speech", "十点我必须回家照顾父亲。你愿意怎么处理这份记录？"), ("PLAYER_DOLL", "speech", "相信、公开审计，或者先保护他，都由你回答。")],
        "day1-home": [("ENV", "narration", "你把原稿收进包里。雨声没有停，城市按自己的时间继续。"), ("YOU", "thought", "明天还会有一项工作等着我，线索也不会自己整理好。")],
        "day2-start": [("ENV", "narration", "第二天八点半，通行证背面出现了一行新的编号：06-17。"), ("PLAYER_DOLL", "speech", "去找周野的交班卡，或者在沈青做饭时听她留下的录音。")],
        "day2-station": [("ENV", "narration", "周野的交班时间只剩一小时。站台上，旧伞的水痕已经干了。"), ("YOU", "thought", "今天若再错过，线索会变成没人能当面证明的纸。")],
        "day2-station-clue": [("C", "speech", "06-17 是失物交接编号。伞先到档案馆，再被人送回这里。"), ("YOU", "thought", "这让通行证不再像凭空出现。")],
        "day2-kitchen": [("ENV", "narration", "厨房的水壶开始响，沈青把一台旧录音机放在餐桌边。"), ("B", "speech", "我只在午饭前有空。听完以后，我还要去工作。")],
        "day2-recording": [("B", "speech", "录音里有人说：明天会有校对员来，把三分钟写回去。"), ("YOU", "thought", "明天不是预言，是某个已经排进档案的工作日。")],
        "day2-office": [("ENV", "narration", "旧卡片柜在办公桌后面，索引把伞、告示和一张未来收件回执连到一起。"), ("YOU", "thought", "现在轮到我决定，记录是保护一个人，还是公开一件事。")],
        "day2-audit": [("PLAYER_DOLL", "speech", "把线索放在一起，明天的决定才不会只凭情绪。"), ("YOU", "thought", "林川、沈青和周野都在按自己的时间生活。我要承担我的选择。")],
        "day2-home": [("ENV", "narration", "第二天晚上，文件夹里有伞的编号、录音摘要和旧卡片。"), ("YOU", "thought", "明天要面对的是档案馆，也要面对我想成为什么样的人。")],
        "day3-archive": [("ENV", "narration", "第三天，档案馆的收件台摆着一张明天日期的回执。"), ("YOU", "thought", "通行证来自这里：有人提前登记了这次更正，等待一个愿意署名的人。")],
        "day3-hearing": [("A", "speech", "通行证不是预言，是明天的收件回执。我把它提前放到你桌上，是想让记录不再被一个人擦掉。"), ("YOU", "thought", "谜底并没有替我做选择。它只是把责任交到今天。")],
        "day3-decision": [("PLAYER_DOLL", "speech", "最后一页该由你写：共同署名、公开审计，或保护林川暂不公开。"), ("YOU", "thought", "我知道每一种选择都会让某个人失去一些东西。")],
        "day3-home": [("ENV", "narration", "你把更正页和通行证放进同一个文件夹，回到家。"), ("YOU", "thought", "明天已经发生过一次，而这一次的记录由我留下。")],
    }
    lines = scripts.get(step, scripts["arrival"])
    if step == "day3-home" and n.get("ending") in {"trust", "audit", "protect", "missed"}:
        lines = {
            "trust": [
                ("ENV", "narration", "雨在第三天傍晚停了。共同署名的更正页被夹回档案，司机的名字终于没有再被擦掉。"),
                ("A", "speech", "我会把照顾父亲的安排写进说明。谢谢你让我不用一个人承担这三分钟。"),
                ("YOU", "thought", "我没有替任何人写完人生，只是和他们一起把这一页留下。"),
            ],
            "audit": [
                ("ENV", "narration", "公开审计的回执在夜里送达。原稿、录音和交班卡被放进同一份档案，关系也从此有了新的距离。"),
                ("A", "speech", "我会离开原岗位，但至少下一班车的记录不会再缺一行。"),
                ("YOU", "thought", "真相进入公共记录以后，就不再只属于我和林川。"),
            ],
            "protect": [
                ("ENV", "narration", "你把暂存的文件锁进抽屉。雨停了，空白仍在，但林川今晚可以回家照顾父亲。"),
                ("A", "speech", "我知道你替我争取了时间。明天，我会决定什么时候把名字写回去。"),
                ("YOU", "thought", "保护不是结案。这个世界还留着一件必须由我再次打开的事。"),
            ],
            "missed": [
                ("ENV", "narration", "你错过了第一天的谈话窗口，只能把公开物件整理成一份不完整的记录。"),
                ("YOU", "thought", "城市不会因为我迟到而暂停。下一次，我会先把自己的时间也当成线索。"),
            ],
        }[n["ending"]]
    return {"dialogueId": f"{FULL_TEMPLATE_ID}:dialogue-v2:{step}:{n.get('route') or 'open'}:{state.agents['YOU'].room_id}",
            "dialogue": [{"speakerId": s, "kind": k, "text": t} for s, k, t in lines]}


def _full_scene_actions(state: WorldState) -> list[dict]:
    # Keep free exploration available, but never make it the only visible path.
    room = state.agents["YOU"].room_id
    actions = [_action("observe", "观察这里", "观察周围", 2, "查看眼前的公开信息")]
    door = DOOR_IDS.get(room)
    if door in state.objects:
        actions.append(_action("open-door", "开门看看", "去开门，看看里面有啥东西", 2))
    if room == "office":
        actions.append(_action("desk-look", "查看办公桌和卡片柜", "看看办公桌", 2))
    for actor in state.present:
        if actor in ("A", "B", "C") and state.agents[actor].room_id == room:
            name = state.metadata.get("profile", {}).get("names", {}).get(actor, actor)
            actions.append(_action("talk-" + actor, "和" + name + "聊聊", "问" + name + "：今天怎么样？", 3))
    actions.append(_action("wait", "等十分钟", "等待10分钟", 10, "等待会推进世界时间，角色可能按日程离开"))
    return actions


def _full_required_room(step: str) -> Optional[str]:
    return {"arrival": "parlor", "depart": "parlor", "station": "station", "station-clue": "station",
            "office": "office", "work": "office", "meeting": "office", "day1-choice": "office",
            "day1-home": "office", "day2-start": "home", "day2-station": "station", "day2-station-clue": "station",
            "day2-kitchen": "kitchen", "day2-recording": "kitchen", "day2-office": "office", "day2-audit": "office",
            "day2-home": "home", "day3-archive": "office", "day3-hearing": "office", "day3-decision": "office",
            "day3-home": "home"}.get(step)


def _full_guidance(state: WorldState) -> dict:
    n = state.metadata["narrative"]
    room = state.agents["YOU"].room_id
    step = n.get("step", "arrival")
    names = state.metadata.get("profile", {}).get("names", {})
    a, b, c = names.get("A", "林川"), names.get("B", "沈青"), names.get("C", "周野")
    objectives = {
        "arrival": ("第一天 · 明天的日期", "读懂通行证和便笺，开始今天的工作。", "先观察桌面，把日期和自己的日程记下来。"),
        "depart": ("第一天 · 出门", "打开门，沿着通勤路线去地铁站。", "把便笺和通行证带上。"),
        "station": ("第一天 · 多出来的三分钟", "去地铁站，查看站内告示。", "周野正在值班，十点前可以当面询问。"),
        "station-clue": ("第一天 · 被擦掉的名字", "打开玻璃门，记下告示和旧伞编号。", "把看见的事实带去档案馆。"),
        "office": ("第一天 · 你的工作", "回办公室，完成今天的校对。", "林川的谈话窗口从九点到十点。"),
        "work": ("第一天 · 原稿背面", "用办公桌完成十分钟校对。", "工作完成后，才有资格追问这封辞职信。"),
        "meeting": ("第一天 · 未寄出的信", f"在十点前听完{a}的解释。", "这次谈话会改变接下来两天能看到的线索。"),
        "day1-choice": ("第一天 · 由谁署名", "回应林川：共同查证、公开审计，或先保护他。", "不同回应会改变关系和第三天的结局。"),
        "day1-home": ("第一天 · 带着问题回家", "回家整理原稿，明天再追查通行证。", "今天的窗口已经结束，其他人的生活不会停下来。"),
        "day2-start": ("第二天 · 两条线索", "选择去地铁站找周野，或在厨房听沈青的录音。", "现在是十点半，两个人都在自己的生活窗口里。"),
        "day2-station": ("第二天 · 交班前", "赶在周野交班前去地铁站。", "错过后仍可查看公开交班卡，但不会再有当面证明。"),
        "day2-station-clue": ("第二天 · 失物交接卡", "询问周野或观察交班卡，确认旧伞的去向。", "编号把地铁站和档案馆连起来。"),
        "day2-kitchen": ("第二天 · 沈青的录音", "去厨房，在沈青午休前听完录音。", "这是另一条可以验证通行证来源的证词。"),
        "day2-recording": ("第二天 · 明天的声音", "听完录音，再把证词带回办公室。", "录音不能替你作决定，但会留下第三方证据。"),
        "day2-office": ("第二天 · 旧卡片柜", "回办公室，把伞、录音和原稿放在一起。", "明天的回执已经有了来源。"),
        "day2-audit": ("第二天 · 整理证据", "检查旧卡片柜并整理证据，决定明天如何面对档案馆。", "你要承担自己选择的代价。"),
        "day2-home": ("第二天 · 夜里的决定", "回家，把证据带到第三天。", "林川会按自己的日程生活，明早再见。"),
        "day3-archive": ("第三天 · 明天已经发生", "回办公室查看明日收件回执。", "通行证的来源就在档案馆的登记里。"),
        "day3-hearing": ("第三天 · 公开之前", "听林川解释通行证为何提前出现。", "这不是预言，而是一份等待署名的未来记录。"),
        "day3-decision": ("第三天 · 最后一页", "决定共同署名、公开审计，或保护林川暂不公开。", "每条路线都会留下可见的世界后果。"),
        "day3-home": ("第三天 · 雨停以前", "回家收好记录，结束这段教程故事。", "结局会保留在世界里，之后仍可自由行动。"),
    }
    chapter, objective, passage = objectives.get(step, objectives["arrival"])
    required = _full_required_room(step)
    fallback = _full_scene_actions(state)
    actions: list[dict] = []
    if step == "arrival" and room == "parlor": actions = [_action("full-arrival", "查看通行证和便笺", "观察周围", 2)]
    elif step == "depart" and room == "parlor": actions = [_action("full-depart", "开门出发", "开门", 2)]
    elif step == "station" and room != "station": actions = [_action("full-station", "去地铁站", "去地铁站", 5)]
    elif step == "station-clue" and room == "station": actions = [_action("full-station-clue", "打开玻璃门看告示", "去开门，看看里面有啥东西", 2)]
    elif step == "office" and room != "office": actions = [_action("full-office", "去办公室上班", "去办公室", 5)]
    elif step == "work" and room == "office": actions = [_action("full-work", "完成十分钟校对", "使用办公桌", 10)]
    elif step == "meeting" and room == "office": actions = [_action("full-meeting", f"问{a}：辞职信和司机姓名怎么回事？", f"问{a}：辞职信是怎么回事？", 3)]
    elif step == "day1-choice" and room == "office": actions = [_action("full-trust", "和他一起查，留下共同署名", f"问{a}：我相信你，我们一起查。", 3), _action("full-audit", "保存证据，要求公开审计", f"问{a}：我要求公开审计，请把证据留下。", 3), _action("full-protect", "先保护他，不要公开", f"问{a}：我会保护你，暂时不要公开。", 3)]
    elif step == "day1-home" and room != "home": actions = [_action("full-day1-home", "回家整理原稿", "回家", 5)]
    elif step == "day2-start" and room == "home": actions = [_action("full-day2-station", "去地铁站找周野", "去地铁站", 5), _action("full-day2-kitchen", "去厨房找沈青", "去厨房", 5)]
    elif step == "day2-station" and room != "station": actions = [_action("full-day2-station", "去地铁站", "去地铁站", 5)]
    elif step == "day2-station" and room == "station": actions = [_action("full-day2-station-arrived", "查看交班前的站台", "观察周围", 2)]
    elif step == "day2-station-clue" and room == "station": actions = [_action("full-day2-station-clue", "问周野交班卡的编号", f"问{c}：旧伞的编号是什么？", 3), _action("full-day2-station-observe", "观察公开交班卡", "观察周围", 2)]
    elif step == "day2-kitchen" and room != "kitchen": actions = [_action("full-day2-kitchen", "去厨房听录音", "去厨房", 5)]
    elif step == "day2-kitchen" and room == "kitchen": actions = [_action("full-day2-kitchen-arrived", "查看录音机", "观察周围", 2)]
    elif step == "day2-recording" and room == "kitchen": actions = [_action("full-day2-recording", "听完沈青的录音", "观察周围", 2)]
    elif step == "day2-office" and room != "office": actions = [_action("full-day2-office", "回办公室查旧卡片", "去办公室", 5)]
    elif step == "day2-office" and room == "office":
        actions = [_action("full-day2-office-card", "查看旧卡片柜", "看看办公桌", 2, "把伞的编号与档案卡片对上"),
                   # Keep the pre-release id readable for older clients and
                   # saves; the UI hides this compatibility alias.
                   {**_action("desk-look", "查看旧卡片柜", "看看办公桌", 2), "hidden": True}]
    elif step == "day2-audit" and room == "office":
        actions = [_action("full-day2-audit", "整理旧卡片和证据", "看看办公桌", 2),
                   {**_action("full-day2-home", "先回家保存证据", "回家", 5, "兼容旧版教程的直接回家路径"), "hidden": True}]
    elif step == "day2-home" and room != "home": actions = [_action("full-day2-home", "回家保存证据", "回家", 5)]
    elif step == "day3-archive" and room != "office": actions = [_action("full-day3-archive", "去办公室查看明日回执", "去办公室", 5)]
    elif step == "day3-archive" and room == "office": actions = [_action("full-day3-archive", "查看明日收件回执", "看看办公桌", 2)]
    elif step == "day3-hearing" and room == "office": actions = [_action("full-day3-hearing", f"问{a}：通行证从哪里来？", f"问{a}：通行证从哪里来？", 3)]
    elif step == "day3-decision" and room == "office": actions = [_action("full-final-trust", "共同署名，公开留下司机姓名", f"问{a}：我们共同署名，把名字写回去。", 3), _action("full-final-audit", "公开审计，接受关系变化", f"问{a}：公开审计，所有证据一起入档。", 3), _action("full-final-protect", "保护林川，暂不公开", f"问{a}：先保护你，暂时不公开。", 3)]
    elif step == "day3-home" and room != "home": actions = [_action("full-final-home", "回家收好最后一页", "回家", 5)]
    if required and room != required and actions == []:
        actions = [_action("full-return", "去" + ROOM_LABELS[required] + "继续剧情", "去" + ROOM_LABELS[required], 5)]
    actions += [item for item in fallback if item["intent"] not in {a["intent"] for a in actions}]
    ending = n.get("ending")
    if step == "complete":
        labels = {"trust": ("结局 · 共同署名", "通行证来自未来的收件回执。你和林川共同署名，司机姓名恢复，档案馆也记录了你们承担的责任。"),
                  "audit": ("结局 · 公开审计", "所有证据入档，司机姓名恢复。林川离开原岗位，关系变得复杂，但没人再能把三分钟擦掉。"),
                  "protect": ("结局 · 暂存的空白", "你保护了林川，暂时保住他的工作，却把司机姓名留在待审记录里。通行证被收回，未来仍等着有人补上最后一行。"),
                  "missed": ("结局 · 错过窗口", "你错过第一天的谈话，仍靠公开物件查到部分真相，但林川没有再把未寄出的信交给你。")}
        chapter, passage = labels.get(ending, labels["missed"])
        objective = "故事已完成。你可以继续自由生活，或从故事库重新体验另一条路线。"
        actions = fallback
    return {"title": "雨停以前：明天已经发生", "chapter": chapter, "objective": objective, "passage": passage,
            **_full_dialogue(state, step if step != "complete" else "day3-home", objective), "completed": step == "complete",
            "ending": ending, "actions": actions, "playerRoutine": "今日身份：档案馆校对员 · 故事日程：第" + str(n.get("day", 1)) + "天",
            "scheduleHint": f"{a}、{b}、{c}都有自己的时间表；错过窗口后，公开物件仍可能留下替代线索。"}


def _full_validate_saved_narrative(value: Any) -> dict:
    if not isinstance(value, Mapping) or value.get("templateId") != FULL_TEMPLATE_ID or value.get("version") != 2:
        raise ValidationError("saved full narrative is invalid", "invalid_save_payload")
    if value.get("step") not in FULL_STEPS or type(value.get("completed")) is not bool:
        raise ValidationError("saved full narrative step is invalid", "invalid_save_payload")
    if value.get("ending") not in (None, "trust", "audit", "protect", "missed"):
        raise ValidationError("saved full narrative ending is invalid", "invalid_save_payload")
    if value.get("route") not in (None, "trust", "audit", "protect"):
        raise ValidationError("saved full narrative route is invalid", "invalid_save_payload")
    if value.get("step") == "complete" and not value.get("completed"):
        raise ValidationError("saved full narrative completion is invalid", "invalid_save_payload")
    if not isinstance(value.get("facts", {}), Mapping) or not isinstance(value.get("clues", []), list):
        raise ValidationError("saved full narrative facts are invalid", "invalid_save_payload")
    return copy.deepcopy(dict(value))


# Dispatchers are defined last so the v1 implementation above remains intact
# for saves and tests created before the full tutorial was published.
_v1_initialize_story = initialize_story
_v1_advance_story = advance_story
_v1_story_response = story_response
_v1_guidance = guidance
_v1_scene_actions = scene_actions
_v1_expire_story = expire_story
_v1_reconcile_story = reconcile_story
_v1_validate_saved_narrative = validate_saved_narrative


def initialize_story(state: WorldState, metadata: Mapping[str, Any], draft_id: str) -> None:
    if metadata.get("templateId") == FULL_TEMPLATE_ID:
        _full_initialize_story(state, metadata, draft_id)
    else:
        _v1_initialize_story(state, metadata, draft_id)


def advance_story(state: WorldState, request: Event, started_clock: Mapping[str, Any]) -> Optional[str]:
    return _full_advance_story(state, request, started_clock) if is_full_template(state) else _v1_advance_story(state, request, started_clock)


def story_response(state: WorldState, actor: str, request: Event) -> Optional[str]:
    return _full_story_response(state, actor, request) if is_full_template(state) else _v1_story_response(state, actor, request)


def guidance(state: WorldState) -> dict:
    return _full_guidance(state) if is_full_template(state) else _v1_guidance(state)


def scene_actions(state: WorldState) -> list[dict]:
    return _full_scene_actions(state) if is_full_template(state) else _v1_scene_actions(state)


def expire_story(state: WorldState, clock: Mapping[str, Any]) -> Optional[str]:
    if is_full_template(state):
        if _full_deadline_missed(state, clock):
            state.metadata["narrative"].update(step="day1-home", ending="missed", choice="missed")
            return _full_guidance(state).get("passage")
        return None
    return _v1_expire_story(state, clock)


def reconcile_story(state: WorldState, clock: Mapping[str, Any]) -> Optional[dict]:
    if is_full_template(state):
        return None
    return _v1_reconcile_story(state, clock)


def validate_saved_narrative(value: Any) -> dict:
    if isinstance(value, Mapping) and value.get("templateId") == FULL_TEMPLATE_ID:
        return _full_validate_saved_narrative(value)
    return _v1_validate_saved_narrative(value)
