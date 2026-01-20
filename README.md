# Voice Visualizer - Horse Cell

这是一个基于 p5.js 的音频可视化项目。它展示了一个由粒子组成的“马”的形象，该形象会随着麦克风输入的音频声音发生形态变化。

## 功能特点
- **音频响应**：
  - **低音 (Bass)**：产生强烈的斥力，使马的形象“炸裂”或扩散。
  - **中音 (Mid)**：增加流场的扰动，使粒子像烟雾一样流动扭曲。
  - **总音量 (Volume)**：增加粒子的随机抖动，并减弱粒子回归原始形状的束缚力。
- **视觉效果**：青蓝色调的粒子系统，带有动态拖尾效果。

## 如何运行

由于浏览器安全策略（特别是麦克风权限），该项目最好在本地服务器环境下运行，而不是直接双击打开 `index.html`。

### 方法 1 (推荐): 使用 Python 启动简单服务器
如果你安装了 Python 3，可以在终端运行：

```bash
python3 -m http.server
```

然后打开浏览器访问 `http://localhost:8000`。

### 方法 2: VS Code Live Server
如果你使用 VS Code，安装 "Live Server" 插件，右键 `index.html` 选择 "Open with Live Server"。

## 自定义
你可以修改 `sketch.js` 中的 `drawHorse` 函数来改变基础形状，或者调整 `Particle` 类中的颜色和物理参数。
