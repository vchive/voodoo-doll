import type { PlayProfile, PlaySnapshot } from './play-api';
import type { Application, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { OVERVIEW_VIEW, projectOverview, type OverviewProjection, type OverviewProp } from './play-overview-model';
export type { OverviewProjection } from './play-overview-model';

// Match the standing portraits' main identity colours using the existing
// original pixel drawing shapes. These are recognisable overview hints,
// not a pixel tracing or a claim of exact costume/hairstyle correspondence.
const PORTRAIT_PIXEL_HINTS: Record<string, Record<string, string>> = {
  A: { hair: '#967451', hairLight: '#bd9a71', coat: '#697b55', coatLight: '#95a679', coatShade: '#495d42', pants: '#c7b49a', shoe: '#695348', style: 'cardigan', cut: 'part', accent: '#9bac7d' },
  B: { hair: '#705045', hairLight: '#9a7060', coat: '#8f759b', coatLight: '#b69bbf', coatShade: '#67556f', style: 'cardigan', cut: 'bob', accent: '#baa0c7' },
  C: { hair: '#292a2c', hairLight: '#48494b', coat: '#37393d', coatLight: '#5b5d62', coatShade: '#25272c', pants: '#565763', shoe: '#36373c', style: 'jacket', cut: 'messy', accent: '#85878e' },
};

export type PlayOverview = {
  view: typeof OVERVIEW_VIEW;
  ready: Promise<boolean>;
  update(snapshot: PlaySnapshot, profile: PlayProfile): OverviewProjection;
  getProjection(): OverviewProjection | null;
  /** Control animation only. Inactive overviews still receive static updates. */
  setActive(active: boolean): void;
  settle(): void;
  destroy(): void;
};

/** Non-blocking, optional pixel overview. It shares the legacy original
 * character renderer, not its mutable model, grid or independent doll actor.
 * Everything here is a public snapshot projection; no action API is held. */
export function createPlayOverview(host: HTMLElement): PlayOverview {
  let destroyed = false;
  let unavailable = false;
  let active = false;
  let projection: OverviewProjection | null = null;
  let pixi: typeof import('pixi.js') | null = null;
  let app: Application | null = null;
  let scenery: Container | null = null;
  let cast: Container | null = null;
  let light: Graphics | null = null;
  let lastScene = '';
  let lastCast = '';
  let lastFrame = -1;
  let makeFrames: ((id: string, designOverride?: Record<string, string>) => Record<string, Texture>) | null = null;
  const frameCache = new Map<string, Record<string, Texture>>();
  const sprites = new Map<string, Sprite>();
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  host.dataset.status = 'loading';
  host.dataset.layout = 'schematic';

  const rect = (g: Graphics, x: number, y: number, w: number, h: number, color: number, alpha = 1) => {
    if (w > 0 && h > 0) g.rect(x, y, w, h).fill({ color, alpha });
  };

  function furniture(g: Graphics, p: OverviewProp) {
    const x = p.x * 16, y = p.y * 16, w = p.w * 16, h = p.h * 16;
    const r = (dx: number, dy: number, rw: number, rh: number, c: number, a = 1) => rect(g, x + dx, y + dy, rw, rh, c, a);
    const box = (color = 0xa18b71) => { r(3, 5, w, h, 0x252734, .25); r(0, 0, w, h, 0x494349); r(1, 1, w - 2, h - 5, color); r(2, 2, w - 4, 2, 0xd0b18a, .6); r(2, h - 4, w - 4, 3, 0x705646); };
    switch (p.kind) {
      case 'rug': r(0, 0, w, h, 0x8d8580, .8); r(3, 3, w - 6, h - 6, 0x6c7371); g.rect(x + 6, y + 6, w - 12, h - 12).stroke({ width: 1, color: 0xb8b09d, alpha: .5 }); break;
      case 'window': r(-2, -2, w + 4, h + 4, 0x293849); r(0, 0, w, h, 0xa8b4b5); r(3, 3, w - 6, h - 6, 0x5c798b); r(w / 2 - 1, 2, 2, h - 4, 0xdbd9c6); r(2, h / 2, w - 4, 2, 0xdbd9c6); r(-2, h, w + 4, 3, 0xc2b59d); break;
      case 'bed': box(); r(4, 4, w - 8, h - 8, 0xd7cebb); r(5, 18, w - 10, h - 22, 0x8ba3a0); r(8, 7, 20, 9, 0xf0e4cd); r(35, 7, 20, 9, 0xf0e4cd); r(6, 19, w - 12, 2, 0xb7c7bb); break;
      case 'desk': box(); r(12, 4, 30, 21, 0x343c49); r(14, 6, 26, 16, 0x627f8b); r(16, 8, 12, 2, 0xb0c1ba); r(25, 25, 4, 4, 0x535968); r(16, 30, 25, 7, 0xd0cabb); r(w - 16, 6, 9, 12, 0xeee2c5); break;
      case 'counter': box(0xb5b8aa); r(6, 5, Math.min(w - 12, 25), h - 12, 0x4c6169); r(9, 8, Math.min(w - 18, 19), h - 18, 0x859b9c); if (w > 70) { r(w - 37, 5, 30, h - 12, 0x40444c); r(w - 32, 9, 9, 8, 0x737b80); r(w - 19, 9, 9, 8, 0x737b80); } break;
      case 'table': box(); r(w / 2 - 9, 4, 17, Math.max(6, h - 10), 0xcebfa4); r(8, 6, 9, 7, 0xe2e0ca); r(w - 17, 6, 9, 7, 0xe2e0ca); break;
      case 'door': box(0x817566); r(5, 5, w - 10, h - 10, 0x6b6059); r(w - 8, h / 2, 3, 3, 0xe8c88e); break;
      case 'sofa': box(0x688a84); r(3, 3, w - 6, 12, 0x8fa8a0); r(3, 5, 9, h - 10, 0x56726f); r(w - 12, 5, 9, h - 10, 0x56726f); for (let dx = 15; dx < w - 15; dx += 24) r(dx, 18, 21, h - 24, 0x839e95); break;
      case 'bench': box(0x938274); for (let dy = 5; dy < h - 4; dy += 6) r(3, dy, w - 6, 1, 0x635449); r(3, 1, 3, h, 0x454b51); r(w - 6, 1, 3, h, 0x454b51); break;
      case 'shelves': box(0x625a57); for (let dy = 5; dy < h - 5; dy += 16) { r(3, dy + 11, w - 6, 2, 0xb29677); for (let dx = 5; dx < w - 7; dx += 9) r(dx, dy, 5, 10, dx % 3 ? 0x829b91 : 0xc3a282); } break;
      case 'boxes': box(0x8e7a61); for (let dx = 3; dx < w - 10; dx += 23) { r(dx, 3, 20, h - 10, 0xb49a70); r(dx + 9, 4, 3, h - 12, 0xd3c199); } break;
      case 'tree': r(w / 2 - 3, h / 2, 6, h / 2, 0x82735c); r(5, 5, w - 10, h - 14, 0x3b614c); r(1, 13, w - 2, h - 25, 0x567856); r(10, 2, w - 18, 12, 0x819666); break;
      case 'pond': r(0, 0, w, h, 0x888c77); r(3, 3, w - 6, h - 6, 0x4f7c87); for (let dx = 9; dx < w - 14; dx += 20) r(dx, 15 + dx % 17, 14, 1, 0x9abfc0); break;
      case 'tracks': r(0, 0, w, h, 0x3b474f); for (let dx = 4; dx < w - 5; dx += 12) r(dx, 4, 5, h - 8, 0x6b625c); r(0, 10, w, 3, 0xa5adb0); r(0, h - 13, w, 3, 0xa5adb0); r(0, h + 8, w, 4, 0xe1c880); for (let dx = 2; dx < w - 4; dx += 9) r(dx, h + 8, 3, 4, 0x867b54); break;
      case 'sign': r(0, 0, w, h, 0x344853); r(3, 3, w - 6, h - 6, 0x6d958e); r(7, 6, w - 14, 2, 0xd5e2cd); break;
      case 'building': r(0, 0, w, h, 0x444958); r(0, h - 4, w, 4, 0x99958f); for (let dx = 16; dx < w - 18; dx += 38) { r(dx, 4, 22, 19, 0x293849); r(dx + 2, 6, 18, 14, 0xaa9d80); } break;
      default: box(); r(5, h / 2, w - 10, 1, 0x615249); r(w / 2 - 2, h / 2 - 4, 4, 2, 0xd3bc8b);
    }
  }

  function drawScene(next: OverviewProjection) {
    if (!pixi || !scenery) return;
    scenery.removeChildren().forEach((child) => child.destroy({ children: true }));
    const g = new pixi.Graphics();
    const { floor, alternate, wall, trim } = next.palette;
    for (let y = 0; y < 16; y += 1) for (let x = 0; x < 18; x += 1) {
      rect(g, x * 16, y * 16, 16, 16, (x * 7 + y * 3) % 5 < 2 ? alternate : floor);
      rect(g, x * 16, y * 16 + 15, 16, 1, wall, .2);
    }
    rect(g, 0, 0, 288, 8, wall); rect(g, 0, 8, 288, 3, trim);
    rect(g, 0, 0, 4, 256, wall); rect(g, 284, 0, 4, 256, wall); rect(g, 0, 252, 288, 4, wall);
    // A threshold signals the scene exit; it does not claim a world-space door.
    rect(g, 116, 247, 56, 5, trim);
    next.props.filter((p) => p.kind === 'rug').forEach((p) => furniture(g, p));
    next.props.filter((p) => p.kind !== 'rug').forEach((p) => furniture(g, p));
    scenery.addChild(g);
  }

  function frames(id: string): Record<string, Texture> | null {
    if (!makeFrames) return null;
    if (!frameCache.has(id)) frameCache.set(id, makeFrames(id, PORTRAIT_PIXEL_HINTS[id]));
    return frameCache.get(id) || null;
  }

  function drawCast(next: OverviewProjection) {
    if (!pixi || !cast) return;
    cast.removeChildren().forEach((child) => child.destroy({ children: true }));
    sprites.clear();
    for (const actor of [...next.actors].sort((a, b) => a.gy - b.gy)) {
      const x = actor.gx * 16 + 8, y = actor.gy * 16 + 16;
      const shadow = new pixi.Graphics().ellipse(x, y - 1, 10, 3).fill({ color: 0x242a34, alpha: .3 });
      cast.addChild(shadow);
      const textures = actor.visual === 'pixel' ? frames(actor.actorId) : null;
      if (textures) {
        const sprite = new pixi.Sprite(textures.idle_down);
        sprite.anchor.set(.5, 1); sprite.position.set(x, y);
        sprites.set(actor.actorId, sprite);
        cast.addChild(sprite);
      } else {
        // Unillustrated custom NPCs receive a neutral token, never A's face.
        const marker = new pixi.Graphics().circle(x, y - 24, 8).fill(0xa9b1bb).roundRect(x - 9, y - 14, 18, 13, 3).fill(0x67778b);
        cast.addChild(marker);
      }
      if (actor.actorId === 'YOU') {
        // The doll travels attached to YOU, not as another controllable agent.
        const doll = new pixi.Graphics();
        rect(doll, x + 8, y - 17, 7, 6, 0xd5b394); rect(doll, x + 9, y - 11, 5, 6, 0xa9907a);
        rect(doll, x + 9, y - 15, 1, 1, 0x3e3541); rect(doll, x + 12, y - 15, 1, 1, 0x3e3541);
        rect(doll, x + 10, y - 8, 2, 2, 0xc67f78); cast.addChild(doll);
      }
    }
    lastFrame = -1;
  }

  function updateFrame(animated = false) {
    if (!app || destroyed) return;
    const phase = animated ? Math.floor(performance.now() / 900) % 6 : 0;
    if (phase !== lastFrame) {
      for (const [id, sprite] of sprites) {
        const f = frameCache.get(id);
        if (f) sprite.texture = f[phase === 5 ? 'blink_down' : phase === 2 ? 'breathe_down' : 'idle_down'];
      }
      lastFrame = phase;
    }
  }

  function render() {
    if (!app || !projection || destroyed || unavailable) return;
    const sceneKey = `${projection.worldKey}:${projection.roomId}`;
    if (sceneKey !== lastScene) { drawScene(projection); lastScene = sceneKey; lastCast = ''; }
    const castKey = JSON.stringify(projection.actors);
    if (castKey !== lastCast) { drawCast(projection); lastCast = castKey; }
    light?.clear();
    if (light && projection.light !== 'on') rect(light, 0, 0, 288, 256, 0x101526, projection.light === 'off' ? .58 : .25);
    updateFrame(false);
    app.render();
  }

  function syncAnimation() {
    if (!app || destroyed || unavailable) return;
    const moving = active && !media.matches && !document.hidden;
    host.dataset.animating = String(moving);
    if (moving) app.start();
    else { app.stop(); updateFrame(false); app.render(); }
  }

  function dispose() {
    // Sever every live renderer reference BEFORE cleanup. A partially
    // initialized/destroyed Pixi instance may throw during stop/destroy; a
    // later snapshot must never call clear() on its disposed Graphics.
    const previousApp = app;
    const textures = new Set([...frameCache.values()].flatMap((cached) => Object.values(cached)));
    app = null;
    scenery = null; cast = null; light = null;
    lastScene = ''; lastCast = ''; lastFrame = -1;
    frameCache.clear(); sprites.clear();
    try {
      if (previousApp) {
        let canvas: HTMLCanvasElement | undefined;
        try { canvas = previousApp.canvas; } catch { /* init may not have a renderer */ }
        try { previousApp.stop(); } catch { /* ticker may have failed initialization */ }
        try { previousApp.destroy(true, { children: true, texture: false, textureSource: false }); }
        catch { /* preserve the dialogue workflow even if renderer cleanup fails */ }
        finally { canvas?.remove(); }
      }
    } finally {
      // Destroy each owned texture independently: one failed source must not
      // prevent the remaining generated canvases from being released.
      for (const texture of textures) {
        try { texture.destroy(true); } catch { /* already released by partial cleanup */ }
      }
    }
  }

  function fail() {
    unavailable = true;
    host.dataset.status = 'unavailable';
    host.dataset.animating = 'false';
    try { dispose(); } catch { /* partial renderer initialization */ }
  }

  function safeRender() {
    try { render(); } catch { fail(); }
  }

  function safeAnimation() {
    try { syncAnimation(); } catch { fail(); }
  }

  document.addEventListener('visibilitychange', safeAnimation);
  media.addEventListener('change', safeAnimation);
  const ready = (async (): Promise<boolean> => {
    let initializing: Application | null = null;
    try {
      const [renderer, characters] = await Promise.all([
        import('pixi.js'),
        // @ts-expect-error The original, source-generated sprite library is JS.
        import('./characters.js'),
      ]);
      if (destroyed) return false;
      pixi = renderer;
      makeFrames = characters.createCharacterFrames;
      const pendingApp = new pixi.Application();
      initializing = pendingApp;
      await pendingApp.init({ width: OVERVIEW_VIEW.width, height: OVERVIEW_VIEW.height, backgroundAlpha: 0, antialias: false,
        resolution: Math.min(2, window.devicePixelRatio || 1), autoDensity: true, autoStart: false });
      if (destroyed) { pendingApp.destroy(true, { children: true }); return false; }
      app = pendingApp;
      initializing = null;
      scenery = new pixi.Container(); cast = new pixi.Container(); light = new pixi.Graphics();
      app.stage.eventMode = 'none';
      app.stage.addChild(scenery, cast, light);
      app.ticker.maxFPS = 12;
      app.ticker.add(() => updateFrame(true));
      app.canvas.setAttribute('aria-hidden', 'true');
      app.canvas.style.cssText = 'display:block;width:100%;height:100%;image-rendering:pixelated;';
      host.appendChild(app.canvas);
      host.dataset.status = 'ready';
      render(); syncAnimation();
      return true;
    } catch {
      if (initializing) {
        try { initializing.destroy(true, { children: true }); } catch { /* failed init may lack a renderer */ }
      }
      if (!destroyed) {
        // The caller retains scene labels and accessible action buttons. A
        // graphics failure must not disable the dialogue or action workflow.
        fail();
      }
      return false;
    }
  })();

  return {
    view: OVERVIEW_VIEW,
    ready,
    update(snapshot, profile) {
      const next = projectOverview(snapshot, profile);
      if (!destroyed) { projection = next; host.dataset.room = next.roomId; safeRender(); }
      return next;
    },
    getProjection: () => projection,
    setActive(next) { active = next; safeAnimation(); },
    settle() { active = false; safeAnimation(); },
    destroy() {
      if (destroyed) return;
      destroyed = true; active = false;
      document.removeEventListener('visibilitychange', safeAnimation);
      media.removeEventListener('change', safeAnimation);
      try { dispose(); } catch { /* an unavailable renderer is already detached */ }
      projection = null;
      host.dataset.status = 'destroyed'; host.dataset.animating = 'false';
    },
  };
}
