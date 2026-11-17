# 古镇漫游

基于 Three.js 的浏览器端 3D 古镇漫游原型。场景由程序化建筑、道路、植被和水景组成，并使用 FBX 人物/动物模型、昼夜环境、天气效果与第一人称控制。

## 运行

需要安装 Node.js。项目没有 npm 依赖或构建步骤；Three.js 及其 addons 通过页面中的 import map 从 unpkg 加载，因此首次运行需要网络连接。

在项目根目录运行：

```powershell
node serve.mjs
```

打开 <http://127.0.0.1:8917>。如需更换端口：

```powershell
$env:PORT = 9000
node serve.mjs
```

然后访问 <http://127.0.0.1:9000>。也可以直接运行静态服务器，确保页面与 `assets/` 目录通过同一 HTTP 服务提供。浏览器需要支持 WebGL。

## 操作

| 输入 | 操作 |
|---|---|
| `W` `A` `S` `D` / 方向键 | 移动 |
| `Shift` | 奔跑 |
| `Space` | 跳跃 |
| `W` / `S` 靠近梯子时 | 攀爬 / 下梯 |
| 鼠标点击画面 | 第一人称模式下锁定指针 |
| 鼠标移动 | 第一人称视角 |
| `V` | 切换俯视与第一人称 |

右上角可切换晨、午、夕、夜；“设置”中可调整移动参数、天气、画质、环境雾和 Y 轴反转。环境雾默认关闭，设置会保存在浏览器本地。模型动态预览可从右上角进入。

## 项目结构

| 路径 | 用途 |
|---|---|
| `index.html` | 古镇漫游主页面与界面 |
| `main.js` | 初始化、输入、相机、玩家移动和主循环 |
| `world.js` | 小镇布局、建筑、碰撞、昼夜与环境光照 |
| `scenery.js` | 草木、池塘、风、雨、雾、船与场景陈设 |
| `npc.js` | 人物与动物生成、动画、移动和互动 |
| `assets.js` | FBX 模型加载、缩放和动画资源管理 |
| `materials.js`、`textures.js` | 材质、PBR 贴图与 HDRI 环境 |
| `postprocessing.js` | Bloom、SSAO、调色和抗锯齿 |
| `preview.html`、`preview.js` | 模型及动画预览页面 |
| `assets/` | 模型、贴图与 HDRI 文件 |
| `serve.mjs` | 零项目依赖的本地静态服务器 |

## 资源与授权

项目使用的模型及其来源见 [`assets/CREDITS.md`](assets/CREDITS.md)。PBR 贴图与 HDRI 的来源和目录说明见 [`ASSETS.md`](ASSETS.md)。添加或替换第三方资源时，请同步核实并记录相应授权。

## 开发说明

- 原生 JavaScript ES modules，无打包工具或自动化测试套件。
- 编辑后重新载入浏览器页面；本地服务器发送 no-store 缓存头。
- 设计方案与阶段记录见 [`DESIGN.md`](DESIGN.md)，代码和体验评估见 [`EVALUATION.md`](EVALUATION.md)。其中规划内容不一定都已实现。
