# 素材来源与授权 / Asset Credits & Licenses

本项目城镇的**地形、道路、城墙与大部分民居**由程序化几何生成；
同时**引入了第三方免费 3D 模型素材**（人物、动物、器物、树木、部分建筑），
这些模型不是代码生成的，而是真实的美术资源。

## Quaternius 免费素材包（CC0 / Public Domain）

来源仓库：https://github.com/beep2bleep/FreeAssetsByKenneyNLandQuaternius
原始作者：Quaternius — https://quaternius.com
授权：CC0 1.0 Universal（公共领域，可免费商用，无需署名）

本项目使用的模型（位于 `assets/models/`）：

| 文件 | 原始资源包 | 用途 |
|------|-----------|------|
| `House1.fbx`, `House2.fbx`, `Building4.fbx`, `Building2_Small.fbx` | Home and Buildings / Buildings Pack - Jan 2019 | 广场周边主建筑 |
| `Well.fbx`, `Windmill.fbx`, `Barn.fbx`, `ChickenCoop.fbx` | Farm Buildings - Sept 2018 | 器物与副建筑 |
| `char_male_casual.fbx`, `char_male_longsleeve.fbx`, `char_female_casual.fbx` | Animated Men/Women Characters - Feb 2019 | 带动画的村民 NPC（行走/奔跑/站立/跳跃） |
| `Cow.fbx`, `Horse.fbx`, `Sheep.fbx`, `Pig.fbx`, `Pug.fbx` | Farm Animals Animated - Jun 2018 | 带动画的家畜（行走/待机/奔跑） |
| `animal_fox.fbx`, `animal_bird.fbx` | Animals Pack - Oct 2016 | 野生动物 |
| `tree_Tree.fbx`, `tree_BigTree.fbx`, `tree_Bush.fbx`, `tree_Mushroom.fbx` | Textured Fantasy Nature - Mar 2017 | 树木与灌木 |

> 说明：原始素材为 FBX 格式，通过 Three.js `FBXLoader` 在运行时加载，
> 并在代码中统一缩放到米制单位（原始单位约为厘米/Blender 单位）。
> 动画片段（如 `HumanArmature|Man_Walk`）由 `AnimationMixer` 播放。

## Kenney 免费素材（CC0）

来源：https://kenney.nl （CC0 1.0）
本项目未直接下载，但作为同类 CC0 素材的备选来源记录于此。

若需替换/扩展素材，可从上述 CC0 来源自由获取。
