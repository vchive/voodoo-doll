"""《红灯下的第三次回声》：原创三日 Galgame 对白。

Only presentation lives here. Evidence, location, time and endings are supplied
by the story state; rendering neither collects clues nor changes that state.
The railway warning motif is inspired by Dickens' public-domain The Signal-Man,
not by a translation or an existing game's dialogue.
"""
from __future__ import annotations

from typing import Any, Iterable, Mapping


STORY_TITLE = "红灯下的第三次回声"


def _line(speaker: str, kind: str, text: str) -> dict:
    return {"speakerId": speaker, "kind": kind, "text": text}


def _scene(*lines: tuple[str, str, str]) -> list[dict]:
    return [_line(*line) for line in lines]


def _evidence(facts: Mapping[str, Any]) -> str:
    gathered = []
    for key, label in (("manualRed", "首日公开信号记录"), ("dossierRead", "事故原稿"),
                       ("manualWarning", "第二天的交班卡"), ("tapeHeard", "录音摘要")):
        if facts.get(key):
            gathered.append(label)
    return "、".join(gathered) if gathered else "目前能够核验的公开信息"


def _gaps(facts: Mapping[str, Any], b: str, c: str) -> str:
    gaps = []
    if not facts.get("manualWarning"):
        gaps.append(f"没有取得{c}第二天的交班卡")
    if not facts.get("tapeHeard"):
        gaps.append(f"没有听过{b}保存的录音")
    return "；".join(gaps) + "。这些位置保留空白，不拿推测补齐。" if gaps else "交班卡与录音都已核验；没有辨清的声音仍标注为不确定。"


def _elsewhere(step: str, room: str, facts: Mapping[str, Any]) -> list[dict]:
    labels = {"parlor": "会客厅", "bedroom": "卧室", "hall": "走廊", "station": "地铁站", "office": "办公室",
              "home": "家里", "kitchen": "厨房", "street": "街上", "garden": "花园", "attic": "阁楼", "bar": "酒吧"}
    destination = ("办公室" if step in {"dossier", "meeting", "day1-choice", "day3-hearing", "day3-decision"}
                   else "地铁站" if step in {"signal-clue", "day2-station"}
                   else "厨房" if step == "day2-kitchen"
                   else "家里" if step in {"sleep1", "day2-start"} else "原来的地点")
    return _scene(
        ("ENV", "narration", f"你停在{labels.get(room, '此处')}。城市的声音没有因为你离开那张桌子而停下。"),
        ("YOU", "thought", "走开一会儿是我的选择。但别人的一天也会照常往前走。"),
        ("PLAYER_DOLL", "speech", f"那件事还留在{destination}。我们得到了那里，才能继续做。"),
        ("ENV", "narration", "你确认随身的记录，已核验与尚待查证的两栏仍然分得清楚。"),
        ("YOU", "thought", f"我能依靠的是{_evidence(facts)}，不是希望它们能够证明什么。"),
        ("PLAYER_DOLL", "speech", "可以继续逛，也可以回去。先看时间，再决定。"),
    )


def _ending(n: Mapping[str, Any], room: str, facts: Mapping[str, Any], a: str, b: str, c: str) -> list[dict]:
    ending = n.get("ending") or n.get("finalChoice")
    place = "家里的灯下" if room == "home" else "此刻停留的地方"
    evidence, gaps = _evidence(facts), _gaps(facts, b, c)
    if ending == "missed":
        third_day = "day3-hearing" in n.get("missedWindows", [])
        return _scene(
            ("ENV", "narration", "中午已经过去。最后一次可以当面完成说明与选择的机会没有等到你。" if third_day else "十点已经过去。那次可以当面问清楚的机会没有等到你。"),
            ("YOU", "thought", f"我没能在期限内和{a}完成最后的谈话与选择。前两天的调查还在，却不能替今天签名。" if third_day else f"我没能听到{a}第一天的解释。现在替他编一句告别，会比空白更糟。"),
            ("ENV", "narration", f"你在{place}整理笔记，把这一页标成“未完成的调查”。"),
            ("YOU", "thought", f"这一回实际核验过的是{evidence}。它们能回答的，只是它们记下的事。"),
            ("PLAYER_DOLL", "speech", gaps),
            ("ENV", "narration", "收件原件所能证明的登记来源仍在笔记里；它不能代替一次未完成的决定。" if third_day and facts.get("receiptSeen") else "关于那份回执的来历，笔记没有写上一个自信的答案。"),
            ("YOU", "thought", "错过一个人，并不会让整座城消失。可是有些话只有那一刻说，才还是原来的话。"),
            ("PLAYER_DOLL", "speech", "这次就记下：我们来迟了。下次知道怎样安排一天，也是一件真实发生的事。"),
            ("ENV", "narration", "列车继续进站，公开记录仍可查阅。这份存档保留失约的结尾，不把时间倒回去。"),
        )
    if ending == "audit":
        return _scene(
            ("ENV", "narration", f"公开审计的选择已经落在最后一页上。你在{place}重新看见自己的签名。"),
            ("YOU", "thought", f"进入调查的是{evidence}。我签的是来源和责任，不是保证每个人都会喜欢的答案。"),
            ("PLAYER_DOLL", "speech", gaps),
            ("ENV", "narration", f"{a}将离开原岗位接受审查；照护父亲的困难仍要解决，不能由一份正确的报告替他解决。"),
            ("YOU", "thought", "我没有把困难擦掉，也没有让困难替那次改写开脱。两件事必须一起留下。"),
            ("ENV", "narration", "06-17 不再只是“设备延迟”的封闭结论。人工警报与乘客获救的关系进入可追查的更正程序。"),
            ("PLAYER_DOLL", "speech", "顾师傅的动作终于有人去核对。让别人查得到，比替所有人写一个圆满结局更难。"),
            ("YOU", "thought", "三分钟曾被一个词吞掉。今天，我把那个词后面的空隙重新打开。"),
            ("ENV", "narration", "远处的报站声又响起来。明天有人照常上班，也有人必须换一条路回家。"),
            ("ENV", "narration", "《红灯下的第三次回声》· 结局：可以查证的清晨。城市继续运转。"),
        )
    if ending == "protect":
        return _scene(
            ("ENV", "narration", f"你在{place}把最后一页合上，页签露在封面外：暂存，未结。"),
            ("YOU", "thought", f"我选择先保住{a}眼前的生活。这个决定的另一面，是别人暂时看不到更正。"),
            ("ENV", "narration", f"已经保存的材料包括{evidence}；它们没有因为暂不公开而变成不存在。"),
            ("PLAYER_DOLL", "speech", gaps),
            ("YOU", "thought", "我想起那句“等雨停了再说”。雨总会停，拖延却能自己延长。"),
            ("ENV", "narration", "原报告还没有得到公开更正，顾师傅那三分钟的意义也没有因此自动被承认。"),
            ("PLAYER_DOLL", "speech", "你帮他争取了今晚。把“今晚”写清楚，别把它改成“从此”。"),
            ("YOU", "thought", "保护一个人不该等于替他抹掉一件事。我会记住自己留下的是债，不是答案。"),
            ("ENV", "narration", "窗外的雨慢下来。列车照常驶过，未结的页签随着风轻轻抖动。"),
            ("ENV", "narration", "《红灯下的第三次回声》· 结局：留到明天的名字。城市继续运转。"),
        )
    return _scene(
        ("ENV", "narration", f"共同署名的选择已经保存。你在{place}看那两个并排的名字，墨迹的深浅不同。"),
        ("YOU", "thought", f"{a}为改写负责，我为校对负责。站在一起，没有让任何一个人的那一半消失。"),
        ("ENV", "narration", f"更正所依靠的材料是{evidence}。附录逐一写明来源，没有以署名代替查证。"),
        ("PLAYER_DOLL", "speech", gaps),
        ("ENV", "narration", "21:17 的“手动红灯”写回了记录。顾师傅留住列车的动作，终于不再藏在“设备延迟”四个字里。"),
        ("YOU", "thought", "这不证明世上没有难以解释的事。它只证明，这一次，曾经有人听见警报并且伸出了手。"),
        ("PLAYER_DOLL", "speech", "你们还要回答问题，还要上班，还要照顾家人。共同署名只是愿意一起开始。"),
        ("ENV", "narration", "你把未核实的栏位留在下一页。一个完整的决定，可以承认自己仍有不知道的部分。"),
        ("YOU", "thought", "第三次回声不是幽灵叫我。是第一次没被记下的话，终于等到有人回应。"),
        ("ENV", "narration", "《红灯下的第三次回声》· 结局：两个人的笔迹。城市继续运转。"),
    )


def render_scene(step: str, n: Mapping[str, Any], room: str, present: Iterable[str], names: Mapping[str, str]) -> list[dict]:
    """Render only the current place, known evidence and present speakers."""
    raw_facts = n.get("facts", {})
    facts = raw_facts if isinstance(raw_facts, Mapping) else {}
    a, b, c = names.get("A", "林川"), names.get("B", "沈青"), names.get("C", "周野")
    here = set(present or ())
    gaps = _gaps(facts, b, c)
    fixed_rooms = {"arrival": "parlor", "depart": "parlor", "signal-clue": "station", "dossier": "office",
                   "meeting": "office", "day1-choice": "office", "sleep1": "home", "day2-start": "home",
                   "day2-station": "station", "day2-kitchen": "kitchen", "day3-hearing": "office", "day3-decision": "office"}
    if step == "complete":
        return _ending(n, room, facts, a, b, c)
    if step in fixed_rooms and fixed_rooms[step] != room:
        return _elsewhere(step, room, facts)

    if step == "arrival":
        return _scene(
            ("ENV", "narration", "闹钟停在九点。你用拇指擦掉杯沿的水，分不清是昨夜漏进来的雨，还是忘了喝的温水。"),
            ("YOU", "thought", "入职第三天。昨天把“汛期”校成“讯期”，今天最好别再让同事替我返工。"),
            ("ENV", "narration", "工作包旁多了一张硬纸片。它卡在门缝吹进来的便笺下面，边角仍潮着。"),
            ("PLAYER_DOLL", "speech", "你昨晚收包的时候，这里没有它。"),
            ("YOU", "thought", "小墨从来不替我记账，偏偏很擅长记住这些没用的小事。"),
            ("ENV", "narration", "远处一辆列车鸣笛。硬纸片背面的红色圆点，像从那声音里浮起来的一盏灯。"),
            ("PLAYER_DOLL", "speech", "先看看桌上，再出门。读清楚一张纸，总比带着误会跑一天好。"),
        )
    if step == "depart":
        return _scene(
            ("ENV", "narration", "纸片是档案馆的收件通行证，日期却落在明天。便笺只有一行：九点到馆，十点前找我。" if facts.get("passSeen") else "桌上的硬纸片还压着便笺，你没有把上面的字记进笔记。"),
            ("YOU", "thought", "我把手机上的日期看了两次。差一天的不是手机。" if facts.get("passSeen") else "没看过的东西，不能假装已经知道。"),
            ("PLAYER_DOLL", "speech", "门就在前面。你可以先把今天过好，再问明天为什么跑到这里。"),
            ("ENV", "narration", "你找到钥匙，又从衣架上取下那把伞骨有些歪的黑伞。早点铺的蒸汽从门缝钻进来。"),
            ("YOU", "thought", "我还得上班。哪怕有人给我寄来了明天的东西，也不等于今天可以旷工。"),
            ("ENV", "narration", "门把手有凉意。只要把它压下去，屋外的时间就会重新围上来。"),
        )
    if step == "station":
        return _scene(
            ("ENV", "narration", "门已经打开。你还站在原处，雨声比刚才清楚，通勤路线在脑中一站一站亮起来。" if room == "parlor" else "你停下脚步，确认去地铁站的方向。雨没有催你，今天的工作时间却会过去。"),
            ("YOU", "thought", "开门只是开门。得由我决定真正去哪里。"),
            ("PLAYER_DOLL", "speech", "先去地铁站。通行证背面的灯，和那里告示上的图案很像。" if facts.get("passSeen") else "先去地铁站，再到档案馆。你今天仍要通勤。"),
            ("ENV", "narration", "你摸了摸包扣，钥匙、工牌和纸张都没有落下。"),
            ("YOU", "thought", "如果只是一处印错，我会把它改掉。如果不是，也得从能看见的东西查起。"),
            ("PLAYER_DOLL", "speech", "走吧。路上的每一分钟，也属于别人的一天。"),
        )
    if step == "signal-clue":
        return _scene(
            ("ENV", "narration", "地铁站檐口连成一道水帘。玻璃后的值班台没有人，一只搪瓷杯扣着杯盖。" if "C" not in here else "地铁站檐口连成一道水帘。值班台旁的搪瓷杯扣着杯盖，交班簿压在玻璃下。"),
            ("ENV", "narration", "站台挂着一块旧红灯，断电后仍像亮着。旁边的告示贴得很低，得俯身才能看清。"),
            ("YOU", "thought", "我原以为会先遇到一个愿意解释的人。这里先留给我的，是几件不会自己说话的东西。"),
            ("PLAYER_DOLL", "speech", "公开交班簿可以看。信号机手柄只作展示，别把它当成现在能操纵列车的开关。"),
            ("ENV", "narration", "一本簿子的边缘被翻得发毛。有一页夹着褪色红纸，你还没读到被玻璃遮住的那一行。"),
            ("YOU", "thought", "先读，再判断。这至少是我熟悉的工作。"),
        )
    if step == "office":
        return _scene(
            ("ENV", "narration", "你离开玻璃前，把抄下的字和原处又对了一遍。06-17，21:17，手动红灯。" if facts.get("manualRed") else "你检查笔记，公开信号记录的栏位还没有完成核验。"),
            ("YOU", "thought", "同一栏印着“设备延迟”，手写备注却保留着一个人的动作。两个说法不能当作同义词。" if facts.get("signalNotice") else "先保留问题，不要急着填答案。"),
            ("PLAYER_DOLL", "speech", "接下来去办公室。站台上的这一页，得和档案馆保存的原稿放在一起看。"),
            ("ENV", "narration", "雨打在你的伞尖，声音碎而急。工作包里还有昨天带回的饭盒，塑料盖轻轻碰着工牌。"),
            ("YOU", "thought", "我今天原本只打算改错字。现在看起来，错字可能是最轻的一种错误。"),
            ("PLAYER_DOLL", "speech", "十点前的约定还在。要回去问，就别让这段路变成又一次等待。"),
        )
    if step == "dossier":
        return _scene(
            ("ENV", "narration", "办公室的除湿机吃力地响着。你的桌角放着今日校对，封面上是熟悉的 06-17。"),
            ("ENV", "narration", f"{a}把一件折好的外套压在椅背上，袖口补过一针。他没有马上抬头。" if "A" in here else f"{a}不在办公室。靠窗的座位空着，桌上的公开档案仍可核验。"),
            ("YOU", "thought", "先把自己的工作做好。带着猜测追问，只会让他更容易用一句“你看错了”结束谈话。"),
            ("PLAYER_DOLL", "speech", "把事故档案夹摊开。原稿、修改栏和收件信息，都要读到。"),
            ("ENV", "narration", "桌上有一块旧橡皮，擦屑被整齐地拨到纸袋里。你忽然觉得，这里的人很擅长收拾痕迹。"),
            ("YOU", "thought", "擅长收拾，不一定等于想把什么藏起来。我得看完再说。"),
        )
    if step == "meeting":
        base = _scene(
            ("ENV", "narration", "原稿列着三个时间：21:11 首次警报，21:14 重复呼喊，21:17 手动红灯。修订稿把中间两栏并成了“设备延迟”。" if facts.get("dossierRead") else "事故原稿还没有核验。你把问题留在纸边，避免把推断当作内容。"),
            ("YOU", "thought", "删去的不是几分钟。是有人在那几分钟里做过什么。"),
            ("ENV", "narration", "夹页中的收件信息与那张通行证互相对应，日期上的疑点却仍然没有解释。" if facts.get("receiptSeen") else "你还没看过收件信息，不能判断它和通行证是否对应。"),
        )
        if "A" in here:
            base += _scene(
                ("A", "speech", "看完了？先别把疑问写在正本上。这里每一道笔迹，最后都要找到是谁留下的。"),
                ("YOU", "thought", "他说的是规矩，手却按住了修改栏。"),
                ("PLAYER_DOLL", "speech", "现在可以问他。问那次改写，也问被改掉的人。"),
            )
        else:
            base += _scene(
                ("ENV", "narration", f"{a}的座位空着。纸上的问题不会替你把人留住。"),
                ("YOU", "thought", "不能把想象中的回答抄进记录。我得确认是否还赶得上他的公开行程。"),
                ("PLAYER_DOLL", "speech", "看看时间。如果窗口已经过去，就如实记下没能谈成。"),
            )
        return base
    if step == "day1-choice":
        lines = _scene(
            ("ENV", "narration", "除湿机忽然停了一瞬，墙上钟表的秒针因此显得很响。"),
            ("YOU", "thought", "我已经开口问了。这件事不再只是我桌上的一份错稿。"),
        )
        if "A" in here:
            lines += _scene(
                ("A", "speech", "顾师傅拉下了手柄。我当晚负责整理记录，按要求把“手动红灯”改成“设备延迟”。那一笔是我写的。"),
                ("A", "speech", "父亲的康复排班刚定下来，我怕调岗，怕那些好不容易凑齐的时间又散掉。可是顾师傅救下的人，也有自己的家要回。"),
                ("YOU", "thought", "他没有请求我相信他无辜。他只是终于不再把那支笔推给别人。"),
                ("A", "speech", f"{c}知道交班时留下了什么，{b}保存着录音。先查。你今天愿意怎样处理，我会记住，但最后一页要等证据。"),
            )
        else:
            lines += _scene(
                ("ENV", "narration", f"{a}此刻不在场。你没有得到他对下一步的当面回应。"),
                ("YOU", "thought", "知道该问什么，不等于已经谈成。这个空缺也得留下。"),
                ("PLAYER_DOLL", "speech", "他的生活不会停着等我们。是否还能继续谈，得看现在的时间。"),
            )
        lines += _scene(
            ("PLAYER_DOLL", "speech", "共同署名，是一起承担；公开审计，是交给更多人核验；暂时保护，则会把更正留到以后。"),
            ("YOU", "thought", "没有一个选项能让今天没发生。我只能选愿意承担的那一种。"),
        )
        return lines
    if step == "day1-home":
        choice = n.get("choice")
        response = {"trust": "我答应一起署名，却还没有资格替没见过的人保证什么。", "audit": "我选择让别人也能核验。公开不是把疑点写得更像定论。", "protect": "我答应先保护他。我得警惕，这个“先”不能悄悄变成永远。"}.get(choice, "我把今天的选择记下来，明天仍要继续核验。")
        return _scene(
            ("ENV", "narration", "今天的立场已经记录。你收好自己的校对笔，桌上的纸没有因此变轻。" if room == "office" else "你重新检查自己的笔记，今天的立场已经记录，明天的核验仍在等着。"),
            ("YOU", "thought", response),
            ("PLAYER_DOLL", "speech", "先回家。今天听到的，和明天要亲自确认的，分开记。"),
            ("ENV", "narration", "包里的饭盒还是早晨那只。你直到这时才想起，自己一直没打开它。"),
            ("YOU", "thought", "别人的生活不是供我查阅的档案。我想知道真相，也得学会按他们的时间敲门。"),
            ("PLAYER_DOLL", "speech", "我们明天再出发。今天的雨，先让它留在门外。"),
        )
    if step == "sleep1":
        return _scene(
            ("ENV", "narration", "你把饭盒洗净，倒扣在水槽边。小墨坐在干毛巾上，认真避开每一滴溅起来的水。"),
            ("YOU", "thought", "白天的决定还没长成结局。它只是让我明天不能再假装没看见。"),
            ("ENV", "narration", "你在纸上写两行：车站，十一点前；厨房，中午前。下面留了很大一块空白。"),
            ("PLAYER_DOLL", "speech", "可以先去一个地方。没有去到的那条路，就记成没去到。"),
            ("YOU", "thought", "原来安排一天，也是一种选择。睡醒以后，我不会同时站在两个地方。"),
            ("ENV", "narration", "窗外的列车压过轨道接缝。那短促的三声，像有人在很远的地方试着敲门。"),
            ("PLAYER_DOLL", "speech", "今天的调查先到这里。把剩下的家务和休息安排好，我们再睡到明天十点。"),
        )
    if step == "day2-start":
        return _scene(
            ("ENV", "narration", "第二天十点。雨变细了，玻璃上的水痕却比昨天更多。你把昨夜列的行程摊在早餐旁。"),
            ("PLAYER_DOLL", "speech", f"{c}在车站交班前还有一段时间；{b}中午前在厨房。两个人都不会替我们把一天停住。"),
            ("YOU", "thought", "一个可能告诉我手怎样推下去，一个可能让我听见声音怎样传来。"),
            ("ENV", "narration", "面包烤过头的边缘有些苦。你一边咬，一边把车站和厨房的方向分别圈出来。"),
            ("PLAYER_DOLL", "speech", "这次先查一条线，查完回办公室整理。另一条没有验证过，就留作缺口。"),
            ("YOU", "thought", "我要带回能核验的一页，不是凑够一个故事想要的所有道具。"),
            ("ENV", "narration", "你收起纸，钥匙在掌心留下一道浅印。今天从选择往哪走开始。"),
        )
    if step == "day2-station":
        lines = _scene(
            ("ENV", "narration", "地铁站的地面刚拖过，水把顶灯拉成长长的线。玻璃下的交班簿翻到了新的页码。"),
            ("YOU", "thought", "昨天我读到一个动作。今天要问的是，谁见证了它，谁把它留下。"),
        )
        if "C" in here:
            lines += _scene(
                ("ENV", "narration", f"{c}一手拿着杯子，一手检查交班表。杯里的茶早已泡得没有颜色。"),
                ("C", "speech", "还有事就趁交班前问。后面接班的人也要吃饭，我不能让他陪我们延误。"),
                ("C", "speech", "顾师傅当晚管信号，我做交班见证。你得把这两个位置分清，别把我的名字写到他的动作上。"),
                ("PLAYER_DOLL", "speech", "可以问 06-17，也可以自己核对交班簿。先得到记录，再写结论。"),
                ("YOU", "thought", "他先纠正的是署名。我忽然明白，一个名字写错位置，也会改变那晚的故事。"),
            )
        else:
            lines += _scene(
                ("ENV", "narration", f"{c}不在这里。椅子推回了台下，不能因为簿子还在，就假定他的证词也在。"),
                ("PLAYER_DOLL", "speech", "公开的交班簿还能核对。没有当面听到的话，就不要写成他说过。"),
                ("YOU", "thought", "我得把物证与口述分开，尤其是在最想把空白补上的时候。"),
                ("ENV", "narration", "你在玻璃前站定，等一列车的风过去，才重新看向纸页。"),
            )
        return lines
    if step == "day2-kitchen":
        lines = _scene(
            ("ENV", "narration", "厨房的窗开着一条缝。米饭的蒸汽带着葱的甜味，一台旧录音机放在桌上，电线绕了两圈。"),
            ("YOU", "thought", "我差点用查档案的口气开场，又把那句话收了回去。这里也是别人准备午饭的地方。"),
        )
        if "B" in here:
            lines += _scene(
                ("B", "speech", "先坐。锅还有几分钟，我可以给你听一遍，但中午之后我得走。"),
                ("ENV", "narration", f"{b}擦干手，指尖停在播放键旁，没有立刻按下去。"),
                ("B", "speech", "里面不只有警报，还有当事人的声音。你可以记下核验到的内容；要公开，得把来源和用途都写清楚。"),
                ("PLAYER_DOLL", "speech", "准备好了再听。我们还没有听过，不能先写成证据。"),
                ("YOU", "thought", "那枚按键很小。按下去以后，我就要对自己说“听见了”的每个字负责。"),
            )
        else:
            lines += _scene(
                ("ENV", "narration", f"{b}不在厨房。录音机安静地放着，不能替主人同意播放或公开。"),
                ("PLAYER_DOLL", "speech", "这次没有听到。先看时间和行程，别把机器在这里当成证据已经到手。"),
                ("YOU", "thought", "我把“录音”后面的勾擦掉，换成一个空框。"),
                ("ENV", "narration", "窗缝里的风吹动桌布，磁带轮没有转。"),
            )
        return lines
    if step == "day2-office":
        at_desk = room == "office"
        lines = _scene(
            ("ENV", "narration", "你把今天核验的材料放在校对台上，在封面写下来源。" if at_desk else "你还没有回到办公室。先在笔记里记下刚才真正得到的东西，免得路上把推断混进去。"),
            ("YOU", "thought", f"这一轮能整理的是{_evidence(facts)}。"),
        )
        if facts.get("manualWarning"):
            lines += _scene(
                ("ENV", "narration", "第二天的交班卡保留着见证位置与手动红灯备注；它支持的是记录确有改写，不能代替一段没有听过的录音。"),
                ("YOU", "thought", f"顾师傅是实际信号员，{c}是交班见证人。名字要各自在应在的位置上。"),
            )
        elif facts.get("tapeHeard"):
            lines += _scene(
                ("ENV", "narration", "录音摘要里，21:14 的呼喊断在雨声中：“别下来。”它让三个时间点之间第一次有了人的气息。"),
                ("YOU", "thought", "听见过不等于每个字都辨得清。我把不确定的地方标出来，也保留了来源与隐私条件。"),
            )
        else:
            lines += _scene(
                ("ENV", "narration", "这次没有取得第二天的交班卡，也没有听到录音。行程的空缺被留在来源栏里。"),
                ("YOU", "thought", "错过的机会不能靠一句“应该如此”追回。我仍可以整理已有的公开材料。"),
            )
        lines += _scene(
            ("PLAYER_DOLL", "speech", gaps),
            ("YOU", "thought", "我的工作不是把所有材料变成一种声音，而是让以后的人看见它们在哪里一致、在哪里沉默。"),
            ("PLAYER_DOLL", "speech", "整理好以后，把档案保存下来。" if at_desk else "回办公室再正式整理。现在这几行，是提醒自己不要记错。"),
        )
        return lines
    if step == "sleep2":
        if room != "home":
            return _scene(
                ("ENV", "narration", "今天的整理已经保存。你把笔帽扣紧，才发现指尖被笔夹压红了一点。"),
                ("YOU", "thought", "纸上能解释的已经记下，解释不了的也没有被擦掉。"),
                ("PLAYER_DOLL", "speech", "先回家。明天九点再到办公室，看看那张回执的原件。"),
                ("ENV", "narration", "你把未核验项留在醒目的位置。它们不再像疏忽，倒像必须看守的边界。"),
                ("YOU", "thought", "今天剩下的时间，可以留给自己的生活。明天的决定不会因为我多盯一会儿桌子就变得容易。"),
                ("PLAYER_DOLL", "speech", "床不在这里。回去再睡。"),
            )
        return _scene(
            ("ENV", "narration", "回到家，你把湿袜子挂在椅背。灯罩下的小飞虫撞了两次，又安静下来。"),
            ("YOU", "thought", f"今天留下了{_evidence(facts)}。还有空白，但没有伪造的圆满。"),
            ("PLAYER_DOLL", "speech", gaps),
            ("ENV", "narration", "那张日期早到了一天的通行证仍夹在笔记里。纸干了，压痕却没有消失。"),
            ("YOU", "thought", "明天我想问最后一个问题：一个习惯把记录擦干净的人，为什么偏偏留下了它？"),
            ("PLAYER_DOLL", "speech", "今天的调查结束了。做完家务，好好休息，明天九点再去听他自己解释。"),
            ("YOU", "thought", "我把剩下的生活与睡前的安排记好。这一次，明天不会突然出现在桌上；我要亲自走到那里。"),
        )
    if step == "day3-archive":
        if room != "office":
            return _scene(
                ("ENV", "narration", "第三天九点。雨声退到很远的地方，通勤的脚步声重新占了上风。"),
                ("YOU", "thought", "我带着两天的笔记醒来，通行证上那个曾经不合时宜的日期，已经过去。"),
                ("PLAYER_DOLL", "speech", "去办公室找登记原件。先核对纸，再问是谁把它送出来的。"),
                ("ENV", "narration", "你扣好外套，把工牌从包底捞出来。它仍然只是那张普通校对员的工牌。"),
                ("YOU", "thought", "我没有忽然成为什么能替所有人决定命运的人。可那支笔，今天仍然在我手里。"),
                ("PLAYER_DOLL", "speech", "他中午后有别的安排。趁还来得及，出发吧。"),
            )
        return _scene(
            ("ENV", "narration", "办公室的纸比前两天干燥些。你翻到收件登记的位置，新的页码已经贴在封边。"),
            ("YOU", "thought", "通行证上那个数字，应该在这里找到对应。找不到，就把“找不到”记下。"),
            ("ENV", "narration", f"{a}在靠窗处等着，杯子还是空的。" if "A" in here else f"{a}不在办公室。你先核对公开的原件，不替他预写答复。"),
            ("PLAYER_DOLL", "speech", "看事故档案夹中的收件回执。这次把编号、登记方式和原件对起来。"),
            ("YOU", "thought", "我已经不急着给这件事起一个离奇的名字。一个普通的原因，也可能很难说出口。"),
            ("ENV", "narration", "纸页翻过去，发出干净的一声。你把手边的笔放稳，开始核对。"),
        )
    if step == "day3-hearing":
        lines = _scene(
            ("ENV", "narration", "你核对过的编号，出现在更正预约的收件原件上。那张纸与档案馆之间有了一条可查的线。" if facts.get("receiptSeen") else "收件回执的原件还没有核验，关于来历的疑问仍应保留。"),
            ("YOU", "thought", "编号解释了它来自哪一套登记，却还没有解释是谁、为什么把它送到我手里。"),
            ("PLAYER_DOLL", "speech", "来源和动机是两回事。最后这一句，让他自己说。"),
        )
        if "A" in here:
            lines += _scene(
                ("ENV", "narration", f"{a}把袖口往下拉了拉。你看见他一直用指腹压着那处补线。"),
                ("A", "speech", "你查到登记原件了。还有什么想问，趁我走之前问完。"),
                ("YOU", "thought", "我想问的不是“你是不是好人”。那样的问题太容易藏住真正的回答。"),
            )
        else:
            lines += _scene(
                ("ENV", "narration", f"{a}不在这里，最后的当面解释还没有发生。"),
                ("YOU", "thought", "原件能够证明来源，却不能替一个人承认动机。"),
                ("PLAYER_DOLL", "speech", "没有听到的解释就保留缺口。看看时间，再决定怎样处理现有材料。"),
            )
        return lines
    if step == "day3-decision":
        missed = "day3-hearing" in n.get("missedWindows", [])
        lines = _scene(("ENV", "narration", "最后一页摊在桌面。没有预先印好的结论，只有署名、审计与暂存三个位置。"))
        if "A" in here and not missed:
            lines += _scene(
                ("A", "speech", "通行证是我提前送的。日期是更正预约的收件日。我怕自己第二天又撤回申请，就先让别人知道这里有一件没办完的事。"),
                ("A", "speech", "不是预言，也不是有人替我赎罪。我做不到独自走完那几步，才把你牵进来。对不起。"),
                ("YOU", "thought", "原来那张纸不是从明天回来。是一个人把今天不敢完成的事，推到了明天。"),
            )
        else:
            lines += _scene(
                ("ENV", "narration", f"你没有获得{a}此刻的当面解释。原件的登记来源与他的私人动机，仍是不同的问题。"),
                ("YOU", "thought", "决定可以基于现有材料，不能基于一个我替他想好的理由。"),
                ("PLAYER_DOLL", "speech", "这项缺口也写在最后一页上。"),
            )
        lines += _scene(
            ("PLAYER_DOLL", "speech", gaps),
            ("YOU", "thought", f"真正能够进入这次决定的，是{_evidence(facts)}，以及我愿意承担的后果。"),
            ("PLAYER_DOLL", "speech", "一起署名，就一起回答；公开审计，就接受他可能离开岗位；暂存保护，就承认记录还未公开更正。"),
            ("ENV", "narration", "时钟又走了一格。你把笔转正，这一次没有再让它在指间打转。"),
        )
        return lines
    if step == "day3-home":
        route = n.get("ending") or n.get("finalChoice")
        reaction = {"trust": "我写下自己的名字。他的错误没有消失，我的责任也从这一刻开始。", "audit": "我选择公开核验。明天或许会比今天更难，但别人终于有地方可以追问。", "protect": "我留下了暂存的标记。保护换来一些时间，也把未完成的责任交到了我手里。"}.get(route, "最后的选择已经留下。它无法填满所有空白，但属于我。")
        return _scene(
            ("ENV", "narration", "最后的选择已经保存。你把笔放回原处，指尖终于松开。"),
            ("YOU", "thought", reaction),
            ("PLAYER_DOLL", "speech", "回家吧。结尾还要由你把那一页好好收起来。"),
            ("ENV", "narration", "你确认记录没有遗漏未核验项。故事可以结束，事实的缺口不能靠结束而消失。"),
            ("YOU", "thought", "今天之后，我还是要上班、洗饭盒、赶列车。可我大概不会再把“延迟三分钟”轻轻读过去。"),
            ("PLAYER_DOLL", "speech", "别忘了伞。不是每一次雨停，都刚好发生在你要回家的时候。"),
        )
    return _elsewhere(step, room, facts)
