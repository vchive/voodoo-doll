// MW-36 / SP-21 / MW-AC-36, MW-37 / SP-22 / MW-AC-37,
// and MW-38 / SP-23 / MW-AC-38.
// Drive the shipped UI against an isolated world.
// No page/session from a running game is reused, and no model credentials load.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const cacheKey = 'voodoo-single-player-v1';
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const output = resolve(root, 'artifacts', 'playtest', stamp);
const temporary = await mkdtemp(join(tmpdir(), 'voodoo-playtest-'));
const report = { startedAt: new Date().toISOString(), cases: [], errors: [], sources: {} };
await mkdir(output, { recursive: true });
for (const path of ['scripts/playtest-single-player.mjs', 'hex/play.ts', 'hex/play-state.ts', 'hex/play-guidance.ts', 'hex/play-dialogue.ts', 'hex/play-local.ts', 'hex/play-recovery.ts', 'hex/play-performance.ts', 'hex/play-stage.ts', 'hex/play-stage.css', 'hex/play-art.ts', 'hex/play.css', 'backend/app/gameplay.py', 'backend/app/narrative.py', 'backend/app/signal_story.py', 'dist-hex/index.html']) {
  report.sources[path] = createHash('sha256').update(await readFile(join(root, path))).digest('hex');
}
report.baseCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const portProbe = createServer();
portProbe.listen(0, '127.0.0.1');
await once(portProbe, 'listening');
const port = portProbe.address().port;
await new Promise((done, reject) => portProbe.close(error => error ? reject(error) : done()));
const base = `http://127.0.0.1:${port}`;
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(MODEL_|WORLD_)/.test(key)));
Object.assign(env, { WORLD_HOST: '127.0.0.1', WORLD_PORT: String(port), WORLD_DB_PATH: join(temporary, 'world.sqlite3'), WORLD_STATIC_DIR: join(root, 'dist-hex'), WORLD_COOKIE_SECURE: '0' });
let server, browser, serverLog = '';
async function startServer() {
  server = spawn(process.env.PYTHON || 'python3', ['backend/run.py'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', data => { serverLog += data; });
  server.stderr.on('data', data => { serverLog += data; });
  let launchError;
  server.on('error', error => { launchError = error; });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (launchError) throw launchError;
    if (server.exitCode !== null) throw new Error('独立服务启动失败：' + serverLog.slice(-2000));
    try { if ((await fetch(base + '/healthz')).ok) return; } catch { /* starting */ }
    await delay(100);
  }
  throw new Error('独立服务启动超时');
}
async function stopServer() {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  const stopped = once(server, 'exit');
  server.kill('SIGTERM');
  const timeout = setTimeout(() => server.kill('SIGKILL'), 5000);
  try { await stopped; } finally { clearTimeout(timeout); }
}
const state = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), cacheKey);
const stable = snapshot => ({ roomId: snapshot.roomId, clock: snapshot.clock, narrative: snapshot.narrative });
async function session(page) {
  const response = await page.request.get(base + '/api/v4/session');
  assert(response.ok());
  return response.json();
}
async function settled(page) {
  await page.waitForFunction(() => {
    const button = document.querySelector('#single-tools button');
    return button && !button.disabled;
  });
}
async function startStory(page) {
  await page.goto(base);
  await page.getByRole('button', { name: '开始新手故事', exact: true }).click();
  await page.getByRole('button', { name: '确认进入', exact: true }).click();
  await page.locator('.dialogue-page').waitFor();
  await settled(page);
}
async function readToChoices(page, metrics) {
  const before = metrics.posts.length;
  let count = 0;
  while (await page.locator('.dialogue-page').isVisible()) {
    const current = await state(page);
    const line = current.dialogue.lines[current.dialogue.index];
    if (line.kind === 'narration') assert.equal(await page.locator('.dialogue-speaker').innerText(), current.profile.dollName);
    if (['A', 'B', 'C'].includes(line.speakerId)) assert(current.snapshot.present.includes(line.speakerId), '离场人物不能说话');
    await page.locator('.dialogue-page').click();
    assert(++count < 100, '正文无法读完');
  }
  metrics.readClicks += count;
  assert.equal(metrics.posts.length, before, '阅读不能发出行动请求');
  assert.equal((await state(page)).dialogue.choicesOpen, true);
  const viewport = page.viewportSize();
  const footer = await page.locator('.dialogue-footer').boundingBox();
  assert(footer && footer.y >= 0 && footer.y + footer.height <= viewport.height + 1, '阅读操作越出可视区域');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, '横向溢出');
}
async function nextStoryAction(page, metrics, route, branch, final = route) {
  const current = await state(page);
  const step = current.snapshot.narrative.step;
  const labels = { trust: '共同署名', audit: '审计', protect: '保护' };
  let button = page.locator('[data-story-action="true"]');
  const label = step === 'day1-choice' ? labels[route] : step === 'day3-decision' ? labels[final] : step === 'day2-start' ? (branch === 'station' ? '去车站' : '去厨房') : '';
  if (label) button = button.filter({ hasText: label });
  assert(await button.count(), '缺少推荐行动：' + step);
  const before = metrics.posts.length;
  await button.first().click();
  await page.waitForFunction(({ key, version }) => JSON.parse(localStorage.getItem(key)).snapshot.worldVersion > version, { key: cacheKey, version: current.snapshot.worldVersion });
  await settled(page);
  assert.equal(await page.locator('#intent-preview').count(), 0, '推荐行动重复要求确认');
  assert.equal(metrics.posts.length - before, 2, '一次推荐只发 intent + confirm');
  metrics.actions++;
}
async function walk(page, metrics, target = 'complete', route = 'trust', branch = 'station', final = route) {
  for (let guard = 0; guard < 35; guard++) {
    const current = await state(page);
    await readToChoices(page, metrics);
    if (current.snapshot.narrative.step === target) return current;
    assert.equal(current.snapshot.narrative.completed, false, '提前结束');
    await nextStoryAction(page, metrics, route, branch, final);
  }
  throw new Error('推荐路线没有到达 ' + target);
}
async function openFree(page) {
  if (!await page.locator('#single-explore').isVisible()) await page.getByRole('button', { name: '自由行动', exact: true }).click();
}
async function preview(page, text) {
  await openFree(page);
  await page.locator('#single-input').fill(text);
  await page.locator('#single-send').click();
  await page.locator('#intent-preview').waitFor();
}
async function confirm(page) {
  await page.getByRole('button', { name: '就这样做', exact: true }).click();
  await page.locator('#intent-preview').waitFor({ state: 'detached' });
  await settled(page);
}
async function menu(page, name) {
  if (!await page.locator('.single-menu').evaluate(el => el.open)) await page.locator('.single-menu > summary').click();
  await page.getByRole('button', { name, exact: true }).click();
}
async function exportSave(page) {
  const downloading = page.waitForEvent('download');
  await menu(page, '导出');
  const download = await downloading;
  const path = await download.path();
  await settled(page);
  return { path, payload: JSON.parse(await readFile(path, 'utf8')) };
}
async function importSave(page, path) {
  const choosing = page.waitForEvent('filechooser');
  await menu(page, '导入');
  await (await choosing).setFiles(path);
  await settled(page);
}
const completedSaves = new Map();
async function completedTemplateSave(templateId) {
  if (completedSaves.has(templateId)) return completedSaves.get(templateId);
  // Build fixtures through the real command boundary, not by inventing save
  // fields or editing a user's database. Each fixture owns an isolated cookie.
  const context = await browser.newContext();
  const request = context.request;
  async function post(path, data) {
    const response = await request.post(base + '/api/v4/play/' + path, { data });
    assert(response.ok(), path + ': ' + await response.text());
    return response.json();
  }
  try {
    const draft = await post('story', { templateId, dollName: '小墨', names: { A: '林川', B: '沈青', C: '周野' } });
    let result = await post('story/' + draft.draftId + '/confirm', { expectedVersion: draft.worldVersion });
    let count = 0;
    while (!result.snapshot.narrative.completed) {
      assert(count < 40, '生成旧版结尾存档未能完成');
      const action = result.snapshot.guidance.actions.find(item => !item.hidden && /^(story|full)-/.test(item.id));
      assert(action, '旧版剧情缺少推进动作');
      const turn = await post('intent', { text: action.intent, requestId: 'ending-fixture-' + (++count), expectedVersion: result.snapshot.worldVersion });
      result = await post('intent/' + turn.turnId + '/confirm');
    }
    const response = await request.get(base + '/api/v4/play/save');
    assert(response.ok());
    const payload = await response.json();
    assert.equal(payload.narrative.templateId, templateId);
    const path = join(temporary, templateId + '-complete.json');
    await writeFile(path, JSON.stringify(payload));
    completedSaves.set(templateId, { path, payload, steps: count });
    return completedSaves.get(templateId);
  } finally { await context.close(); }
}
async function assertEndingChoices(page) {
  assert.equal(await page.locator('.dialogue-speaker').innerText(), '这一段故事已结束');
  assert.equal(await page.locator('[data-ending-action="library"]').count(), 1);
  assert.equal(await page.locator('[data-ending-action="map"]').count(), 1);
  assert.equal(await page.locator('[data-story-action="true"]').count(), 0);
  assert.equal(await page.locator('#single-guidance [data-exploration-action="true"]').count(), 0);
  if (page.viewportSize().width === 568) {
    assert(await page.locator('#single-guidance').evaluate(el => el.scrollHeight <= el.clientHeight + 1), '短横屏应同时看见结尾说明与两个出口');
  }
  for (const action of ['library', 'map']) {
    const target = page.locator(`[data-ending-action="${action}"]`);
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    const viewport = page.viewportSize();
    assert(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, '结尾入口不可达：' + action);
  }
}
function trackPage(page, metrics) {
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => metrics.errors.push(error.message));
  page.on('request', request => {
    if (request.method() === 'POST' && request.url().includes('/api/v4/play/')) metrics.posts.push(new URL(request.url()).pathname.replace('/api/v4/play/', ''));
  });
}
async function assertStageLayout(page) {
  const geometry = await page.evaluate(() => {
    const box = selector => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
    };
    return { stage: box('.vn-stage'), dialogue: box('#single-dialogue'), footer: box('.dialogue-footer'),
      width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth };
  });
  const { stage, dialogue, footer, width, height } = geometry;
  assert.equal(geometry.overflow, false, 'Galgame舞台不能横向溢出');
  assert(stage.width > 0 && stage.height > 0, '舞台必须有可见区域');
  assert(dialogue.y > stage.y && dialogue.y < stage.bottom && dialogue.bottom <= stage.bottom + 2, '对话窗应叠在舞台底部');
  assert(dialogue.width > stage.width * .65, '对话窗不应仍是舞台旁的小侧栏');
  assert(footer.x >= 0 && footer.y >= 0 && footer.right <= width + 1 && footer.bottom <= height + 1, '对话操作需处于可视区域');
  return geometry;
}
async function assertIntentPreviewLayout(page) {
  const geometry = await page.locator('#intent-preview').evaluate(preview => {
    const rect = node => {
      const box = node.getBoundingClientRect();
      return { x: box.x, y: box.y, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
    };
    const text = preview.querySelector('.single-preview');
    const css = getComputedStyle(text);
    return { dialogue: rect(document.querySelector('#single-dialogue')), preview: rect(preview), text: rect(text),
      readableHeight: text.clientHeight - parseFloat(css.paddingTop) - parseFloat(css.paddingBottom),
      lineHeight: parseFloat(css.lineHeight) || parseFloat(css.fontSize) * 1.5,
      value: text.textContent.trim(), viewport: { width: innerWidth, height: innerHeight },
      buttons: [...preview.querySelectorAll('button')].map(button => {
        const box = rect(button), hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return { ...box, label: button.textContent, unobstructed: Boolean(hit && button.contains(hit)) };
      }) };
  });
  assert(geometry.value.length > 0, '行动预览必须显示玩家即将执行的文字');
  assert(geometry.readableHeight >= geometry.lineHeight - 1, '行动预览至少保留一整行可读区域，不能被标题和按钮压缩成零');
  assert(geometry.text.y >= geometry.dialogue.y && geometry.text.bottom <= geometry.dialogue.bottom + 1, '预览内容须位于对话窗内');
  assert.equal(geometry.buttons.length, 2, '预览保留确认与取消两个入口');
  for (const button of geometry.buttons) {
    assert(button.height >= 44, '预览按钮必须保留可点击高度：' + button.label);
    assert(button.x >= geometry.dialogue.x - 1 && button.y >= geometry.dialogue.y - 1
      && button.right <= geometry.dialogue.right + 1 && button.bottom <= geometry.dialogue.bottom + 1,
    '预览按钮不能越出对话窗：' + button.label);
    assert(button.x >= 0 && button.y >= 0 && button.right <= geometry.viewport.width + 1 && button.bottom <= geometry.viewport.height + 1,
      '预览按钮必须在可视区域：' + button.label);
    assert(button.unobstructed, '预览按钮不能被其他界面遮挡：' + button.label);
  }
  return geometry;
}
async function assertPublicCast(page, loaded = true) {
  const current = await state(page);
  const cast = await page.locator('.vn-character:not([data-leaving="true"])').evaluateAll(nodes => nodes.map(node => ({
    id: node.dataset.castId, active: node.dataset.active, loaded: Boolean(node.querySelector('img')?.naturalWidth),
  })));
  for (const item of cast) {
    assert(current.snapshot.present.includes(item.id), '立绘不能让离场者出现在舞台：' + item.id);
    const room = current.snapshot.agents?.[item.id]?.roomId;
    assert(!room || room === current.snapshot.roomId, '立绘位置必须与公开世界相符');
    assert(!['YOU', 'PLAYER_DOLL'].includes(item.id), '玩家与娃娃不占对面NPC立绘');
    if (loaded) assert(item.loaded, '在场NPC立绘没有实际加载：' + item.id);
  }
  return cast;
}
async function readPerformanceToChoices(page, metrics, { loaded = true, reducedMotion = false } = {}) {
  const before = await state(page), posts = metrics.posts.length;
  const eventId = await page.locator('.vn-stage').getAttribute('data-action-event');
  let clicks = 0;
  while (await page.locator('.dialogue-page').isVisible()) {
    const current = await state(page);
    const line = current.dialogue.lines[current.dialogue.index];
    const stage = await page.locator('.vn-stage').evaluate(node => ({ mode: node.dataset.mode, speaker: node.dataset.speaker }));
    assert.equal(stage.mode, line.kind);
    if (reducedMotion) assert.equal(await page.locator('.vn-stage').evaluate(node => node.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length), 0, '减少动态时对白高亮也不能播放动画');
    const cast = await assertPublicCast(page, loaded);
    if (line.kind === 'thought') {
      assert.equal(line.speakerId, 'YOU', 'NPC私密心声不能进入公开阅读');
      assert.equal(stage.speaker, 'YOU');
      assert(cast.every(item => item.active === 'false'), '主角沉思不能点亮其他角色');
      metrics.thoughtPages = (metrics.thoughtPages || 0) + 1;
    } else if (line.kind === 'narration') {
      assert.equal(stage.speaker, 'PLAYER_DOLL');
      assert.equal(await page.locator('.vn-doll').getAttribute('data-active'), 'true');
    } else if (/^[A-Z]$/.test(line.speakerId)) {
      assert.equal(stage.speaker, line.speakerId);
      assert(cast.some(item => item.id === line.speakerId && item.active === 'true'), '当前说话人应点亮立绘');
      metrics.spokenIds ||= [];
      if (!metrics.spokenIds.includes(line.speakerId)) metrics.spokenIds.push(line.speakerId);
      if (line.speakerId === 'A' && loaded) await page.screenshot({ path: join(output, metrics.name + '-speaking.png') });
    }
    await page.locator('.dialogue-page').click();
    assert(++clicks < 100, '演出页面无法读完');
  }
  metrics.readClicks += clicks;
  assert.equal(metrics.posts.length, posts, '阅读表情或换页不能提交行动');
  assert.equal(await page.locator('.vn-stage').getAttribute('data-action-event'), eventId, '阅读不能重新产生动作演出');
  assert.deepEqual((await state(page)).snapshot, before.snapshot, '阅读不能改变时间或世界');
  await assertStageLayout(page);
}
async function performWithCue(page, metrics, kind, act) {
  const response = page.waitForResponse(item => item.request().method() === 'POST' && /\/api\/v4\/play\/intent\/[^/]+\/confirm$/.test(new URL(item.url()).pathname));
  await act();
  const receipt = await (await response).json();
  const playerEvent = receipt.events.find(event => event.actor === 'YOU');
  assert(playerEvent?.eventId, '动作必须来自实际确认回执');
  await page.waitForFunction(id => document.querySelector('.vn-stage')?.dataset.actionEvent === id, playerEvent.eventId);
  assert.equal(await page.locator('.vn-stage').getAttribute('data-action'), kind);
  assert(await page.locator('.vn-action').isVisible(), '确认的动作需要有可见反馈');
  metrics.performances ||= [];
  metrics.performances.push({ kind, eventId: playerEvent.eventId, action: playerEvent.action });
  return receipt;
}
async function waitForPortraits(page) {
  await page.waitForFunction(() => [...document.querySelectorAll('.vn-character:not([data-leaving="true"]) img.vn-portrait')]
    .every(image => image.complete && image.naturalWidth > 0));
}
async function scenario(name, viewport, run) {
  if (process.env.PLAYTEST_CASE && !new RegExp(process.env.PLAYTEST_CASE).test(name)) return;
  const context = await browser.newContext({ viewport, acceptDownloads: true });
  const page = await context.newPage();
  const metrics = { name, viewport, actions: 0, readClicks: 0, posts: [], errors: [] };
  trackPage(page, metrics);
  try {
    await startStory(page);
    await run(page, context, metrics);
    assert.deepEqual(metrics.errors, []);
    metrics.passed = true;
    await page.screenshot({ path: join(output, name + '.png'), fullPage: true });
    console.log('通过：' + name);
  } catch (error) {
    metrics.passed = false;
    metrics.failure = String(error.stack || error);
    await page.screenshot({ path: join(output, name + '-failure.png'), fullPage: true }).catch(() => {});
    report.errors.push(name + ': ' + error.message);
    console.error('失败：' + name + ': ' + error.message);
  } finally {
    report.cases.push(metrics);
    await context.close();
  }
}

try {
  await startServer();
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  report.browser = browser.version();
  for (const [width, height] of [[844, 390], [568, 320], [390, 844], [320, 568]]) {
    await scenario(`vn-stage-${width}x${height}`, { width, height }, async (page, context, metrics) => {
      await page.locator('.vn-stage').waitFor();
      await page.waitForFunction(() => document.querySelector('img.vn-background')?.naturalWidth > 0);
      metrics.geometry = await assertStageLayout(page);
      await page.screenshot({ path: join(output, metrics.name + '-arrival.png') });
      assert.equal(await page.locator('.vn-stage').getAttribute('data-action-event'), null, '载入故事不能播放旧行动');
      // Walk the actual recommended commute, inspecting event-driven cues at
      // each step. No direct backend progression or invented cache is used.
      for (const kind of ['inspect', 'open', 'move', 'inspect', 'move']) {
        await waitForPortraits(page);
        await readPerformanceToChoices(page, metrics);
        await performWithCue(page, metrics, kind, () => nextStoryAction(page, metrics, 'trust', 'station'));
      }
      await waitForPortraits(page);
      const office = await state(page);
      assert.equal(office.snapshot.roomId, 'office');
      assert.equal(office.snapshot.narrative.step, 'dossier');
      assert((await assertPublicCast(page)).some(item => item.id === 'A'), '办公室必须实际展示林川立绘');
      await readPerformanceToChoices(page, metrics);
      const beforePreview = (await state(page)).snapshot;
      const priorCue = await page.locator('.vn-stage').getAttribute('data-action-event');
      await preview(page, '使用办公桌');
      metrics.previewGeometry = await assertIntentPreviewLayout(page);
      await page.screenshot({ path: join(output, metrics.name + '-preview.png') });
      assert.equal(await page.locator('.vn-stage').getAttribute('data-action-event'), priorCue, '预览不能触发动作');
      await page.getByRole('button', { name: '先不做', exact: true }).click(); await settled(page);
      assert.equal(await page.locator('.vn-stage').getAttribute('data-action-event'), priorCue, '取消不能触发动作');
      assert.deepEqual((await state(page)).snapshot, beforePreview);
      await preview(page, '使用办公桌');
      await assertIntentPreviewLayout(page);
      await performWithCue(page, metrics, 'work', () => confirm(page));
      await waitForPortraits(page);
      await readPerformanceToChoices(page, metrics);
      assert(metrics.spokenIds.includes('A'), '本轮必须实际读到林川说话和高亮');
      assert(metrics.thoughtPages > 0, '本轮必须实际读到主角心声');
      await preview(page, '去地铁站');
      await performWithCue(page, metrics, 'move', () => confirm(page));
      await page.waitForFunction(() => !document.querySelector('.vn-character[data-cast-id="A"]'));
      await waitForPortraits(page); await assertPublicCast(page);
      const afterMove = (await state(page)).snapshot, posts = metrics.posts.length;
      await page.reload(); await settled(page);
      assert.equal(await page.locator('.vn-stage').getAttribute('data-action-event'), null, '刷新只恢复舞台，不重演动作');
      assert.equal(await page.locator('.vn-action').isVisible(), false);
      assert.equal(metrics.posts.length, posts);
      assert.deepEqual(stable((await state(page)).snapshot), stable(afterMove));
      await assertStageLayout(page);
      const beforeCredits = await state(page);
      const beforeCreditsPosts = metrics.posts.length;
      const beforeCreditsCue = await page.locator('.vn-stage').getAttribute('data-action-event');
      await menu(page, '美术署名');
      await page.locator('dialog.vn-credits').waitFor();
      assert(await page.locator('dialog.vn-credits a').count(), '署名需要提供素材来源');
      await page.locator('dialog.vn-credits').getByRole('button', { name: '回到游戏', exact: true }).click();
      await page.locator('dialog.vn-credits').waitFor({ state: 'detached' });
      assert.equal(metrics.posts.length, beforeCreditsPosts, '查看署名并返回不能执行游戏行动');
      assert.deepEqual((await state(page)).snapshot, beforeCredits.snapshot);
      assert.deepEqual((await state(page)).dialogue, beforeCredits.dialogue, '查看署名并返回应保留阅读位置');
      assert.equal(await page.locator('.vn-stage').getAttribute('data-action-event'), beforeCreditsCue);
      metrics.creditsReturnedWithoutAction = true;
      await assertStageLayout(page);
    });
  }
  await scenario('vn-reduced-motion', { width: 568, height: 320 }, async (page, context, metrics) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload(); await settled(page);
    await readPerformanceToChoices(page, metrics);
    await performWithCue(page, metrics, 'inspect', () => nextStoryAction(page, metrics, 'trust', 'station'));
    assert.equal(await page.locator('.vn-stage').evaluate(node => node.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length), 0, '减少动态时舞台不能播放动画');
    await readPerformanceToChoices(page, metrics);
    await performWithCue(page, metrics, 'open', () => nextStoryAction(page, metrics, 'trust', 'station'));
    assert.equal(await page.locator('.vn-stage').evaluate(node => node.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length), 0);
    assert.equal((await state(page)).snapshot.narrative.step, 'station');
    await preview(page, '去办公室');
    await performWithCue(page, metrics, 'move', () => confirm(page));
    await waitForPortraits(page);
    await preview(page, '问林川：你好');
    await performWithCue(page, metrics, 'speak', () => confirm(page));
    await readPerformanceToChoices(page, metrics, { reducedMotion: true });
    assert(metrics.spokenIds.includes('A'), '减少动态模式也必须实际展示说话人');
    metrics.reducedMotion = true;
  });
  await scenario('vn-art-fallback', { width: 844, height: 390 }, async (page, context, metrics) => {
    await page.route('**/*', route => route.request().resourceType() === 'image' ? route.abort() : route.continue());
    await page.reload(); await settled(page);
    await page.waitForFunction(() => document.querySelector('.vn-stage')?.dataset.backgroundFallback === 'true');
    await preview(page, '去办公室');
    await performWithCue(page, metrics, 'move', () => confirm(page));
    await page.locator('.vn-character[data-cast-id="A"] .vn-portrait-fallback').waitFor();
    await page.waitForFunction(() => document.querySelector('.vn-character[data-cast-id="A"] img.vn-portrait')?.hidden);
    assert.equal(await page.locator('.vn-character[data-cast-id="A"] img.vn-portrait').isVisible(), false);
    await readPerformanceToChoices(page, metrics, { loaded: false });
    assert(await page.locator('[data-story-action="true"]').first().isVisible(), '图片失败仍能选择行动');
    await preview(page, '开门');
    await performWithCue(page, metrics, 'open', () => confirm(page));
    assert(await page.locator('.dialogue-page').isVisible(), '图片失败仍能读到动作反馈');
    assert.equal((await state(page)).snapshot.roomId, 'office');
    metrics.artFailure = 'All image requests deliberately aborted; text, recommendations and confirmed actions stayed usable.';
  });
  for (const [width, height] of [[844, 390], [568, 320], [390, 844]]) {
    await scenario(`ending-v2-${width}x${height}`, { width, height }, async (page, context, metrics) => {
      const fixture = await completedTemplateSave('rainy-office-v2');
      await importSave(page, fixture.path);
      await readToChoices(page, metrics);
      const original = (await state(page)).snapshot;
      assert.equal(original.narrative.completed, true);
      assert.equal(original.narrative.ending, 'trust');
      metrics.fixtureSteps = fixture.steps;
      metrics.initialChoices = await page.locator('#single-guidance').innerText();
      await assertEndingChoices(page);
      await page.reload(); await settled(page);
      await assertEndingChoices(page);
      assert.deepEqual(stable((await state(page)).snapshot), stable(original));
      let beforePosts = metrics.posts.length;
      await page.locator('[data-ending-action="map"]').click();
      assert(await page.locator('#single-explore').isVisible());
      assert(await page.locator('#single-travel').evaluate(el => el.open));
      assert.equal(metrics.posts.length, beforePosts, '打开地图不能推进行动');
      assert.deepEqual(stable((await state(page)).snapshot), stable(original));
      // The map's first click opens destinations; selecting one performs a
      // real move while keeping the previously earned ending authoritative.
      const moving = page.waitForResponse(response => response.request().method() === 'POST' && /\/api\/v4\/play\/intent\/[^/]+\/confirm$/.test(new URL(response.url()).pathname));
      await page.locator('#single-travel').getByRole('button', { name: '地铁站', exact: true }).click();
      const moveReceipt = await (await moving).json();
      await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).snapshot.roomId === 'station', cacheKey);
      await settled(page);
      const afterMove = await state(page);
      const responseTexts = moveReceipt.events.flatMap(event => event.actor !== 'YOU' && typeof event.payload?.text === 'string' ? [event.payload.text] : []);
      assert(afterMove.dialogue.lines.length > 0);
      assert(afterMove.dialogue.lines.every(line => responseTexts.includes(line.text)), '结束后移动只演出实际反馈，不能重播旧结尾正文');
      metrics.moveFeedback = afterMove.dialogue.lines.map(line => line.text);
      await readToChoices(page, metrics);
      const explored = (await state(page)).snapshot;
      assert.equal(metrics.posts.length - beforePosts, 2);
      assert.equal(explored.clock.minute, original.clock.minute + 5);
      assert.deepEqual(explored.narrative, original.narrative);
      metrics.actions++;
      // Ordinary actions remain available in Free Action, not as a fake
      // next chapter occupying the ending's primary choices.
      await openFree(page);
      for (const name of ['观察周围', '开门看看']) assert(await page.locator('#single-quick-actions').getByRole('button', { name, exact: true }).isVisible());
      await page.getByRole('button', { name: '收起自由行动', exact: true }).click();
      // A completed-story choice window is shorter than ordinary reading.
      // Preview must expand it without inheriting the ending-only geometry.
      const endingBeforePreview = await state(page);
      const endingCue = await page.locator('.vn-stage').getAttribute('data-action-event');
      const endingPreviewPosts = metrics.posts.length;
      await preview(page, '观察这里');
      metrics.endingPreviewGeometry = await assertIntentPreviewLayout(page);
      await page.screenshot({ path: join(output, metrics.name + '-preview.png') });
      assert.equal(await page.locator('.vn-stage').getAttribute('data-action-event'), endingCue, '结尾预览不能触发演出');
      assert.deepEqual((await state(page)).snapshot, endingBeforePreview.snapshot);
      await page.getByRole('button', { name: '先不做', exact: true }).click();
      await page.locator('#intent-preview').waitFor({ state: 'detached' }); await settled(page);
      assert.equal(await page.locator('.vn-stage').getAttribute('data-action-event'), endingCue, '结尾取消预览不能产生动作cue');
      assert.deepEqual((await state(page)).snapshot, endingBeforePreview.snapshot, '结尾取消预览不得改变世界或结局');
      assert.deepEqual((await state(page)).dialogue, endingBeforePreview.dialogue, '结尾取消预览应恢复原阅读和选项');
      assert.equal((await state(page)).pending, undefined);
      assert.equal(metrics.posts.length - endingPreviewPosts, 2, '结尾预览取消只允许草稿与取消请求');
      assert(metrics.posts.slice(endingPreviewPosts).every(path => !path.endsWith('/confirm')), '结尾取消预览不得确认行动');
      assert.deepEqual(stable((await session(page)).snapshot), stable(explored));
      await assertEndingChoices(page);
      beforePosts = metrics.posts.length;
      await page.locator('[data-ending-action="library"]').click();
      await page.locator('#single-return-story').waitFor();
      assert.equal(metrics.posts.length, beforePosts, '打开故事库不能新建世界');
      assert.deepEqual(stable((await session(page)).snapshot), stable(explored));
      await page.locator('#single-return-story').click(); await settled(page);
      await assertEndingChoices(page);
      assert.deepEqual(stable((await state(page)).snapshot), stable(explored));
      await page.locator('[data-ending-action="library"]').click();
      await page.getByRole('button', { name: '开始新手故事', exact: true }).click();
      await page.getByRole('button', { name: '改一改', exact: true }).click(); await settled(page);
      assert.equal((await state(page)).pending, undefined);
      await page.locator('#single-return-story').click(); await settled(page);
      await assertEndingChoices(page);
      assert.deepEqual(stable((await session(page)).snapshot), stable(explored), '取消新故事不能丢失原结局');
      await page.locator('[data-ending-action="library"]').click();
      await page.getByRole('button', { name: '开始新手故事', exact: true }).click();
      await page.getByRole('button', { name: '确认进入', exact: true }).waitFor();
      const newDraft = (await state(page)).pending.id;
      assert.deepEqual(stable((await session(page)).snapshot), stable(explored), '新故事预览不能改世界');
      await page.getByRole('button', { name: '确认进入', exact: true }).click(); await settled(page);
      assert.equal((await state(page)).snapshot.narrative.templateId, 'signal-rain-v1');
      assert.equal((await state(page)).snapshot.narrative.completed, false);
      const retained = await page.evaluate(key => JSON.parse(localStorage.getItem(key + '-before-story')), cacheKey);
      assert.equal(retained.draftId, newDraft);
      assert.deepEqual(retained.save.narrative, explored.narrative);
      assert.equal(retained.save.snapshot.roomId, 'station');
      const downloading = page.waitForEvent('download');
      await menu(page, '旧进度');
      const backup = await downloading;
      const backupPath = await backup.path();
      assert.deepEqual(JSON.parse(await readFile(backupPath, 'utf8')), retained.save);
      await importSave(page, backupPath); await readToChoices(page, metrics);
      await assertEndingChoices(page);
      const restored = (await state(page)).snapshot;
      assert.deepEqual(restored.narrative, explored.narrative, '备份必须能恢复到原 v2 结局');
      assert.equal(restored.roomId, explored.roomId, '备份必须能恢复到原探索位置');
      assert.equal(restored.clock.day, explored.clock.day);
      assert.equal(restored.clock.minute, explored.clock.minute);
      assert.equal(restored.clock.clockVersion, explored.clock.clockVersion);
      metrics.ending = explored.narrative.ending;
    });
  }
  await scenario('ending-v1-postscript', { width: 568, height: 320 }, async (page, context, metrics) => {
    await importSave(page, (await completedTemplateSave('rainy-office-v1')).path);
    await readToChoices(page, metrics);
    const original = (await state(page)).snapshot.narrative;
    assert.equal(original.completed, true);
    assert.equal(original.postscript.step, 'ready');
    assert.equal(await page.locator('[data-ending-action]').count(), 0, '完成主线但仍有支线时不能隐藏支线');
    assert.match(await page.locator('[data-story-action="true"]').first().innerText(), /开始第二天支线/);
    for (let count = 0; count < 8 && !(await state(page)).snapshot.narrative.postscript.completed; count++) {
      await nextStoryAction(page, metrics, 'trust', 'station');
      await readToChoices(page, metrics);
    }
    const after = (await state(page)).snapshot.narrative;
    assert.equal(after.postscript.completed, true);
    assert.equal(after.ending, original.ending);
    await assertEndingChoices(page);
    await page.reload(); await settled(page); await assertEndingChoices(page);
    metrics.ending = after.ending;
  });
  // Each investigation branch must support all three final stances.
  for (const [route, branch, width, height] of [
    ['trust', 'station', 844, 390], ['audit', 'station', 568, 320], ['protect', 'kitchen', 667, 375],
    ['trust', 'kitchen', 844, 390], ['audit', 'kitchen', 390, 844], ['protect', 'station', 667, 375],
  ]) await scenario(`${route}-${branch}`, { width, height }, async (page, context, metrics) => {
    const current = await walk(page, metrics, 'complete', route, branch);
    assert.equal(current.snapshot.narrative.ending, route);
    assert.equal(current.snapshot.narrative.finalChoice, route);
    assert.equal(current.snapshot.guidance.completed, true);
    assert.equal(current.snapshot.roomId, 'home');
    assert.equal(current.snapshot.clock.day, 3);
    assert.equal(current.snapshot.narrative.facts.tapeHeard, branch === 'kitchen');
    assert.equal(current.snapshot.narrative.facts.manualWarning, branch === 'station');
    assert.deepEqual((await session(page)).snapshot.narrative, current.snapshot.narrative);
    await assertEndingChoices(page);
    const endPosts = metrics.posts.length;
    await page.locator('[data-ending-action="library"]').click();
    await page.locator('#single-return-story').click(); await settled(page);
    await assertEndingChoices(page);
    assert.equal(metrics.posts.length, endPosts, '结局打开故事库再返回不能执行行动');
    assert.deepEqual(stable((await state(page)).snapshot), stable(current.snapshot));
    await page.getByRole('button', { name: '手记 · 日程', exact: true }).click();
    assert.match(await page.locator('#single-notebook').innerText(), /教程完成/);
    await page.getByRole('button', { name: '收起手记与日程', exact: true }).click();
    const saved = await exportSave(page);
    assert.equal(saved.payload.narrative.ending, route);
    await page.reload();
    await settled(page);
    assert.equal((await state(page)).dialogue.choicesOpen, true, '最终阅读位置刷新丢失');
    assert.equal((await state(page)).snapshot.narrative.ending, route);
    metrics.ending = route;
    metrics.branch = branch;
  });

  await scenario('missed-day1', { width: 844, height: 390 }, async (page, context, metrics) => {
    await walk(page, metrics, 'day1-choice');
    await waitForPortraits(page);
    const beforeCast = await assertPublicCast(page);
    assert(beforeCast.some(item => item.id === 'A' && item.loaded), '等待前必须实际加载林川立绘');
    metrics.scheduleDeparture = { id: 'A', beforeCast, beforeClock: (await state(page)).snapshot.clock };
    await page.screenshot({ path: join(output, metrics.name + '-before-wait.png') });
    await preview(page, '等待60分钟'); await confirm(page);
    await page.waitForFunction(() => !document.querySelector('.vn-character[data-cast-id="A"]'));
    metrics.scheduleDeparture.afterCast = await assertPublicCast(page);
    metrics.scheduleDeparture.afterClock = (await state(page)).snapshot.clock;
    await readToChoices(page, metrics);
    let current = await state(page);
    assert.equal(current.snapshot.narrative.ending, 'missed');
    assert.equal(current.snapshot.guidance.completed, true);
    assert(current.snapshot.narrative.missedWindows.includes('day1-meeting'));
    assert(!current.snapshot.present.includes('A'));
    await preview(page, '回家'); await confirm(page);
    await page.reload(); await settled(page);
    assert.equal((await state(page)).snapshot.narrative.ending, 'missed');
  });

  await scenario('missed-day3', { width: 844, height: 390 }, async (page, context, metrics) => {
    await walk(page, metrics, 'day3-hearing');
    await waitForPortraits(page);
    const beforeCast = await assertPublicCast(page);
    assert(beforeCast.some(item => item.id === 'A' && item.loaded), '第三日等待前必须实际加载林川立绘');
    metrics.scheduleDeparture = { id: 'A', beforeCast, beforeClock: (await state(page)).snapshot.clock };
    await page.screenshot({ path: join(output, metrics.name + '-before-wait.png') });
    await preview(page, '等待120分钟'); await confirm(page);
    await preview(page, '等待60分钟'); await confirm(page);
    await page.waitForFunction(() => !document.querySelector('.vn-character[data-cast-id="A"]'));
    metrics.scheduleDeparture.afterCast = await assertPublicCast(page);
    metrics.scheduleDeparture.afterClock = (await state(page)).snapshot.clock;
    await readToChoices(page, metrics);
    const current = await state(page);
    assert.equal(current.snapshot.narrative.ending, 'missed');
    assert.equal(current.snapshot.guidance.completed, true);
    assert(current.snapshot.narrative.missedWindows.includes('day3-hearing'));
    assert(!current.snapshot.present.includes('A'));
    const saved = await exportSave(page);
    await preview(page, '回家'); await confirm(page);
    await importSave(page, saved.path);
    assert.deepEqual((await state(page)).snapshot.narrative, current.snapshot.narrative);
  });

  for (const branch of ['station', 'kitchen']) await scenario(`missed-${branch}`, { width: 667, height: 375 }, async (page, context, metrics) => {
    await walk(page, metrics, 'day2-' + branch, 'trust', branch);
    const scheduledId = branch === 'station' ? 'C' : 'B';
    await waitForPortraits(page);
    const beforeCast = await assertPublicCast(page);
    assert(beforeCast.some(item => item.id === scheduledId && item.loaded), '等待前必须实际加载支线人物立绘：' + scheduledId);
    metrics.scheduleDeparture = { id: scheduledId, beforeCast, beforeClock: (await state(page)).snapshot.clock };
    await page.screenshot({ path: join(output, metrics.name + '-before-wait.png') });
    await preview(page, '等待120分钟'); await confirm(page);
    await page.waitForFunction(id => !document.querySelector(`.vn-character[data-cast-id="${id}"]`), scheduledId);
    metrics.scheduleDeparture.afterCast = await assertPublicCast(page);
    metrics.scheduleDeparture.afterClock = (await state(page)).snapshot.clock;
    const current = await state(page);
    assert.equal(current.snapshot.narrative.facts.tapeHeard, false);
    assert.equal(current.snapshot.narrative.facts.manualWarning, false);
    assert(!current.snapshot.present.includes(branch === 'station' ? 'C' : 'B'));
    await walk(page, metrics, 'complete', 'trust', branch, 'audit');
    assert.equal((await state(page)).snapshot.narrative.ending, 'audit');
    assert.equal((await state(page)).snapshot.narrative.facts.tapeHeard, false);
  });

  await scenario('save-recovery', { width: 390, height: 844 }, async (page, context, metrics) => {
    await walk(page, metrics, 'day2-kitchen', 'protect', 'kitchen');
    const before = await state(page);
    await preview(page, '开门');
    assert.deepEqual(stable((await state(page)).snapshot), stable(before.snapshot));
    await page.reload(); await page.locator('#intent-preview').waitFor();
    await page.getByRole('button', { name: '先不做', exact: true }).click(); await settled(page);
    assert.deepEqual(stable((await state(page)).snapshot), stable(before.snapshot));
    await openFree(page);
    assert.equal(await page.locator('#single-input').inputValue(), '开门');
    await page.locator('#single-input').fill('去月球'); await page.locator('#single-send').click();
    await page.locator('#intent-error').waitFor(); await settled(page);
    assert((await state(page)).log.some(item => item.text === '去月球' && item.status === 'rejected'));
    assert.deepEqual(stable((await state(page)).snapshot), stable(before.snapshot));
    const bad = join(temporary, 'broken.json'); await writeFile(bad, '{broken');
    await importSave(page, bad);
    assert.deepEqual(stable((await state(page)).snapshot), stable(before.snapshot));
    const saved = await exportSave(page);
    await preview(page, '去花园'); await confirm(page);
    await importSave(page, saved.path);
    assert.deepEqual((await state(page)).snapshot.narrative, before.snapshot.narrative);
    assert.equal((await state(page)).snapshot.roomId, 'kitchen');
    // Test cookie/database recovery across an actual process restart.
    const restored = await state(page);
    await stopServer(); await startServer();
    await page.reload(); await settled(page);
    assert.equal((await state(page)).snapshot.worldId, restored.snapshot.worldId);
    assert.deepEqual((await state(page)).snapshot.narrative, restored.snapshot.narrative);
    await walk(page, metrics, 'complete', 'protect', 'kitchen', 'audit');
    assert.equal((await state(page)).snapshot.narrative.ending, 'audit');
  });

  await scenario('save-independent-session', { width: 844, height: 390 }, async (page, context, metrics) => {
    await walk(page, metrics, 'day2-kitchen', 'protect', 'kitchen');
    const before = (await state(page)).snapshot;
    const midway = await exportSave(page);
    const copyContext = await browser.newContext({ viewport: { width: 844, height: 390 }, acceptDownloads: true });
    try {
      const copy = await copyContext.newPage(); trackPage(copy, metrics);
      await startStory(copy);
      assert.notEqual((await state(copy)).snapshot.worldId, before.worldId);
      await importSave(copy, midway.path);
      assert.notEqual((await state(copy)).snapshot.worldId, before.worldId);
      assert.deepEqual((await state(copy)).snapshot.narrative, before.narrative);
      assert.equal((await state(copy)).snapshot.roomId, before.roomId);
      await walk(copy, metrics, 'complete', 'protect', 'kitchen', 'audit');
      const complete = (await state(copy)).snapshot;
      const ending = await exportSave(copy);
      // Restore the completed copy into the original, different cookie world.
      await importSave(page, ending.path);
      assert.equal((await state(page)).snapshot.worldId, before.worldId);
      assert.deepEqual((await state(page)).snapshot.narrative, complete.narrative);
      await readToChoices(page, metrics);
      await preview(page, '观察周围'); await confirm(page);
      assert.equal((await state(page)).snapshot.narrative.ending, 'audit');
      assert.equal((await state(page)).snapshot.narrative.completed, true);
      assert.deepEqual((await session(copy)).snapshot.narrative, complete.narrative, '导入另一世界不能改变原世界');
    } finally { await copyContext.close(); }
  });

  await scenario('confirmation-retry', { width: 568, height: 320 }, async (page, context, metrics) => {
    await preview(page, '去地铁站');
    const pending = (await state(page)).pending.id;
    const pattern = '**/api/v4/play/intent/*/confirm';
    await page.route(pattern, async route => { await route.fetch(); await route.abort(); });
    await page.getByRole('button', { name: '就这样做', exact: true }).click();
    await page.getByText('确认结果还不知道，连接恢复后可原地重试', { exact: true }).waitFor();
    const committed = (await session(page)).snapshot;
    assert.equal(committed.roomId, 'station');
    await page.unroute(pattern);
    await confirm(page);
    assert.deepEqual(stable((await state(page)).snapshot), stable(committed));
    assert.equal((await state(page)).log.filter(item => item.eventId === 'turn:' + pending).length, 1);
    assert.equal((await session(page)).snapshot.worldVersion, committed.worldVersion);
  });

  await scenario('cancel-after-lost-response', { width: 844, height: 390 }, async page => {
    await preview(page, '去地铁站');
    const pending = (await state(page)).pending.id;
    const pattern = '**/api/v4/play/intent/*/confirm';
    await page.route(pattern, async route => { await route.fetch(); await route.abort(); });
    await page.getByRole('button', { name: '就这样做', exact: true }).click();
    await page.getByText('确认结果还不知道，连接恢复后可原地重试', { exact: true }).waitFor();
    const committed = (await session(page)).snapshot;
    await page.unroute(pattern);
    await stopServer(); await startServer();
    await page.getByRole('button', { name: '先不做', exact: true }).click();
    await page.locator('#intent-preview').waitFor({ state: 'detached' }); await settled(page);
    assert.deepEqual(stable((await state(page)).snapshot), stable(committed));
    assert.equal((await state(page)).log.filter(item => item.eventId === 'turn:' + pending).length, 1);
    assert.equal((await session(page)).snapshot.worldVersion, committed.worldVersion, '恢复结果不得重演行动');
  });

  await scenario('cancel-without-network', { width: 667, height: 375 }, async page => {
    const before = await state(page);
    await preview(page, '去地铁站');
    const pending = (await state(page)).pending.id;
    const pattern = '**/api/v4/play/intent/*/cancel';
    await page.route(pattern, route => route.abort());
    await page.getByRole('button', { name: '先不做', exact: true }).click();
    await page.waitForFunction(() => {
      const button = document.querySelector('#intent-preview button');
      return button && !button.disabled && !document.querySelector('#single-state').textContent.includes('正在取消');
    });
    assert.equal((await state(page)).pending.id, pending, '未知取消结果不能清掉预览');
    assert.deepEqual(stable((await state(page)).snapshot), stable(before.snapshot));
    await page.unroute(pattern);
    await page.getByRole('button', { name: '先不做', exact: true }).click(); await settled(page);
    assert.equal((await state(page)).pending, undefined);
    assert.deepEqual(stable((await session(page)).snapshot), stable(before.snapshot));
  });

  await scenario('offline-reconnect', { width: 390, height: 844 }, async (page, context, metrics) => {
    const online = (await session(page)).snapshot;
    await page.route('**/api/v4/**', route => route.abort());
    await preview(page, '去地铁站');
    assert((await state(page)).pending.id.startsWith('local-'));
    await page.unroute('**/api/v4/**');
    await page.reload(); await page.locator('#intent-preview').waitFor();
    assert.equal((await state(page)).offline, true, '联网不能将本机预览伪装成在线');
    await confirm(page);
    assert.equal((await state(page)).snapshot.roomId, 'station');
    assert.equal((await state(page)).offline, true);
    assert.match(await page.locator('#single-state').innerText(), /本地试玩/);
    assert.deepEqual(stable((await session(page)).snapshot), stable(online));
    await page.reload(); await settled(page);
    assert.equal((await state(page)).snapshot.roomId, 'station', '离线已确认进度重连不能静默丢失');
    assert.equal((await state(page)).offline, true);
    const localSave = await exportSave(page);
    assert.equal(localSave.payload.payload.snapshot.roomId, 'station');
    await menu(page, '回到在线故事'); await settled(page);
    assert.equal((await state(page)).offline, false);
    assert.deepEqual(stable((await state(page)).snapshot), stable(online));
    const downloading = page.waitForEvent('download');
    await menu(page, '离线备份');
    const download = await downloading;
    const backup = JSON.parse(await readFile(await download.path(), 'utf8'));
    assert.equal(backup.payload.snapshot.roomId, 'station');
    // The retained branch is portable through the existing import boundary.
    await importSave(page, localSave.path);
    assert.equal((await state(page)).snapshot.roomId, 'station');
    assert.equal((await state(page)).offline, false);
    const restored = (await state(page)).snapshot;
    assert.equal(restored.agents.YOU.roomId, restored.roomId);
    // PLAYER_DOLL is a logical controller, not a public character projection;
    // its matching location is covered by the backend import regression.
    assert.equal(restored.guidance.actions[0].intent, '去客厅', '恢复后推荐应与真实位置相符');
    await walk(page, metrics, 'complete');
    assert.equal((await state(page)).snapshot.narrative.ending, 'trust', '离线存档恢复后仍应能完成故事');
  });

  await scenario('damaged-preview-cache', { width: 568, height: 320 }, async page => {
    const before = (await state(page)).snapshot;
    for (const pending of [{ kind: 'intent', id: 'broken-intent' }, { kind: 'story', id: 'broken-story', preview: {} }]) {
      // Deliberately damage only presentation cache; authoritative story stays untouched.
      await page.evaluate(({ key, pending }) => {
        const saved = JSON.parse(localStorage.getItem(key)); saved.pending = pending;
        localStorage.setItem(key, JSON.stringify(saved));
      }, { key: cacheKey, pending });
      await page.reload(); await settled(page);
      assert.equal((await state(page)).pending, undefined);
      assert.deepEqual(stable((await state(page)).snapshot), stable(before));
      assert(await page.evaluate(key => Boolean(localStorage.getItem(key + '-pre-repair-backup')), cacheKey));
    }
    await preview(page, '开门');
    await page.getByRole('button', { name: '先不做', exact: true }).click(); await settled(page);
  });

  await scenario('story-cancel-after-restart', { width: 844, height: 390 }, async page => {
    await menu(page, '故事库');
    await page.getByRole('button', { name: '开始新手故事', exact: true }).click();
    await page.getByRole('button', { name: '确认进入', exact: true }).waitFor();
    const pattern = '**/api/v4/play/story/*/confirm';
    await page.route(pattern, async route => { await route.fetch(); await route.abort(); });
    await page.getByRole('button', { name: '确认进入', exact: true }).click();
    await page.getByText('确认结果还不知道，连接恢复后可原地重试', { exact: true }).waitFor();
    const committed = (await session(page)).snapshot;
    await page.unroute(pattern);
    await stopServer(); await startServer();
    await page.getByRole('button', { name: '改一改', exact: true }).click();
    await settled(page);
    await page.locator('.dialogue-page').waitFor();
    assert.equal((await state(page)).pending, undefined);
    assert.deepEqual(stable((await state(page)).snapshot), stable(committed));
    assert.equal((await session(page)).snapshot.worldVersion, committed.worldVersion);
  });

  await scenario('story-cancel-without-network', { width: 390, height: 844 }, async page => {
    const before = (await state(page)).snapshot;
    await menu(page, '故事库');
    await page.getByRole('button', { name: '开始新手故事', exact: true }).click();
    await page.getByRole('button', { name: '确认进入', exact: true }).waitFor();
    const pending = (await state(page)).pending.id;
    const pattern = '**/api/v4/play/story/*/cancel';
    await page.route(pattern, route => route.abort());
    await page.getByRole('button', { name: '改一改', exact: true }).click();
    await page.waitForFunction(() => {
      const button = document.querySelector('#story-actions button');
      return button && !button.disabled && !document.querySelector('#single-state').textContent.includes('正在撤回');
    });
    assert.equal((await state(page)).pending.id, pending);
    await page.unroute(pattern);
    await page.getByRole('button', { name: '改一改', exact: true }).click(); await settled(page);
    assert.equal((await state(page)).pending, undefined);
    assert.deepEqual(stable((await session(page)).snapshot), stable(before));
  });

  await scenario('expired-preview-recovery', { width: 568, height: 320 }, async page => {
    const before = (await state(page)).snapshot;
    await preview(page, '去地铁站');
    let pending = (await state(page)).pending.id;
    assert((await page.request.post(base + '/api/v4/play/intent/' + pending + '/cancel')).ok());
    await page.getByRole('button', { name: '先不做', exact: true }).click(); await settled(page);
    assert.equal((await state(page)).pending, undefined);
    assert.deepEqual(stable((await state(page)).snapshot), stable(before));
    await menu(page, '故事库');
    await page.getByRole('button', { name: '开始新手故事', exact: true }).click();
    await page.getByRole('button', { name: '确认进入', exact: true }).waitFor();
    pending = (await state(page)).pending.id;
    assert((await page.request.post(base + '/api/v4/play/story/' + pending + '/cancel')).ok());
    await page.getByRole('button', { name: '改一改', exact: true }).click(); await settled(page);
    assert.equal((await state(page)).pending, undefined);
    assert.deepEqual(stable((await state(page)).snapshot), stable(before));
  });

  for (const kind of ['intent', 'story']) for (const recovery of ['retry', 'cancel']) {
    await scenario(`other-tab-${kind}-${recovery}`, { width: 844, height: 390 }, async (page, context, metrics) => {
      if (kind === 'intent') await preview(page, '去地铁站');
      else {
        await menu(page, '故事库');
        await page.getByRole('button', { name: '开始新手故事', exact: true }).click();
        await page.getByRole('button', { name: '确认进入', exact: true }).waitFor();
      }
      const pattern = `**/api/v4/play/${kind}/*/confirm`;
      await page.route(pattern, async route => { await route.fetch(); await route.abort(); });
      await page.getByRole('button', { name: kind === 'intent' ? '就这样做' : '确认进入', exact: true }).click();
      await page.getByText('确认结果还不知道，连接恢复后可原地重试', { exact: true }).waitFor();
      await page.unroute(pattern);
      const other = await context.newPage(); trackPage(other, metrics);
      await other.goto(base);
      // Real tabs share the saved pending preview. Recover it in the second
      // tab first; the first tab still holds its unresolved preview in memory.
      if (kind === 'intent') {
        await other.locator('#intent-preview').waitFor(); await confirm(other);
      } else {
        await other.getByRole('button', { name: '确认进入', exact: true }).click(); await settled(other);
      }
      await preview(other, '去办公室'); await confirm(other);
      const current = (await session(other)).snapshot;
      assert.equal(current.roomId, 'office');
      const label = kind === 'intent' ? (recovery === 'retry' ? '就这样做' : '先不做') : (recovery === 'retry' ? '确认进入' : '改一改');
      await page.getByRole('button', { name: label, exact: true }).click(); await settled(page);
      assert.equal((await state(page)).pending, undefined);
      assert.deepEqual(stable((await state(page)).snapshot), stable(current), '旧确认回执不能把世界倒退');
      assert.deepEqual((await state(page)).dialogue.lines, (await state(page)).snapshot.guidance.dialogue.map(line => ({ ...line, speakerId: line.kind === 'narration' ? 'PLAYER_DOLL' : line.speakerId })), '恢复当前对白，不演出旧回执');
      assert.equal((await session(page)).snapshot.worldVersion, current.worldVersion);
      await other.close();
    });
  }

  await scenario('known-newer-snapshot', { width: 667, height: 375 }, async (page, context, metrics) => {
    await preview(page, '去地铁站');
    const pattern = '**/api/v4/play/intent/*/confirm';
    await page.route(pattern, async route => { await route.fetch(); await route.abort(); });
    await page.getByRole('button', { name: '就这样做', exact: true }).click();
    await page.getByText('确认结果还不知道，连接恢复后可原地重试', { exact: true }).waitFor();
    await page.unroute(pattern);
    // A same-session client with separate presentation storage leaves the
    // first client's pending preview intact across its reload.
    const peer = await browser.newContext({ viewport: { width: 667, height: 375 }, storageState: { cookies: await context.cookies(), origins: [] } });
    try {
      const other = await peer.newPage(); trackPage(other, metrics);
      await other.goto(base); await settled(other);
      await preview(other, '去办公室'); await confirm(other);
      const current = (await session(other)).snapshot;
      await page.reload(); await page.locator('#intent-preview').waitFor();
      assert.equal((await state(page)).snapshot.worldVersion, current.worldVersion);
      await page.route('**/api/v4/session', route => route.abort());
      await confirm(page);
      assert.deepEqual(stable((await state(page)).snapshot), stable(current), '刷新查询失败不能丢掉已知较新快照');
    } finally { await peer.close(); }
  });
} catch (error) {
  report.errors.push(String(error.stack || error));
  console.error(error);
} finally {
  await browser?.close();
  await stopServer();
  report.finishedAt = new Date().toISOString();
  report.passed = report.errors.length === 0 && report.cases.length > 0;
  report.database = env.WORLD_DB_PATH;
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(join(output, 'server.log'), serverLog);
  console.log('试玩报告：' + join(output, 'report.json'));
  process.exitCode = report.passed ? 0 : 1;
}
