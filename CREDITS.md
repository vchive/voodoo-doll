# 美术来源与署名

2026-09-19 软件源码研究补充：已下载 boardgame.io 固定提交 `5e9a2c94bde803fae8b081958c406c4d0a7be8ae`，核对 MIT 许可证与 reducer/master；仅用于架构研究，没有复制到运行时或加入依赖。来源、版权和复用结论见 [源码审计](docs/research/2026-09-19-source-reuse-audit.md)。当前已有 Pi 依赖/调度核心保持原有来源记录，本说明只针对本轮新增研究。

更新：2026-09-18，VIS-01 精致像素人物升级。

## 当前实际使用：项目原创像素绘制

- `hex/characters.js`：32×48 像素人物，Canvas 整数像素绘制并生成 Pixi 纹理；由本项目编写，没有临摹或修改下列第三方图集。
- `hex/stage.js`：16 像素逻辑网格、六套地板、家具、窗光、烛台与缝线娃娃均由本项目的 Pixi 绘制代码产生。
- 当前活动人物与舞台未使用外部人物包或图像生成模型，没有远程图片请求，也没有对付费 Donarg 图块的运行依赖。用户随后要求以实际下载比较画质：下载的候选仅在 `.local-assets/visual-candidates/` 本地自测，未注入游戏或正式构建。
- 原创绘制代码随项目管理，未引入额外第三方素材许可要求。本文件不替仓库设定总的软件许可证。

### LPC 自测比较层（可选、本地）

- `hex/selftest/lpc/{YOU,A,B,C,Z}.png` 是从本机合成预览裁出的 64×64 LPC 精灵表，供 VIS-01 的画质对比使用。它们不是默认发布素材：`hex/vite.config.js` 设置 `publicDir: false`，所以 `npm run hex:build` 不会把该目录复制到 `dist-hex/`；缺失文件时舞台自动回退 `hex/characters.js` 的原创 Canvas 人物。
- 合成层来自 [Universal LPC Character Generator](https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator) 及其 LPC 图层包。该生成器仓库和图层清单包含 CC-BY-SA 3.0、GPL 3.0、OGA-BY 等混合许可；合成图仅用于本机自测，未作为可再分发的产品素材。若要随产品发布，必须先为每个实际使用的身体、发型和衣物图层补齐作者署名与许可核验。
- 自测图通过 `/selftest/lpc/{ID}.png` 首选加载；加载超时、404 或格式不符都不会阻塞舞台启动。自测资源不包含 Donarg 付费图块，也不改变历史 `hex/public/donarg/` 的排除规则。

| 舞台位 | 可区分的日常外形 | 动作 |
|---|---|---|
| YOU | 蓬松短发、鼠尾草绿连帽卫衣、蓝灰牛仔裤、浅色球鞋 | 四方向四帧步行、朝向待机、呼吸、眨眼、说话与物件动作 |
| A | 侧分短发、米灰长外套、衬衫领带、深色长裤和皮鞋 | 同上；长外套下摆为独立轮廓 |
| B | 赤棕短波波头与发夹、淡紫开衫、深色裙装和短靴 | 同上；发型和裙摆为独立轮廓 |
| C | 深色卷发、眼镜、赭色夹克、浅色内搭和球鞋 | 同上；卷发、眼镜和夹克为独立轮廓 |
| Z | 海军蓝便帽、蓝灰工装、宽松裤、斜挎帆布包 | 同上；帽檐和包为独立轮廓 |

五个人不是同一图集换色，脸型呈现、头发、衣服、配件和下摆各有不同绘制。没有盔甲、法袍、机甲。角色身份与外形只是默认舞台造型，不限制玩家起名或讲述关系。

人物帧尺寸与图片字节数不是产品硬约束；旧 `docs/sprite-requirements.md` / `sprite-options.md` 中的 16×16、总计 10KB 是历史搜索假设，本轮采用 32×48 以保证手机上的发型和动作可读性。

## 历史文件（当前舞台不再加载）

以下署名为保全旧文件的来源信息而保留。历史素材仍在本机时，不等于允许随发布包分发；构建应排除历史 `hex/public/donarg/`。当前界面无需这些文件。

### Office worker sprites

- 作者：Solar Granulation。
- 来源：https://opengameart.org/content/office-worker-sprites
- 页面许可：CC-BY 4.0（同时列有 CC-BY 3.0）。本项目保留作者与来源署名。
- 历史文件：`hex/public/oga/WorkerSheet*.png`、`office_atlas.json`、`ComputerSheet.png`、`WatercoolerSheet.png`。
- 原先 YOU/A/B/C 的四种上班族配色现已由原创人物替换。

### Pixel Worker “Fukushima”

- 作者：domsson。
- 来源：https://opengameart.org/content/pixel-worker-sprite-fukushima
- 许可：CC0。
- 历史文件：`hex/public/oga/passerby_{default,hat,mask}.png` 与同名 JSON。
- 原先路人 Z 的工人精灵现已由原创工装人物替换。

### Donarg Office Tileset 与 agent_world

- 来源线索：https://github.com/luccathescientist/agent_world ，上游项目未声明仓库许可证。
- Donarg 随包条款允许商业/非商业项目使用，但禁止转售/分发图块本身、禁止用于 web3/NFT/加密货币/区块链项目或训练 AI。
- 历史文件 `hex/public/donarg/office_16x16.png` 曾用于本机地板验证；当前已移除代码引用。**未经清晰授权，不将该目录加入仓库或发布产物。**
- 同目录历史 `lucca` / `robo` 人物为奇幻/科幻风格且未核实许可，当前同样不使用。
- 未清理这些文件是为了保留已有工作，不代表它们是本轮交付素材。

### 更早已移除的 BrowserQuest

来源：https://github.com/mozilla/BrowserQuest ，Mozilla 2012；其内容采用 CC-BY-SA 3.0。该目录已在以前的工作中删除，当前没有引用。


## 本轮下载比较（用户要求先看最好效果、后续再替换授权素材）

实际文件与对比图保存在 `.local-assets/visual-candidates/`（不提交、不发布），包括：

| 候选 / 来源 | 已下载检查 | 结果 |
|---|---|---|
| [Kenney Tiny Town](https://kenney.nl/assets/tiny-town) | 官方 ZIP、PNG 图集、Preview | CC0；像素环境成熟，但包中没有所需四向现代人物；保留为未来街区布景候选 |
| [OGA Pixel City Bros](https://opengameart.org/content/chadmandoo-pixel-city-bros-characters) | `random_characters.zip`，11 张 PNG/GIF | 发布者 pixelcitybros；现代成年街头造型，但主体为静态/idle 与侧视概念稿，缺少四向行走，未替换 |
| [OGA LPC character bases](https://opengameart.org/content/lpc-character-bases) | `lpc-character-bases-v3_1.zip`，约 32MB；另取三套衣服包 | 可拓展成人体型；实际配套衣服多数为奇幻服装，完整现代五人仍需重新搭配，不把裸模作为成品 |
| [OGA LPC clothes and hair](https://opengameart.org/content/lpc-clothes-and-hair)、[More LPC clothes](https://opengameart.org/content/more-lpc-clothes-and-hair)、[Male variety](https://opengameart.org/content/lpc-male-clothes-variety-pack) | 三 ZIP 合计 60 张 PNG，已读取目录与预览 | Nila122 / Boom Shaka / wulax；页面多许可（CC-BY-SA/GPL，部分 OGA-BY），长靴、束身、兜帽等不合当前日常造型，未替换 |
| [OGA 24×32 bases](https://opengameart.org/content/24x32-bases-0)、[modern clothes](https://opengameart.org/content/clothes-for-24x32-bases) | 现代西装/外套/裙装预览与基础图层 | diamonddmgirl，CC0；四向三帧、成熟比例，现代衣服方向合适，但仍是没有脸/发型的图层套件，可作为后续组装候选 |
| [OGA Lyuba](https://opengameart.org/content/24x32-heroine-lyuba-sprites-faces-pictures) | 61KB ZIP，精灵与肖像 | Svetlana Kushnariova / Cabbit，CC-BY 3.0 / OGA-BY 3.0；动作齐但“casual”实际是斯拉夫长裙，未替换现代角色 |
| [DOTOWN](https://dotown.maeda-design-room.net/) | 官方页面中的人物 PNG | 品牌插画式大色块静态人物，不是四向游戏精灵，不用于角色 |

同时核查 [LimeZu Modern Interiors](https://limezu.itch.io/moderninteriors)、[Modern Exteriors](https://limezu.itch.io/modernexteriors)、[Raroki Characters](https://raroki.itch.io/characters)：本机请求、IPv4 与备用读取仍超时，浏览器提供器也未能建立会话，未拿到包，因此**不声称已看过图或已比较质量**，没有购买或绕过付费下载。当前结论基于真正下载到的文件。

选择：本轮继续使用已实现的五种原创精致像素人物，它们已具备四向步态、现代差异穿搭与一致的视觉比例。外部素材调查是实际下载、解包、看图后的判断，不因“搜索结果有某包”就替换成不完整或古装角色；后续可单独验证 24×32 现代图层或获得 LimeZu 官方可用包后升级。
