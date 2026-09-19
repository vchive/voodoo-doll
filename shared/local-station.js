// 002 · 本地站（无模型时的剧本来源）
//
// 服务端在三种情况下用它：
//   - 没有配置模型
//   - 编排失败或超时
//   - 模型返回未通过契约校验
//
// 它只输出结构合法的剧本，不假装有理解能力。
// 环境（ENV）的本地反馈也在这里：没有模型时环境也得会"应一声"。

import { CONTRACT_VERSION } from './script-contract.js';
import { CAST, ROOM_IDS } from './cast.js';
import { objectsOf } from './environment.js';

const ROOM_HINTS = [
  { room: 'kitchen', words: ['厨房', '做饭', '吃', '灶', '碗', '餐'] },
  { room: 'corridor', words: ['走廊', '楼道', '电梯', '楼梯', '门外', '过道'] },
  { room: 'office', words: ['公司', '办公室', '加班', '工位', '同事', '开会', '会议'] },
  { room: 'street', words: ['街上', '路边', '马路', '外面', '楼下'] },
  { room: 'bar', words: ['酒吧', '喝酒', '一杯', '吧台'] },
  { room: 'bedroom', words: ['家', '房间', '卧室', '床', '睡', '窗', '沙发', '客厅'] },
];

function pickRoom(text) {
  const t = String(text || '');
  for (const hint of ROOM_HINTS) {
    if (hint.words.some((w) => t.includes(w))) return hint.room;
  }
  return null;
}

const ROOM_SPOTS = {
  bedroom: ['door', 'window', 'bed', 'middle'],
  kitchen: ['door', 'stove', 'table', 'middle'],
  corridor: ['far', 'near', 'side', 'middle'],
  office: ['door', 'desk', 'away', 'middle'],
  street: ['near', 'far', 'corner', 'middle'],
  bar: ['door', 'bar', 'corner', 'middle'],
};

function spotsOf(roomId) {
  return ROOM_SPOTS[roomId] || ROOM_SPOTS.bedroom;
}

// ---- 环境的本地反馈 ----
//
// 按物件与动作给一句话。没有模型时它很套路，但至少环境不是死的。
// 每个物件一句"被动"反应（有人对它做了什么）与一句"主动"闲话（没人碰它时）。

const ENV_REACTIONS = {
  lamp: { off: '灯灭了。屋里只剩窗外那点光。', on: '灯亮了，晃得人眯了一下眼。', knock: '台灯歪了一下，没倒。' },
  window: { open: '窗开了，外面的风把窗帘掀起来。', close: '窗关上，屋里一下就静了。', look: '窗外什么都没有，只有对面楼的灯。' },
  bed: { sit: '床垫陷下去一块。', lie: '床发出一声很轻的响。', hit: '枕头被砸了一下，没什么声音。' },
  phone: { ring: '手机在桌上震了两下，屏幕亮了又暗。', silence: '手机被按灭了。', throw: '手机砸在床上，弹了一下。', check: '屏幕亮着，没有新消息。' },
  door: { slam: '门被甩上，墙上的画晃了晃。', open: '门开了一条缝，走廊的光进来。', lock: '锁扣咔哒一声。', knock: '有人敲门。三下。' },
  kettle: { boil: '水开了，壶盖哒哒地跳。', pour: '水倒进杯子，冒起一层白气。', knock: '水壶被碰了一下，晃了晃。' },
  tap: { run: '水龙头开着，水声盖住了别的声音。', stop: '水停了。' },
  cup: { drop: '杯子摔在地上，碎了。', fill: '杯子满了。', hold: '杯子被握着，一直没放下。' },
  fridge: { open: '冰箱门开着，冷气往外冒。', close: '冰箱门关上，压缩机嗡了一声。' },
  light: { flicker: '走廊灯闪了两下。', off: '走廊灯灭了。', on: '走廊灯亮起来。' },
  elevator: { ding: '电梯叮了一声，门开了，没人出来。', open: '电梯门开了。', close: '电梯门合上。' },
  stairs: { step: '楼梯上有脚步声，越来越远。', sit: '有人在台阶上坐下。' },
  printer: { jam: '打印机卡纸了，一直在响。', print: '打印机吐出一张纸。', kick: '打印机被踹了一脚，安静了。' },
  computer: { type: '键盘声很急。', off: '屏幕黑了。', look: '屏幕上什么都没有。' },
  chair: { sit: '椅子转了半圈。', kick: '椅子撞在桌腿上。', push: '椅子被推开，轮子响了一路。' },
  car: { horn: '有辆车按了一声喇叭。', start: '车发动了。', pass: '一辆车开过去，溅起水。' },
  rain: { start: '雨开始下了。', stop: '雨停了。' },
  streetlight: { flicker: '路灯闪了一下。', off: '路灯灭了，街上暗下来。', on: '路灯亮了。' },
  bench: { sit: '长椅上有人坐下，木头吱了一声。', kick: '长椅被踹了一脚。' },
  glass: { drop: '酒杯碎在地上。', refill: '酒续上了。', hold: '酒杯一直握着。', slide: '酒杯在吧台上滑过去。' },
  music: { loud: '音乐突然大了。', stop: '音乐停了，酒吧一下子安静得吓人。', change: '换了一首歌。' },
  lights: { dim: '灯暗下来。', on: '灯亮了。', flicker: '灯闪了一下。' },
};

const ENV_IDLE = {
  bedroom: '窗外有车灯扫过天花板。',
  kitchen: '冰箱在嗡嗡响。',
  corridor: '楼上有脚步声，停了。',
  office: '打印机一直在响。',
  street: '有辆车在路边熄了火。',
  bar: '音乐在放，没人在听。',
};

/**
 * 环境对一组 use 动作的本地反馈。
 * 返回 speak（role: ENV）beats，最多两条。
 */
export function localEnvReactions(roomId, uses, startAt) {
  const beats = [];
  let at = startAt;
  for (const u of uses.slice(0, 2)) {
    const table = ENV_REACTIONS[u.target];
    const text = table && table[u.verb];
    if (!text) continue;
    beats.push({ at, action: 'speak', role: 'ENV', target: u.target, text });
    at += 1200;
  }
  if (!beats.length) {
    const idle = ENV_IDLE[roomId] || ENV_IDLE.bedroom;
    beats.push({ at, action: 'speak', role: 'ENV', text: idle });
  }
  return beats;
}

// ---- 娃娃的本地建议 ----

function localAdvice(input) {
  const doubt = Number(input.doubt) || 0;
  const t = String(input.text || '');
  if (doubt >= 6 || /算了|不演|放下|够了|休息|睡/.test(t)) {
    return { text: '今晚就到这儿吧。你眼睛都睁不开了。', tone: 'warn' };
  }
  if (doubt >= 4) return { text: '你已经连着几天没好好睡了。', tone: 'note' };
  if (doubt >= 2) return { text: '我会照做。你自己心里有数就行。', tone: 'object' };
  return null;
}

/**
 * 本地站主入口。输出 v3 契约的剧本。
 */
export function localScript(input) {
  const text = String(input.text || '');
  const roomId = input.roomId || pickRoom(text) || 'bedroom';
  const spots = spotsOf(roomId);
  const advice = localAdvice(input);

  const present = (input.present || []).filter((id) => CAST[id] && CAST[id].kind !== 'extra');
  const villain = present.find((id) => CAST[id].role === 'villain') || 'A';
  const you = 'YOU';

  const vSpot = spots.includes('window') ? 'window' : spots[1] || 'middle';
  const ySpot = spots.includes('door') ? 'door' : spots[0] || 'middle';

  const beats = [
    { at: 0, action: 'move', role: villain, spot: vSpot === ySpot ? 'middle' : vSpot },
    { at: 500, action: 'move', role: you, spot: ySpot },
  ];
  const uses = [];

  if (/难受|尴尬|说不出|失声|开不了口|闭嘴|哑|声音/.test(text)) {
    beats.push({ at: 1600, action: 'speak', role: villain, text: '我……我今天嗓子有点……' });
    beats.push({ at: 3000, action: 'speak', role: you, text: '你说啊。' });
    beats.push({ at: 4200, action: 'burst', role: villain, effect: 'wave' });
  } else if (/出丑|丢脸|当众|看见|揭穿|被知道|撞见|发现|被人/.test(text)) {
    beats.push({ at: 1600, action: 'speak', role: villain, text: '我什么时候说过那种话？' });
    beats.push({ at: 3000, action: 'speak', role: you, text: '你自己听。' });
    beats.push({ at: 4200, action: 'burst', role: villain, effect: 'split' });
  } else if (/冷淡|不理|冷落|忽视|看不见|透明/.test(text)) {
    beats.push({ at: 1600, action: 'speak', role: villain, text: '你在听我说话吗？' });
    // 玩家角色不回话，转身去关灯——环境会接这一手
    const lampLike = objectsOf(roomId).find((o) => o.verbs.includes('off'));
    if (lampLike) {
      beats.push({ at: 3000, action: 'use', role: you, target: lampLike.id, verb: 'off' });
      uses.push({ target: lampLike.id, verb: 'off' });
    }
    beats.push({ at: 4200, action: 'shake', role: villain });
  } else if (/关系|打结|散|断|拆|分开|疏远|线/.test(text)) {
    beats.push({ at: 1600, action: 'speak', role: you, text: '你们之间那条线，我看得见。' });
    beats.push({ at: 4200, action: 'burst', role: villain, effect: 'knot' });
  } else if (/摔|砸|甩门|踢/.test(text)) {
    // 玩家要动手：反派摔门，环境反馈
    const door = objectsOf(roomId).find((o) => o.id === 'door');
    if (door) {
      beats.push({ at: 1600, action: 'use', role: villain, target: 'door', verb: 'slam' });
      uses.push({ target: 'door', verb: 'slam' });
    }
    beats.push({ at: 3000, action: 'speak', role: you, text: '走了倒好。' });
  } else if (/我自己|缝回|算了|放下|不演|够了|休息|不想|睡吧/.test(text)) {
    return {
      version: CONTRACT_VERSION,
      source: 'local',
      ack: '今晚不演他。我陪你待一会儿。',
      ask: null,
      advice,
      options: [],
      beats: [
        { at: 0, action: 'move', role: you, spot: 'middle' },
        { at: 800, action: 'move', role: villain, spot: spots[spots.length - 1] },
        { at: 2200, action: 'speak', role: 'doll', text: '他退到看不太清的地方去了。' },
        { at: 3600, action: 'burst', role: you, effect: 'mend' },
        { at: 4800, action: 'ambient', role: 'ENV', light: 'dim' },
        { at: 5000, action: 'speak', role: 'ENV', text: '灯暗下来一点。' },
      ],
      aftermath: '这一页没有他。',
      roster: [],
    };
  } else {
    return {
      version: CONTRACT_VERSION,
      source: 'local',
      ack: null,
      ask: `我不太确定你想让我做什么。「${text.slice(0, 14)}」—— 你是想让他难受，还是想让他被发现？`,
      advice,
      options: ['让他难受', '让他被发现', '今晚先算了'],
      beats: [],
      aftermath: null,
      roster: [],
    };
  }

  // 环境在人物之后应一声
  const lastAt = Math.max(...beats.map((b) => b.at));
  beats.push(...localEnvReactions(roomId, uses, lastAt + 900));

  beats.sort((a, b) => a.at - b.at);
  return {
    version: CONTRACT_VERSION,
    source: 'local',
    ack: '我按你说的排了一场。他们自己会开口。',
    ask: null,
    advice,
    options: [],
    beats,
    aftermath: null,
    roster: [villain, you],
  };
}

export { pickRoom, ROOM_IDS };
