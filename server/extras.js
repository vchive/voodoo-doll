// 002 · 路人 Z（通用路人角色）
//
// Z 不是 agent，不花模型调用，从本地模板里取。
// 关键点：同一个 Z，在不同房间里是不同的身份——
// 街上是路人，酒吧是酒保，办公室是同事。玩家提到的身份优先。
//
// 它只负责一句不带情绪的话，作用是让场面显得"有人在"。
// 环境音（水开了、灯闪了）不归它管，那是 ENV 的事。

const BY_ROOM = {
  bedroom: [
    { who: '隔壁的人', line: '（隔壁传来敲墙声，两下就停了。）' },
    { who: '楼下的人', line: '（楼下有人在停车，车灯扫过窗帘。）' },
  ],
  kitchen: [
    { who: '室友', line: '「你们……要不要我先出去？」' },
    { who: '外卖员', line: '「您好，外卖放门口了。」' },
  ],
  corridor: [
    { who: '邻居', line: '（拎着垃圾袋走过去，脚步慢了一下。）' },
    { who: '快递员', line: '「借过一下。」' },
  ],
  office: [
    { who: '同事', line: '（从他工位后面走过去，没打招呼。）' },
    { who: '前台', line: '「会议室 B 那边有人找。」' },
  ],
  street: [
    { who: '路人', line: '（有人从他们中间穿过去。）' },
    { who: '出租车司机', line: '「走不走？不走我先走了。」' },
  ],
  bar: [
    { who: '酒保', line: '「还要一杯吗？」' },
    { who: '邻座', line: '（旁边那桌的人往这边看了两眼。）' },
  ],
};

// 玩家话里提到的身份优先
const BY_HINT = [
  { re: /同事|工位|加班/, who: '同事', line: '「你们两个……没事吧？」' },
  { re: /保安|门卫/, who: '保安', line: '「这里不能站太久。」' },
  { re: /服务员|店员|买单/, who: '店员', line: '「需要点单吗？」' },
  { re: /父母|妈|爸|家里/, who: '家里人', line: '「你最近怎么老是不高兴。」' },
  { re: /司机|打车|车/, who: '司机', line: '「到底去哪？」' },
];

/**
 * 取一个路人。返回 null 表示这场戏不需要闲人（比如两人独处的私密场面）。
 * 同一句话固定取同一个，避免每次刷新都换人。
 */
export function passerbyFor(roomId, text) {
  const t = String(text || '');
  const hinted = BY_HINT.find((h) => h.re.test(t));
  if (hinted) return { who: hinted.who, line: hinted.line };

  const pool = BY_ROOM[roomId];
  if (!pool || !pool.length) return null;

  let n = 0;
  for (let i = 0; i < t.length; i += 1) n = (n * 31 + t.charCodeAt(i)) % 997;
  const pick = pool[n % pool.length];
  return { who: pick.who, line: pick.line };
}

// 兼容旧名字
export const extrasFor = passerbyFor;
