import type { GalgameArt } from './play-stage';

// Explicit imports keep the licensed production artwork separate from old
// paid/test-only assets in public/. All URLs become same-origin build assets.
const home = new URL('./assets/vn/backgrounds/home.webp', import.meta.url).href;
const office = new URL('./assets/vn/backgrounds/office.webp', import.meta.url).href;
const kitchen = new URL('./assets/vn/backgrounds/kitchen.webp', import.meta.url).href;
const hall = new URL('./assets/vn/backgrounds/hall.webp', import.meta.url).href;
const parlor = new URL('./assets/vn/backgrounds/parlor.webp', import.meta.url).href;
const station = new URL('./assets/vn-scenes/station.webp', import.meta.url).href;
export const GALGAME_ART: GalgameArt = {
  portraits: {
    A: {
      neutral: new URL('./assets/vn/characters/linchuan/neutral.webp', import.meta.url).href,
      smile: new URL('./assets/vn/characters/linchuan/happy.webp', import.meta.url).href,
      concerned: new URL('./assets/vn/characters/linchuan/concerned.webp', import.meta.url).href,
    },
    B: {
      neutral: new URL('./assets/vn/characters/shenqing/neutral.webp', import.meta.url).href,
      concerned: new URL('./assets/vn/characters/shenqing/concerned.webp', import.meta.url).href,
      angry: new URL('./assets/vn/characters/shenqing/angry.webp', import.meta.url).href,
      surprised: new URL('./assets/vn/characters/shenqing/surprised.webp', import.meta.url).href,
    },
    C: {
      neutral: new URL('./assets/vn/characters/zhouye/neutral.webp', import.meta.url).href,
      angry: new URL('./assets/vn/characters/zhouye/angry.webp', import.meta.url).href,
      surprised: new URL('./assets/vn/characters/zhouye/surprised.webp', import.meta.url).href,
    },
  },
  backgrounds: { home, bedroom: home, kitchen, hall, parlor, office, station },
};

export const ART_CREDITS = [
  { author: 'Kainico', work: '人物立绘与表情（图层合成、缩放）', license: 'CC BY；原素材清单未注明版本', url: 'https://opengameart.org/content/lemmasoft-assets-portraits' },
  { author: 'spiral atlas', work: '居家背景（转为 WebP）', license: 'CC BY 3.0', url: 'https://opengameart.org/content/visual-novel-house-backgrounds' },
  { author: 'spiral atlas 与上游模型作者', work: '原模型、绘画及完整署名', license: '各项许可见来源', url: 'https://spiralatlas.github.io/credits/' },
  { author: 'ShatteredReality / Exuin', work: '人物素材汇编', license: '汇编为 CC BY-SA 3.0，单幅原画许可分别保留', url: 'https://opengameart.org/content/lemmasoft-assets-portraits' },
  { author: 'DasBilligeAlien', work: '办公室背景（转为 WebP）', license: 'CC0', url: 'https://opengameart.org/content/visual-novel-tutorial-set' },
  { author: 'Kace Rodriguez', work: '车站背景（缩放、转为 WebP）', license: 'CC0', url: 'https://commons.wikimedia.org/wiki/File:BART_platform_at_Embarcadero_station,_April_2016.jpg' },
];
