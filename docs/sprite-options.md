# Character Sprite Replacement Options

## Current State

The project uses 16×16 pixel office worker sprites that you find unattractive. Here's what we need to replace them with.

**Technical requirements:**
- 16×16 pixels per frame (or easily rescalable)
- Top-down perspective
- Walk animations (up, down, left, right - 4 frames each)
- Idle states
- 4-5 distinct characters that are visually distinguishable
- Total file size: under 10KB for all characters (current is ~7KB)

**Integration requirements:**
- PNG sprite sheets with JSON atlas files
- PixiJS-compatible texture format
- Color variants or distinct designs for YOU, A, B, C characters
- Optional: variants for character Z (passerby)

## Problem: Most Search Results Failed

WebFetch couldn't access most itch.io URLs and some OpenGameArt pages. This means I couldn't verify:
- Exact sprite dimensions
- Animation frame counts
- Actual visual quality
- Download availability

## What I Found

### CC0 (Public Domain) Options

1. **Raroki Characters Pack** - https://raroki.itch.io/characters
   - License: CC0 confirmed
   - Details: Unknown (WebFetch failed)
   - Action needed: Manual check

2. **Chrome District (Cyberpunk)** - https://booliebuilds.itch.io/chrome-district
   - License: CC0 confirmed
   - 20 characters, 8-direction walk cycles
   - Details: Unknown size (WebFetch failed)
   - Style: Modern/cyberpunk (might fit office theme)
   - Action needed: Manual check

### Free with Attribution

3. **LPC Character Bases** - https://opengameart.org/content/lpc-character-bases
   - License: CC-BY-SA 3.0 / GPL 3.0
   - Size: 64×64 per frame (too large, would need 4× downscaling)
   - Animations: Complete (walk, run, cast, slash, etc.)
   - Quality: Professional, widely used
   - **Problem:** File sizes are huge (832×1344px sheets), need significant rework

4. **16×16 RPG Character Sheet** - https://route1rodent.itch.io/16x16-rpg-character-sprite-sheet
   - License: Unknown
   - Size: Perfect 16×16
   - Status: SSL cert error, couldn't access

## Recommended Action Plan

Since WebFetch failed on most sources, here's what to do:

### Option A: Manual Browse & Download (Recommended)
1. Visit https://raroki.itch.io/characters directly
2. Check if sprites are 16×16 or close
3. Download and test integration
4. If good, replace current sprites

### Option B: Check Kenney.nl
Kenney.nl is a major free game asset source with CC0 licensing. Search for:
- "Tiny" character packs
- "Micro" RPG sets
- Top-down character collections

### Option C: Commission Custom Sprites
If free options don't meet quality standards:
- Commission a pixel artist for 5 characters
- Specify 16×16, top-down, office theme
- Budget: ~$50-200 depending on complexity
- Platforms: Fiverr, itch.io creators, r/PixelArt

### Option D: Modify LPC Sprites
- Download LPC character bases
- Use sprite editing tool to downscale 64×64 → 16×16
- Extract only needed animations
- Requires: Image editing skills, attribution in credits

## Next Steps

1. **Visit the CC0 sources manually** - WebFetch can't help, you need to check them yourself
2. **Download 1-2 promising packs** to test
3. **I can help integrate** once you have the sprite sheets
4. **Update CREDITS.md** if attribution is required

## Integration Help Available

Once you have sprite files, I can:
- Create JSON atlas files matching the current format
- Update [hex/stage.js](hex/stage.js) sprite definitions
- Test rendering with PixiJS
- Adjust scaling if sprites aren't exactly 16×16
- Generate color variants if needed

Let me know which option you'd like to pursue.
