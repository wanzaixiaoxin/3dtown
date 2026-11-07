# 资产采购清单 · 达到参考图质量所需

> 目标：半写实新中式园林（参考图 1/2/3/5 的氛围 + 参考图 4 的建筑精度）
> 原则：**材质 > 模型**。同一套低模，配上 PBR 材质 + HDRI + 后期，观感能提升 50% 以上。

---

## 优先级总览

| 优先级 | 类别 | 数量 | 预算 | 对画面贡献 |
|---|---|---|---|---|
| **P0** | PBR 材质贴图 | 14 套 | 免费 | ★★★★★ |
| **P0** | HDRI 天空环境 | 4 张 | 免费 | ★★★★★ |
| **P0** | 后期/LUT/粒子贴图 | 1 包 | 免费 | ★★★★☆ |
| **P1** | 中式古建模块套件 | 1 套（约 40 件） | 免费~¥600 | ★★★★★ |
| **P1** | 水面法线 / 湿地面贴图 | 2 套 | 免费 | ★★★★☆ |
| **P2** | 植被（松/柳/樱/竹/荷/草） | 6 种 × 2 LOD | 免费~¥300 | ★★★★☆ |
| **P2** | 陈设小道具 | 15 件 | 免费~¥200 | ★★★☆☆ |
| **P2** | 汉服人物 + 动画 | 4–6 个 | 免费~¥400 | ★★★☆☆ |
| **P3** | 环境音效 | 8 条 | 免费 | ★★☆☆☆ |

**总计：纯免费方案可以做到 85% 效果；若预算 ¥1000–1500 可补齐建筑与人物短板。**

---

## 一、P0 · PBR 材质（最关键）

### 需要哪些（14 套，每套含 albedo / normal / roughness / AO）

| # | 材质 | 用途 | 分辨率 | 特殊要求 |
|---|------|------|--------|----------|
| 1 | 青石板（湿） | 主街、庭院地面 | 2048 | **roughness 0.1–0.25**，带水渍 |
| 2 | 花岗岩/毛石 | 台基、驳岸、桥 | 1024 | 粗糙、有凿痕 |
| 3 | 中式筒瓦（黛色） | 民居屋顶 | 1024 | 有瓦垄凹凸法线 |
| 4 | 琉璃瓦（绿/黄） | 主楼阁屋顶 | 1024 | 高光、釉面 |
| 5 | 白灰墙（做旧） | 墙面 | 1024 | 污渍、雨痕、剥落 |
| 6 | 木纹（深色老木） | 梁柱、门窗 | 1024 | 木纹清晰 |
| 7 | 朱漆木（红） | 柱子、门 | 1024 | 漆面微反光 |
| 8 | 青砖 | 影壁、围墙 | 1024 | 砖缝 |
| 9 | 树皮 | 树干 | 512 | — |
| 10 | 苔藓/地被 | 假山、石阶 | 512 | 有绒毛感 |
| 11 | 水面法线 | 池塘 | 1024 | **可平铺、双法线混动** |
| 12 | 卵石/池底 | 浅水区 | 1024 | — |
| 13 | 金属（铜/铁） | 铜鼎、门环 | 512 | metalness 1.0 |
| 14 | 纸/绢（灯笼） | 灯笼面 | 512 | 半透明、暖色 |

### 免费来源（CC0，可商用）
- **ambientCG** — https://ambientcg.com （最强，按类别筛选 Paving / Tiles / Wood / Plaster）
- **Poly Haven** — https://polyhaven.com/textures （质量高，有 1K/2K）
- **CC0 Textures** — https://cc0-textures.com
- **FreePBR** — https://freepbr.com

### 搜索关键词
`wet paving stones` `chinese roof tile` `grey brick` `lime plaster` `old wood planks` `water normal` `moss` `granite`

### 格式要求
- JPG/PNG，**2K 为主，1K 够用**（4K 不要，web 浪费）
- 必须有 `_normal`（法线）与 `_roughness`
- 平铺无缝（seamless）

---

## 二、P0 · HDRI 天空（决定光照基调）

| # | 用途 | 要求 | 来源关键词 |
|---|------|------|-----------|
| 1 | 黄昏/落日 | 暖橙粉、低太阳 | `sunset` `dusk` `golden hour` |
| 2 | 夜晚 | 深蓝、有月/星 | `night sky` `moonlit` |
| 3 | 蓝调时刻 | 青蓝、薄雾 | `blue hour` `twilight` |
| 4 | 阴天柔光 | 灰白均匀 | `overcast` |

- **Poly Haven**（CC0）→ 下载 **.hdr，1K 或 2K**
- 用法：`RGBELoader` → `PMREMGenerator` → `scene.environment`，同时给所有 PBR 材质提供反射
- 文件名建议：`sky_dusk_2k.hdr` / `sky_night_2k.hdr` / `sky_bluehour_2k.hdr` / `sky_overcast_2k.hdr`

> 这一项对"真实感"的贡献被严重低估：有了 HDRI，金属、瓦片、水面立刻不再是"塑料感"。

---

## 三、P0 · 后期与特效贴图

| 资产 | 说明 | 来源 |
|---|---|---|
| 调色 LUT | .cube 格式，暮色/夜色两套 | Free LUT packs（如 `free film LUTs`） |
| 噪点/颗粒 | 512 灰噪 | ambientCG |
| 镜头光晕 | 4–6 张 sprite（太阳/灯笼） | 自制或 `lens flare textures free` |
| 云层贴图 | 可平铺云噪声 | Poly Haven / 自制 |
| 雾团 billboard | 2–3 张柔边雾 | 自制 Canvas 或免费 fog sprites |
| 花瓣/落叶 | 1 张 alpha 图集 | 自制 |

---

## 四、P1 · 中式古建模块套件（最重要的一笔模型资产）

### 方案 A：免费拼装（推荐先做）
从以下来源分别找单体，统一缩放到米制：

| 构件 | 数量 | 免费来源 |
|---|---|---|
| 楼阁/塔（2–3 层） | 1–2 | Poly Pizza（CC-BY）、Sketchfab（CC0/CC-BY） |
| 亭（四角/六角） | 2 | 同上 |
| 回廊/廊架 | 1 套 | Sketchfab |
| 门楼/牌坊 | 1 | Sketchfab |
| 石拱桥（三孔） | 1 | Sketchfab / CGTrader free |
| 栏杆/望柱 | 1 套 | 自制（参数化）即可 |
| 斗拱 | 1 模块（可阵列） | Sketchfab |
| 屋顶脊兽/宝顶 | 4–6 个 | Sketchfab |
| 格栅门窗 | 3–5 种 | 自制（细 box 阵列） |
| 灯笼（宫灯/纸灯/串灯） | 5 种 | Poly Pizza / 自制 |

**搜索词**：`chinese pavilion` `chinese pagoda` `chinese corridor` `chinese gate` `stone arch bridge` `dougong` `chinese lantern`

### 方案 B：付费套件（省 2–3 天，质量更统一）
- **Unity Asset Store**：搜 `Chinese Architecture` / `Ancient Chinese Town` / `Oriental Garden`（约 $30–80）
- **Fab (Epic)**：搜 `Chinese temple` / `Asian garden`
- **CGTrader / TurboSquid**：单件 $10–40

> ⚠️ 采购注意：
> - 必须能导出 **FBX / GLB / OBJ**（Unity 的 .prefab 不能直接用）
> - 单件三角面 **< 80k**，整套 **< 400k**
> - 贴图必须**内嵌或同名同目录**（否则加载丢材质）
> - 授权必须允许**网页/商业项目**使用

### 最低配置（性价比最高）
```
1 个主楼阁（重檐，30–80k tris）
2 个亭（四角/六角，15–30k）
1 套回廊（20k）
1 座石桥（10k）
6 类中式屋顶构件（可复用）
5 种灯笼
```

---

## 五、P1 · 水面与湿地反射

| 资产 | 说明 | 来源 |
|---|---|---|
| 水面法线贴图 | 2 张不同频率，滚动叠加 | ambientCG `water` |
| 湿石板 roughness 图 | 局部低粗糙度 | 从石板材质改 |
| 平面反射 | 代码实现（THREE.Reflector） | 无需资产 |
| 池底卵石 | 1 张 albedo | ambientCG `pebbles` |

---

## 六、P2 · 植被（6 种，建议程序化 + 少量模型混合）

| 树种 | 用途 | 面数/棵 | 来源 |
|---|---|---|---|
| 松（层叠伞状） | 假山、庭院主景 | 5–8k | Quaternius / Sketchfab |
| 垂柳 | 池边 | 4–6k | 程序化（已有，需升级） |
| 樱/桃（粉花） | 点景 | 8–12k | Sketchfab CC0 |
| 竹（丛） | 后园 | 2–4k/丛 | 程序化 |
| 荷（叶+花） | 水面 | 500/株 | 程序化 |
| 草/蕨/野花 | 地被 | instanced | 程序化（已有） |

**搜索词**：`pine tree low poly` `willow tree` `cherry blossom tree` `bamboo cluster` `lotus`

> 建议：树用 **2 级 LOD**（近景模型 / 远景 billboard），否则 30 棵树就爆显存。

---

## 七、P2 · 陈设小道具（15 件，快速提升生活感）

| 道具 | 数量 | 来源 |
|---|---|---|
| 石狮 | 2 | Sketchfab CC0 |
| 铜鼎/香炉 | 1 | Sketchfab |
| 乌篷船 | 1 | Sketchfab |
| 水缸 | 2 | 自制/免费 |
| 幡旗/酒旗 | 3 | 自制（面片+贴图） |
| 灯笼串 | 1 套 | 自制 |
| 竹椅/木桌 | 2 | Quaternius Furniture（已有） |
| 盆栽/盆景 | 3 | Quaternius / 自制 |
| 石灯 | 2 | 自制 |
| 晒衣杆/竹竿 | 2 | 自制 |

**搜索词**：`chinese stone lion` `bronze ding` `wooden boat` `chinese banner`

---

## 八、P2 · 人物（提升"活气"）

| 资产 | 要求 | 来源 |
|---|---|---|
| 汉服村民模型 | 4–6 个，5–15k tris，含骨骼 | Sketchfab CC0 / Quaternius（现有） |
| 人物动画 | idle / walk / run / 对话 | **Mixamo（免费）** |
| 动物 | 狗/猫/鸡/鱼 | Quaternius（已有） |

> Mixamo 动画可直接应用到任意 humanoid 骨骼（需重定向），这是提升 NPC 自然度最省钱的方案。

---

## 九、P3 · 音效（可选但加分明显）

| 音效 | 用途 | 来源 |
|---|---|---|
| 园林环境底噪 | 循环 | freesound.org（CC0） |
| 水声/瀑布 | 池塘 | freesound |
| 风吹竹叶 | 后园 | freesound |
| 鸟鸣 | 白天 | freesound |
| 蟋蟀/蛙鸣 | 夜晚 | freesound |
| 脚步声（石/木） | 第一人称 | freesound |

---

## 十、不要买的东西（用代码做更好）

| 项目 | 原因 |
|---|---|
| 地形/山体 | 程序化 + 噪声即可，模型反而占资源 |
| 远山 | 用 **billboard 剪影 + 雾**，1 张图搞定 |
| 围墙/台基/台阶 | 参数化生成，尺寸可控 |
| 草地 | InstancedMesh 草叶（已有） |
| 星空/云 | Shader 生成（已有，需加强） |
| 水面反射 | `THREE.Reflector` 代码实现 |

---

## 十一、推荐采购顺序（省钱路线）

### 第 1 天：全部免费，先做光影
1. ambientCG 下载 **8 套 PBR**（青石板/瓦/白墙/木/石/苔藓/水面/卵石）
2. Poly Haven 下载 **3 张 HDRI**（黄昏/夜/蓝调）
3. 接入 PMREM + Bloom + 湿地面 → **立刻看到参考图 2/6 的夜景质感**

### 第 2–3 天：补建筑
4. Sketchfab 找 **1 楼阁 + 2 亭 + 1 桥**（CC0/CC-BY）
5. 自建参数化飞檐 + 格栅窗 + 栏杆

### 第 4–5 天：补植被与陈设
6. 松/樱/竹 3 种模型 + 程序化柳/荷/草
7. 石狮/铜鼎/乌篷船 3 件

### 若预算 ¥1000–1500
- 直接买 1 套 `Chinese Architecture Kit`（¥400–600）
- 买 2–3 个高质量汉服人物（¥300）
- 买 1 个樱花树包（¥200）

---

## 十二、验收清单（资产到位后逐项打勾）

- [ ] 所有地面/墙面/木构都有 normal + roughness（不是纯色）
- [ ] HDRI 已接入 `scene.environment`，金属/瓦片有反射
- [ ] 湿石板在夜景能映出灯笼
- [ ] 屋顶有瓦垄凹凸与起翘檐口
- [ ] 至少有松/柳/樱/竹 4 种树形
- [ ] 灯笼有自发光 + Bloom 溢光
- [ ] 远景有山/雾剪影
- [ ] 场景 draw call < 150，triangles < 500k
