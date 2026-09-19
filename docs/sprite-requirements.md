# Character Sprite Requirements

## Current Setup

**Sprite dimensions:** 16×16 pixels per frame
**Sheet layout:** 64×160px (4 columns × 10 rows)
**Scale:** 2× (rendered at 32×32 on screen)

**Required animations:**
- `walk_down` (4 frames)
- `walk_up` (4 frames)
- `idle_down` (1-2 frames)
- `idle_up` (1 frame)
- `talk` (2 frames)

**Characters needed:**
- YOU, A, B, C: main characters (4 color variants of office worker)
- Z: passerby with 3 variants (default, hat, mask)

**Current files:**
- `WorkerSheetYellowPurple.png`, `WorkerSheetBrownWhite.png`, etc. (1.3-1.4 KB each)
- `passerby_*.png` (2.3-2.5 KB each)
- JSON atlas files define frame coordinates

**Integration:** Uses PixiJS with texture atlases. See [hex/stage.js:20-26](hex/stage.js:20-26) for sprite definitions.

## Replacement Options

### Option 1: LPC Character Bases
**Source:** https://opengameart.org/content/lpc-character-bases

**Pros:**
- Extensive animation library (walk, run, cast, slash, shoot, hurt, sit, jump)
- 6 body types with modular heads
- Large community with clothing/accessories
- Well-documented universal spritesheet format

**Cons:**
- 64×64 per frame (4× larger than current)
- Requires attribution (CC-BY-SA 3.0 / GPL 3.0)
- 832×1344px sheets (much larger files)
- Would need significant integration work to resize/crop

**Verdict:** Too large for this project's 16×16 aesthetic.

---

### Option 2: 16×16 RPG Character Sprite Sheet
**Source:** https://route1rodent.itch.io/16x16-rpg-character-sprite-sheet

**Pros:**
- Exact 16×16 size match
- Multiple characters in different styles
- Includes walk cycles and idle

**Cons:**
- License unclear (need to verify on page)
- Unknown animation count
- May not have top-down perspective

**Status:** Need to check page details.

---

### Option 3: Raroki Free Characters Pack
**Source:** https://raroki.itch.io/characters

**License:** CC0 (public domain)

**Pros:**
- Free for any use, no attribution required
- Multiple character designs

**Cons:**
- Sprite dimensions unknown
- Animation completeness unclear

**Status:** Need to verify specifications.

---

### Option 4: Chrome District (Cyberpunk)
**Source:** https://booliebuilds.itch.io/chrome-district

**License:** CC0

**Pros:**
- 20 characters with 8-direction walk cycles
- 5 camera angles
- Modern/cyberpunk aesthetic fits office setting
- Public domain

**Cons:**
- Sprite size unknown (likely larger than 16×16)
- May need downscaling

**Status:** WebFetch failed, need manual check.

---

## Recommendations

1. **Check Raroki CC0 pack first** - if sprites are 16×16 or close, this is the safest choice (no attribution, clear license)
2. **Explore 16×16 RPG pack** - size is perfect but verify license
3. **Consider custom pixel art** - commission or create 16×16 characters specifically for this project
4. **Downscale larger sprites** - if necessary, but quality loss may occur

## Integration Checklist

When replacing sprites:
- [ ] Verify sprite dimensions (must be 16×16 or easily rescalable)
- [ ] Check required animations exist (walk_down, walk_up, idle, talk minimum)
- [ ] Confirm license allows commercial use if needed
- [ ] Create JSON atlas files matching current format
- [ ] Update `SPRITE_DEFS` in [hex/stage.js](hex/stage.js)
- [ ] Test all 5 characters render correctly
- [ ] Verify character colors/styles are distinguishable
- [ ] Update [CREDITS.md](CREDITS.md) with attribution if required
