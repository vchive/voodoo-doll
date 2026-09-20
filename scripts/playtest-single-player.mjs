// MW-36 / SP-21 / MW-AC-36. Drive the shipped UI against an isolated world.
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
for (const path of ['scripts/playtest-single-player.mjs', 'hex/play.ts', 'hex/play-state.ts', 'hex/play-local.ts', 'hex/play-recovery.ts', 'hex/play.css', 'backend/app/gameplay.py', 'backend/app/signal_story.py', 'dist-hex/index.html']) {
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
function trackPage(page, metrics) {
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => metrics.errors.push(error.message));
  page.on('request', request => {
    if (request.method() === 'POST' && request.url().includes('/api/v4/play/')) metrics.posts.push(new URL(request.url()).pathname.replace('/api/v4/play/', ''));
  });
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
    assert.equal(await page.locator('[data-story-action="true"]').count(), 0);
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
    await preview(page, '等待60分钟'); await confirm(page);
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
    await preview(page, '等待120分钟'); await confirm(page);
    await preview(page, '等待60分钟'); await confirm(page);
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
    await preview(page, '等待120分钟'); await confirm(page);
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
