import type { DialogueLine, PlayEvent, PlayProfile, PlaySnapshot } from './play-api';
import { performanceFromEvents, projectPerformance, type PerformanceExpression } from './play-performance';

export type PortraitArt = Partial<Record<PerformanceExpression, string>> & { neutral: string };
export type GalgameArt = { portraits: Record<string, PortraitArt>; backgrounds: Record<string, string> };

/** Presentation only: every movement/effect follows an already committed event. */
export function createGalgameStage(art: GalgameArt) {
  const element = document.createElement('div'); element.className = 'vn-stage';
  element.innerHTML = '<div class="vn-backgrounds" aria-hidden="true"></div><div class="vn-light" aria-hidden="true"></div><div class="vn-cast"></div><div class="vn-action" hidden aria-hidden="true"><span class="vn-action-symbol"></span><span class="vn-action-label"></span></div><div class="vn-doll" aria-hidden="true"><span>✶</span></div>';
  const backgrounds = element.querySelector<HTMLElement>('.vn-backgrounds')!;
  const cast = element.querySelector<HTMLElement>('.vn-cast')!;
  const action = element.querySelector<HTMLElement>('.vn-action')!;
  const figures = new Map<string, HTMLElement>();
  const seenEvents = new Set<string>();
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let room = '', world = '', background = '';
  let cueTimer: ReturnType<typeof setTimeout> | undefined;

  const animate = (node: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions): void => {
    if (!reduceMotion.matches) node.animate(frames, options);
  };
  function update(snapshot: PlaySnapshot, profile: PlayProfile, line?: DialogueLine, choosing = false): void {
    const projection = projectPerformance(snapshot, choosing ? undefined : line);
    element.dataset.mode = projection.mode;
    element.dataset.speaker = projection.speakerId || '';
    element.dataset.period = snapshot.clock && (snapshot.clock.minute >= 1080 || snapshot.clock.minute < 360) ? 'night' : 'day';
    const nextWorld = snapshot.worldId || 'local';
    const changedWorld = world !== nextWorld;
    if (changedWorld) {
      world = nextWorld; seenEvents.clear();
      if (cueTimer) clearTimeout(cueTimer);
      action.hidden = true;
    }
    if (room !== snapshot.roomId || changedWorld) {
      room = snapshot.roomId;
      element.dataset.room = room;
      const next = art.backgrounds[room] || '';
      if (next !== background) {
        background = next;
        backgrounds.replaceChildren();
        if (next) {
          const image = document.createElement('img'); image.alt = ''; image.src = next;
          image.className = 'vn-background'; image.draggable = false;
          image.onerror = () => { image.hidden = true; element.dataset.backgroundFallback = 'true'; };
          image.onload = () => { delete element.dataset.backgroundFallback; };
          backgrounds.append(image);
          animate(image, [{ opacity: 0, transform: 'scale(1.025)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 650, easing: 'ease-out' });
        }
      }
    }
    // Three portrait positions keep faces readable. Include the current public
    // speaker when a custom world has more people than the frame can show.
    const visible = projection.castIds.slice(0, 3);
    if (projection.speakerId && projection.castIds.includes(projection.speakerId) && !visible.includes(projection.speakerId)) visible[2] = projection.speakerId;
    for (const [id, node] of figures) if (!visible.includes(id)) {
      node.dataset.leaving = 'true'; node.setAttribute('aria-hidden', 'true');
      node.querySelector('img')?.setAttribute('alt', '');
      figures.delete(id);
      if (reduceMotion.matches) node.remove();
      else node.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateX(calc(-50% + 20px))' }], { duration: 180, fill: 'forwards' }).finished.then(() => node.remove()).catch(() => node.remove());
    }
    visible.forEach((id, index) => {
      const name = profile.names?.[id] || id;
      let figure = figures.get(id);
      if (!figure) {
        figure = document.createElement('figure'); figure.className = 'vn-character'; figure.dataset.castId = id;
        const image = document.createElement('img'); image.className = 'vn-portrait'; image.draggable = false;
        const fallback = document.createElement('span'); fallback.className = 'vn-portrait-fallback';
        figure.append(image, fallback); cast.append(figure); figures.set(id, figure);
        image.onerror = () => { image.hidden = true; fallback.hidden = false; };
        image.onload = () => { image.hidden = false; fallback.hidden = true; };
        animate(figure, [{ opacity: 0, transform: 'translateX(-50%) translateY(12px)' }, { opacity: 1, transform: 'translateX(-50%) translateY(0)' }], { duration: 360, easing: 'ease-out' });
      }
      const active = projection.speakerId === id;
      figure.style.setProperty('--cast-x', `${(index + 1) * 100 / (visible.length + 1)}%`);
      figure.dataset.active = String(active);
      figure.dataset.expression = active ? projection.expression : 'neutral';
      const image = figure.querySelector<HTMLImageElement>('img')!;
      const fallback = figure.querySelector<HTMLElement>('.vn-portrait-fallback')!;
      image.alt = `${name}的立绘`; fallback.textContent = `${name} · 立绘暂不可用`;
      const portrait = art.portraits[id];
      const source = portrait?.[active ? projection.expression : 'neutral'] || portrait?.neutral;
      if (source) {
        if (image.dataset.asset !== source) { image.dataset.asset = source; image.src = source; }
      } else { image.hidden = true; fallback.hidden = false; }
    });
    const doll = element.querySelector<HTMLElement>('.vn-doll')!;
    doll.dataset.active = String(projection.speakerId === 'PLAYER_DOLL');
    doll.title = profile.dollName || '巫毒娃娃';
  }
  function perform(events: readonly PlayEvent[]): void {
    const cue = performanceFromEvents(events);
    if (!cue || seenEvents.has(cue.eventId)) return;
    seenEvents.add(cue.eventId);
    if (seenEvents.size > 100) seenEvents.delete(seenEvents.values().next().value!);
    if (cueTimer) clearTimeout(cueTimer);
    action.getAnimations().forEach(animation => animation.cancel());
    action.dataset.kind = cue.kind;
    element.dataset.action = cue.kind;
    element.dataset.actionEvent = cue.eventId;
    action.querySelector('.vn-action-label')!.textContent = cue.label;
    action.querySelector('.vn-action-symbol')!.textContent = { move: '→', open: '◫', close: '▣', inspect: '⌕', work: '▤', wait: '◷', speak: '…' }[cue.kind];
    action.hidden = false;
    animate(action, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 240, easing: 'ease-out' });
    if (cue.kind === 'open' || cue.kind === 'close') animate(backgrounds, [{ filter: 'brightness(.65)' }, { filter: 'brightness(1)' }], { duration: 600 });
    if (cue.kind === 'inspect') animate(backgrounds, [{ transform: 'scale(1)' }, { transform: 'scale(1.035)' }, { transform: 'scale(1)' }], { duration: 1100, easing: 'ease-in-out' });
    cueTimer = setTimeout(() => { action.hidden = true; delete element.dataset.action; }, reduceMotion.matches ? 1500 : 2200);
  }
  function settle(): void {
    element.getAnimations({ subtree: true }).forEach(animation => animation.cancel());
    if (cueTimer) clearTimeout(cueTimer);
    action.hidden = true; delete element.dataset.action;
    element.querySelectorAll('[data-leaving="true"]').forEach(node => node.remove());
  }
  return { element, update, perform, settle };
}

export type GalgameStage = ReturnType<typeof createGalgameStage>;
