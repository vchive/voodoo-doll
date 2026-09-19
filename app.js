(() => {
  'use strict';
  const STORAGE_KEY = 'voodoo-cabinet-v1';
  const today = () => new Date().toLocaleDateString('sv-SE');
  const defaults = () => ({ name: '', avatar: '', fabric: '#8e5a48', accessory: 'ribbon', mana: 72, pins: 0, pinParts: [], visits: 1, lastVisit: today(), spellDay: today(), spellsToday: 0, history: [], candle: true, breath: true, scene: 'amber', sound: false });
  let state = defaults();
  let storageAvailable = true;
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved && typeof saved === 'object') state = { ...state, ...saved };
  } catch { storageAvailable = false; }
  const fabrics = ['#8e5a48', '#827754', '#5d7270', '#735369', '#b58b56'];
  state.mana = Math.max(0, Math.min(100, Number.isFinite(Number(state.mana)) ? Number(state.mana) : 72));
  state.pins = Math.max(0, Math.min(3, Number(state.pins) || 0));
  state.pinParts = Array.isArray(state.pinParts) ? [...new Set(state.pinParts.filter(x => ['额头','心口','手腕'].includes(x)))].slice(0,3) : ['额头','心口','手腕'].slice(0, state.pins);
  state.pins = state.pinParts.length;
  state.history = Array.isArray(state.history) ? state.history.filter(x => x && typeof x.text === 'string').slice(0, 30) : [];
  state.name = typeof state.name === 'string' ? state.name.slice(0, 12) : '';
  state.avatar = typeof state.avatar === 'string' && /^data:image\/(webp|png|jpeg);base64,/.test(state.avatar) ? state.avatar : '';
  state.fabric = fabrics.includes(state.fabric) ? state.fabric : fabrics[0];
  state.accessory = ['ribbon', 'bell', 'none'].includes(state.accessory) ? state.accessory : 'ribbon';
  if (state.lastVisit !== today()) {
    state.visits = Math.max(1, Number(state.visits) || 1) + 1;
    state.lastVisit = today();
    state.mana = Math.min(100, state.mana + 25);
  }
  if (state.spellDay !== today()) { state.spellDay = today(); state.spellsToday = 0; }
  state.spellsToday = Math.max(0, Number(state.spellsToday) || 0);
  const $ = id => document.getElementById(id);
  const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  let toastTimer, lastFocus, cleanupModal = () => {}, isDisplay = false, wakeLock = null, beforeDisplayScroll = 0;
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); return true; }
    catch { if (storageAvailable) toast('本地空间不足，本次设置仅在当前页面生效'); storageAvailable = false; return false; }
  }
  function render() {
    $('manaValue').textContent = state.mana;
    $('dollName').textContent = state.name || 'NO. 001';
    $('avatarLetter').textContent = Array.from(state.name || 'V')[0].toUpperCase();
    $('avatarImage').src = state.avatar || '';
    $('dollFace').classList.toggle('has-image', Boolean(state.avatar));
    $('doll').style.setProperty('--fabric', state.fabric);
    $('accessoryRibbon').hidden = state.accessory !== 'ribbon';
    $('accessoryBell').hidden = state.accessory !== 'bell';
    $('pinCounter').textContent = `${state.pins} / 3`;
    $('spellCount').textContent = state.spellsToday;
    $('streakText').textContent = ` · 第 ${state.visits} 夜`;
    $('candleToggle').checked = state.candle;
    $('breathToggle').checked = state.breath;
    $('soundToggle').checked = state.sound;
    document.body.classList.toggle('moon-scene', state.scene === 'moon');
    document.querySelectorAll('[data-scene]').forEach(b => { b.classList.toggle('selected', b.dataset.scene === state.scene); b.setAttribute('aria-pressed', b.dataset.scene === state.scene); });
    document.querySelectorAll('#doll .pin-pin').forEach(pin => { pin.classList.toggle('inserted', state.pinParts.includes(pin.dataset.part)); pin.setAttribute('aria-pressed', state.pinParts.includes(pin.dataset.part)); });
    document.body.classList.toggle('no-candle', !state.candle);
    document.body.classList.toggle('no-breath', !state.breath);
  }
  function toast(message) {
    clearTimeout(toastTimer);
    $('toast').textContent = message;
    $('toast').classList.add('show');
    toastTimer = setTimeout(() => $('toast').classList.remove('show'), 3000);
  }
  function vibrate(pattern = 20) { if (navigator.vibrate) navigator.vibrate(pattern); }
  function animateDoll(className = 'sway') {
    const doll = $('doll');
    doll.classList.remove('sway', 'burst', 'pin-hit');
    void doll.offsetWidth;
    doll.classList.add(className);
    setTimeout(() => doll.classList.remove(className), 1200);
  }
  function burst(x, y, count = 22) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (let i = 0; i < count; i++) {
      const particle = document.createElement('span');
      const angle = Math.random() * Math.PI * 2;
      const distance = 35 + Math.random() * 110;
      particle.className = 'particle';
      particle.style.cssText = `left:${x}px;top:${y}px;--x:${Math.cos(angle) * distance}px;--y:${Math.sin(angle) * distance - 25}px;animation-duration:${650 + Math.random() * 450}ms`;
      $('particles').append(particle);
      setTimeout(() => particle.remove(), 1150);
    }
  }
  function dollBurst() { const r = $('doll').getBoundingClientRect(); burst(r.x + r.width / 2, r.y + r.height / 2); }
  function record(text) {
    state.history.unshift({ text, date: new Date().toISOString() });
    state.history = state.history.slice(0, 30);
    $('activityLine').lastElementChild.textContent = text;
    save();
  }
  function modalHead(kicker, title) { return `<div class="modal-head"><div><p class="section-kicker">${kicker}</p><h3 id="modalTitle">${title}</h3></div><button class="close-modal" aria-label="关闭">×</button></div>`; }
  function openModal(html) {
    cleanupModal();
    cleanupModal = () => {};
    lastFocus = document.activeElement;
    $('modal').innerHTML = html;
    $('modalBackdrop').classList.remove('hidden');
    document.body.classList.add('modal-open');
    $('modal').querySelector('.close-modal')?.addEventListener('click', closeModal);
    requestAnimationFrame(() => $('modal').querySelector('button, input')?.focus());
  }
  function closeModal() {
    cleanupModal(); cleanupModal = () => {};
    $('modalBackdrop').classList.add('hidden');
    document.body.classList.remove('modal-open');
    lastFocus?.focus?.();
  }
  $('modalBackdrop').addEventListener('click', e => { if (e.target === $('modalBackdrop')) closeModal(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { if (isDisplay) exitDisplay(); else closeModal(); }
    if (e.key === 'Tab' && !$('modalBackdrop').classList.contains('hidden')) {
      const focusables = [...$('modal').querySelectorAll('button:not([disabled]), input:not([type=file]), textarea')];
      const first = focusables[0], last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { last?.focus(); e.preventDefault(); }
      else if (!e.shiftKey && document.activeElement === last) { first?.focus(); e.preventDefault(); }
    }
  });

  async function compressAvatar(file) {
    if (!file.type.startsWith('image/')) throw new Error('请选择一张图片');
    if (file.size > 20 * 1024 * 1024) throw new Error('图片请小于 20 MB');
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 384;
      const context = canvas.getContext('2d');
      const side = Math.min(image.naturalWidth, image.naturalHeight);
      context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 384, 384);
      return canvas.toDataURL('image/webp', .82);
    } catch (error) { throw new Error(error.message === '请选择一张图片' ? error.message : '这张图片暂时无法读取，请试试 JPG 或 PNG'); }
    finally { URL.revokeObjectURL(url); }
  }
  $('wardrobeButton').addEventListener('click', () => {
    let draft = { name: state.name, fabric: state.fabric, accessory: state.accessory, avatar: state.avatar };
    let active = true, uploadVersion = 0;
    openModal(`${modalHead('MAKE IT YOURS', '缝一个自己的替身。')}<form class="wardrobe-form" id="wardrobeForm"><label for="nameInput">它的名字 / 最多 12 字</label><input class="name-input" id="nameInput" maxlength="12" placeholder="给它取个小名" value="${escape(state.name)}" autocomplete="off" /><label>它的脸 / 照片只保存在这台设备</label><div class="avatar-row"><label class="avatar-upload" for="avatarUpload"><span id="uploadLabel">${state.avatar ? '↗ 更换头像' : '↗ 上传一张头像'}</span><input type="file" id="avatarUpload" accept="image/*" /></label><button type="button" class="initials-button" id="resetAvatar">用名字</button></div><p class="form-note" id="uploadNote">图片会居中裁成正方形。</p><label>布料颜色</label><div class="swatch-row">${fabrics.map(color => `<button type="button" class="swatch ${color === state.fabric ? 'selected' : ''}" data-color="${color}" style="background:${color}" aria-label="${({'#8e5a48':'陶土','#827754':'苔藓','#5d7270':'雾蓝','#735369':'莓紫','#b58b56':'麦金'})[color]}" aria-pressed="${color === state.fabric}"></button>`).join('')}</div><label>随身小物</label><div class="accessory-row">${[['ribbon','红线结'],['bell','护身铃'],['none','什么都不戴']].map(([key, label]) => `<button type="button" class="accessory-option ${key === state.accessory ? 'selected' : ''}" data-accessory="${key}" aria-pressed="${key === state.accessory}">${label}</button>`).join('')}</div><button type="submit" class="primary-button form-save" id="saveDoll">保存我的娃娃 <span>↗</span></button></form>`);
    cleanupModal = () => { active = false; };
    $('modal').querySelectorAll('.swatch').forEach(button => button.addEventListener('click', () => {
      draft.fabric = button.dataset.color;
      $('modal').querySelectorAll('.swatch').forEach(b => { b.classList.toggle('selected', b === button); b.setAttribute('aria-pressed', b === button); });
    }));
    $('modal').querySelectorAll('.accessory-option').forEach(button => button.addEventListener('click', () => {
      draft.accessory = button.dataset.accessory;
      $('modal').querySelectorAll('.accessory-option').forEach(b => { b.classList.toggle('selected', b === button); b.setAttribute('aria-pressed', b === button); });
    }));
    $('avatarUpload').addEventListener('change', async e => {
      const file = e.target.files[0]; if (!file) return;
      const version = ++uploadVersion;
      $('uploadLabel').textContent = '正在缝合头像…';
      $('saveDoll').disabled = true;
      try {
        const avatar = await compressAvatar(file);
        if (!active || version !== uploadVersion) return;
        draft.avatar = avatar;
        $('uploadLabel').textContent = '✓ 头像已就绪';
        $('uploadNote').textContent = '保存后就能看到它的新面孔。';
      } catch (error) { if (active && version === uploadVersion) { $('uploadLabel').textContent = '↗ 重新选择头像'; toast(error.message); } }
      finally { if (active && version === uploadVersion) $('saveDoll').disabled = false; }
    });
    $('resetAvatar').addEventListener('click', () => { uploadVersion++; draft.avatar = ''; $('avatarUpload').value = ''; $('uploadLabel').textContent = '↗ 上传一张头像'; $('uploadNote').textContent = '将使用名字的第一个字。'; $('saveDoll').disabled = false; });
    $('wardrobeForm').addEventListener('submit', e => { e.preventDefault(); draft.name = $('nameInput').value.trim(); Object.assign(state, draft); render(); const persisted = save(); closeModal(); animateDoll(); toast(persisted ? '缝好了。它现在更像你了。' : '本地空间不可用，设置只在当前页面生效。'); });
  });

  const moodLines = ['它正在等你给今晚定个基调。', '今天的不开心，先放在它这里。', '红线很牢，小小的愿望不会走丢。', '有些事，睡一觉再诅咒也来得及。', '它没有意见，它只想陪你一会儿。'];
  $('refreshMood').addEventListener('click', () => { $('activityLine').lastElementChild.textContent = moodLines[Math.floor(Math.random() * moodLines.length)]; animateDoll(); });
  function insertPin(part, event) {
    if (state.pins >= 3 && !part) {
      state.pinParts = []; state.pins = 0; state.mana = Math.min(100, state.mana + 6); render(); record('拔掉了所有针，也放下了三件小烦恼。'); toast('针都拔掉了，法力 +6'); animateDoll(); return;
    }
    part ||= ['额头','心口','手腕'].find(x => !state.pinParts.includes(x));
    if (state.pinParts.includes(part)) { state.pinParts = state.pinParts.filter(x => x !== part); state.pins = state.pinParts.length; render(); record(`拔掉${part}的小针，放下一件烦恼。`); animateDoll(); toast('小针拔掉了，松一口气。'); return; }
    state.pinParts.push(part); state.pins = state.pinParts.length; render(); record(`在${part}放下一件小烦恼。`); animateDoll('pin-hit'); vibrate([15, 40, 15]);
    if (event?.clientX) burst(event.clientX, event.clientY, 12); else dollBurst();
    toast(state.pins === 3 ? '三件烦恼收好了。再点一下，全部放下。' : `小针落在${part}，烦恼轻了一点。`);
  }
  document.querySelectorAll('.pin-pin').forEach(pin => {
    pin.setAttribute('role', 'button'); pin.tabIndex = 0; pin.setAttribute('aria-label', `在${pin.dataset.part}插针`);
    pin.addEventListener('click', e => { e.stopPropagation(); insertPin(pin.dataset.part, e); });
    pin.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); insertPin(pin.dataset.part); } });
  });
  function wish() {
    openModal(`${modalHead('A WHISPER IN THE DARK', '把心事缝进红线。')}<form id="wishForm"><label class="form-note" for="wishInput">写一个愿望，或一句小小的诅咒。</label><textarea id="wishInput" class="wish-input" maxlength="80" placeholder="希望明天醒来，有一件小事刚刚好。" rows="3" required></textarea><p class="form-note">只留在这台设备，最多 80 字。</p><button class="primary-button form-save" type="submit">轻轻说给它听 <span>∿</span></button></form>`);
    $('wishForm').addEventListener('submit', e => {
      e.preventDefault(); const text = $('wishInput').value.trim(); if (!text) { $('wishInput').focus(); return; }
      state.mana = Math.min(100, state.mana + 3); record(`悄悄话：${text}`); render(); closeModal(); animateDoll('burst'); dollBurst(); toast('它听见了。红线替你记着，法力 +3。');
    });
  }
  function shakeAway() { state.mana = Math.min(100, state.mana + 2); record('抖落了一点坏运气，今晚轻了一点。'); render(); animateDoll('sway'); dollBurst(); vibrate([15, 50, 15]); toast('坏运气掉了一地，法力 +2'); }
  let lastShake = 0;
  function motionListener(e) {
    const a = e.acceleration; if (!a) return;
    if (Math.hypot(a.x || 0, a.y || 0, a.z || 0) > 18 && Date.now() - lastShake > 3000) { lastShake = Date.now(); shakeAway(); }
  }
  let motionEnabled = false;
  async function shakeAction() {
    shakeAway();
    if (motionEnabled || !window.DeviceMotionEvent) return;
    try {
      if (typeof DeviceMotionEvent.requestPermission === 'function') {
        if (await DeviceMotionEvent.requestPermission() !== 'granted') return;
      }
      window.addEventListener('devicemotion', motionListener); motionEnabled = true;
    } catch { /* Touch action stays available if motion access is unavailable. */ }
  }
  document.querySelectorAll('[data-intent]').forEach(button => button.addEventListener('click', () => {
    if (button.dataset.intent === 'pin') insertPin();
    if (button.dataset.intent === 'whisper') wish();
    if (button.dataset.intent === 'shake') shakeAction();
  }));

  let drag = null;
  $('dollStage').addEventListener('pointerdown', e => {
    if (!e.target.closest('.doll') || e.target.closest('.pin-pin') || e.button > 0) return;
    drag = { x: e.clientX, y: e.clientY, moved: false, pointerId: e.pointerId };
    $('dollStage').setPointerCapture(e.pointerId);
  });
  $('dollStage').addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.moved ||= Math.abs(dx) + Math.abs(dy) > 8;
    $('doll').style.transform = `translate(${Math.max(-40, Math.min(40, dx * .4))}px, ${Math.max(-20, Math.min(20, dy * .2))}px) rotate(${Math.max(-19, Math.min(19, dx * .15))}deg)`;
  });
  function endDrag(e) {
    if (!drag) return;
    const wasMoved = drag.moved;
    $('doll').style.transform = ''; drag = null;
    if (e.type === 'pointercancel') return;
    animateDoll('sway');
    if (!wasMoved) { $('activityLine').lastElementChild.textContent = moodLines[Math.floor(Math.random() * moodLines.length)]; toast('嗯，我在。'); }
  }
  $('dollStage').addEventListener('pointerup', endDrag);
  $('dollStage').addEventListener('pointercancel', endDrag);
  $('dollStage').addEventListener('lostpointercapture', () => { drag = null; $('doll').style.transform = ''; });

  const spells = {
    '好运签': { glyph: '☽', result: '下一件小事，会刚刚好。', detail: '一枚看不见的幸运纽扣，已经别在你的衣角。' },
    '打个喷嚏': { mode: 'tap', glyph: '✳', result: '阿嚏！沉闷被打了个结。', detail: '纸上小诅咒完成。愿你的烦恼像喷嚏一样，一下就过去。' },
    '甜梦': { glyph: '☼', result: '今晚的梦，少一点噪声。', detail: '月光已缝好，枕头里藏着一片柔软的夜色。' },
    '社恐护盾': { mode: 'tap', glyph: '◇', result: '你的安静，也是一种魔法。', detail: '护盾已展开。允许自己暂停一下，按自己的节奏来。' },
    '脚底发痒': { mode: 'tap', glyph: '⌁', result: '一阵小风，偷偷溜进了袜子。', detail: '烦心事待不住了。跺跺脚，把它们留在原地。' },
    '鞋带打结': { glyph: '⋈', result: '烦心事被自己的鞋带绊住了。', detail: '红线替你打了个结。它追不上你，往前走吧。' }
  };
  function startSpell(name) {
    if (state.spellDay !== today()) { state.spellDay = today(); state.spellsToday = 0; }

    if (state.mana < 12) { toast('法力有点困了，抖掉坏运气或说个愿望来补充。'); return; }
    const spell = spells[name];
    openModal(`${modalHead('A LITTLE RITUAL', '今晚，施一点法。')}<div class="ritual-modal"><div class="ritual-glyph">${spell.glyph}</div><h3>${name}</h3><p>${spell.mode === 'tap' ? '敲响符文五次，让咒语一圈圈散开。' : '按住符文三秒，把一个念头慢慢交给它。'}<br />完成消耗 12 法力 · 仅供趣味解压</p><div class="ritual-meter"><span id="ritualProgress"></span></div><div class="ritual-instruction" id="ritualInstruction">${spell.mode === 'tap' ? '已敲响 0 / 5 次' : '松开可以暂停'}</div><button class="ritual-button" id="ritualButton" aria-label="${spell.mode === 'tap' ? '点击五次完成仪式' : '按住三秒完成仪式'}">${spell.mode === 'tap' ? '敲响符文' : '长按施法'}</button></div>`);
    let frame = 0, total = 0, start = 0, charging = false, done = false;
    const button = $('ritualButton');
    function stop() {
      if (!charging) return;
      total = Math.min(3000, total + performance.now() - start); charging = false;
      cancelAnimationFrame(frame); button.classList.remove('charging');
      if (!done) $('ritualInstruction').textContent = total > 0 ? '念头还在，继续按住就好' : '松开可以暂停';
    }
    function complete() {
      done = true; stop(); state.mana -= 12; state.spellsToday++;
      record(`施放「${name}」：${spell.result}`); render(); vibrate([30, 60, 30]);
      $('modal').innerHTML = `${modalHead('RITUAL COMPLETE', '咒语已经缝好了。')}<div class="ritual-modal"><div class="ritual-glyph">${spell.glyph}</div><div class="result-card"><strong>${spell.result}</strong><span>${spell.detail}</span></div><p style="margin-top:18px">法力 −12 · 今晚完成 ${state.spellsToday} 个仪式</p><button class="primary-button" id="finishRitual">收好这点魔法 <span>✦</span></button></div>`;
      $('modal').querySelector('.close-modal').addEventListener('click', closeModal);
      $('finishRitual').addEventListener('click', closeModal); $('finishRitual').focus();
      burst(innerWidth / 2, innerHeight * .55, 40); animateDoll('burst');
    }
    function tick() {
      if (!charging || done) return;
      const progress = Math.min(3000, total + performance.now() - start);
      $('ritualProgress').style.width = `${progress / 30}%`;
      $('ritualInstruction').textContent = `让念头停一会儿 · ${Math.max(1, Math.ceil((3000 - progress) / 1000))}`;
      if (progress >= 3000) { complete(); return; }
      frame = requestAnimationFrame(tick);
    }
    function begin(e) { if (spell.mode === 'tap') return; if (charging || done) return; e.preventDefault(); if (e.pointerId !== undefined) button.setPointerCapture(e.pointerId); charging = true; start = performance.now(); button.classList.add('charging'); vibrate(10); frame = requestAnimationFrame(tick); }
    let taps = 0;
    button.addEventListener('click', e => {
      if (spell.mode !== 'tap' || done) return;
      taps++; $('ritualProgress').style.width = `${taps * 20}%`; $('ritualInstruction').textContent = `已敲响 ${taps} / 5 次`; vibrate(15);
      const rect = button.getBoundingClientRect(); burst(rect.x + rect.width / 2, rect.y + rect.height / 2, 8);
      if (taps >= 5) complete();
    });
    button.addEventListener('pointerdown', begin);
    button.addEventListener('pointerup', stop);
    button.addEventListener('pointercancel', stop);
    button.addEventListener('lostpointercapture', stop);
    button.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') begin(e); });
    button.addEventListener('keyup', e => { if (e.key === ' ' || e.key === 'Enter') stop(); });
    button.addEventListener('blur', stop);
    const pauseOnHide = () => { if (document.hidden) stop(); };
    document.addEventListener('visibilitychange', pauseOnHide);
    cleanupModal = () => { stop(); cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', pauseOnHide); };
  }
  document.querySelectorAll('[data-spell]').forEach(button => button.addEventListener('click', () => startSpell(button.dataset.spell)));
  $('historyButton').addEventListener('click', () => {
    const rows = state.history.length ? `<ol class="history-list">${state.history.map(item => `<li><span>✶</span><div><p>${escape(item.text)}</p><time>${escape(new Date(item.date).toLocaleString('zh-CN', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }))}</time></div></li>`).join('')}</ol>` : '<div class="empty-state">这一页还是空白。<br />第一件小事，留给今晚的你。</div>';
    openModal(`${modalHead('THE NIGHTS WE KEEP', '一些小小的痕迹。')}${rows}<p class="form-note">仅保存最近 30 条，留在当前浏览器。</p>${state.history.length ? '<button class="text-button" id="clearHistory">让这些痕迹散去</button>' : ''}`);
    $('clearHistory')?.addEventListener('click', () => { state.history = []; save(); closeModal(); toast('记录已散去，今晚可以重新开始。'); });
  });
  document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('[data-tab]').forEach(b => { b.classList.toggle('active', b === button); b.setAttribute('aria-current', b === button ? 'page' : 'false'); });
    ['doll', 'spells', 'display'].forEach(tab => $(`${tab === 'doll' ? 'doll' : tab}Panel`).classList.toggle('hidden', tab !== button.dataset.tab));
    if (button.dataset.tab !== 'doll') { const panel = $(`${button.dataset.tab}Panel`); panel.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); }
  }));
  document.querySelectorAll('[data-scene]').forEach(button => button.addEventListener('click', () => { state.scene = button.dataset.scene; render(); save(); }));
  $('soundToggle').addEventListener('change', e => { state.sound = e.target.checked; save(); });
  $('candleToggle').addEventListener('change', e => { state.candle = e.target.checked; render(); save(); });
  $('breathToggle').addEventListener('change', e => { state.breath = e.target.checked; render(); save(); });
  const displayOverlay = document.createElement('div');
  displayOverlay.id = 'displayOverlay'; displayOverlay.className = 'display-overlay hidden';
  displayOverlay.innerHTML = '<div class="ornament-top"><span>STAY A LITTLE LONGER</span><button id="exitDisplay" aria-label="退出摆件模式">退出 ↙</button></div><div class="ornament-clock" id="ornamentClock"></div><div class="ornament-date" id="ornamentDate"></div><div class="ornament-vessel" id="ornamentVessel"></div><div class="ornament-candles"><div class="mini-candle"><span></span></div><div class="mini-candle"><span></span></div></div><div class="ornament-bottom"><span class="live-dot"></span> 它在这里，守着这一小块夜色。<small>愿今晚的你，睡得柔软。</small></div>';
  document.body.append(displayOverlay);
  let audioContext = null;
  async function startAmbient() {
    if (!state.sound || !isDisplay) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      audioContext = new AudioContext();
      const master = audioContext.createGain(); master.gain.value = 0.018; master.connect(audioContext.destination);
      [110, 164.81, 220.3].forEach((frequency, index) => {
        const oscillator = audioContext.createOscillator(); oscillator.type = 'sine'; oscillator.frequency.value = frequency;
        const gain = audioContext.createGain(); gain.gain.value = index ? .35 : .55;
        oscillator.connect(gain); gain.connect(master); oscillator.start();
      });
      await audioContext.resume();
    } catch { toast('当前浏览器暂时无法播放环境音'); }
  }
  function stopAmbient() { const context = audioContext; audioContext = null; if (context) context.close().catch(() => {}); }
  async function acquireWakeLock() { try { if ('wakeLock' in navigator && !wakeLock) { const lock = await navigator.wakeLock.request('screen'); if (!isDisplay || document.hidden) { await lock.release(); return; } if (wakeLock) { await lock.release(); return; } wakeLock = lock; lock.addEventListener('release', () => { if (wakeLock === lock) wakeLock = null; }); } } catch { /* Some browsers do not support keeping the screen awake. */ } }
  async function enterDisplay() {
    isDisplay = true; beforeDisplayScroll = scrollY;
    const clone = $('doll').cloneNode(true); clone.removeAttribute('id'); clone.style.transform = ''; clone.className = 'doll'; clone.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
    $('ornamentVessel').replaceChildren(clone);
    displayOverlay.classList.remove('hidden'); document.body.classList.add('ornament-active');
    $('exitDisplay').focus(); updateClock(); startAmbient();
    try { if (!document.fullscreenElement && displayOverlay.requestFullscreen) await displayOverlay.requestFullscreen(); } catch { /* The overlay also works without fullscreen support. */ }
    if (isDisplay) acquireWakeLock();
  }
  async function exitDisplay() {
    isDisplay = false; stopAmbient(); displayOverlay.classList.add('hidden'); document.body.classList.remove('ornament-active');
    if (wakeLock) { try { await wakeLock.release(); } catch {} wakeLock = null; }
    if (document.fullscreenElement) { try { await document.exitFullscreen(); } catch {} }
    window.scrollTo(0, beforeDisplayScroll); $('enterDisplay').focus({ preventScroll: true });
  }
  $('enterDisplay').addEventListener('click', enterDisplay);
  $('exitDisplay').addEventListener('click', exitDisplay);
  document.addEventListener('visibilitychange', () => { if (document.hidden) { wakeLock = null; audioContext?.suspend(); } else if (isDisplay) { acquireWakeLock(); audioContext?.resume(); } });
  function updateClock() {
    if (state.lastVisit !== today()) { state.lastVisit = today(); state.visits = Math.max(1, Number(state.visits) || 1) + 1; state.mana = Math.min(100, state.mana + 25); state.spellDay = today(); state.spellsToday = 0; render(); save(); }
    const now = new Date(), time = now.toLocaleTimeString('zh-CN', { hour:'2-digit', minute:'2-digit', hour12:false });
    $('ritualTime').textContent = `${now.getHours() >= 18 || now.getHours() < 6 ? '今晚' : '此刻'} · ${time}`;
    $('displayTime').textContent = time;
    $('ornamentClock').textContent = time;
    $('ornamentDate').textContent = now.toLocaleDateString('zh-CN', { month:'long', day:'numeric', weekday:'long' });
  }
  render(); save(); updateClock(); setInterval(updateClock, 1000);
  if (state.history.length) $('activityLine').lastElementChild.textContent = state.history[0].text;
})();
