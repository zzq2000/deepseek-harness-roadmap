# DeepSeek Harness 源码精读

一个本地运行的交互式课程，目标是**完全读懂 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的源码，并能基于它做二次开发**。

课程同时解读 DSH 底层插件框架 Cordis 的论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper)：第 0 章给出出处，第 2 章末尾在读完源码之后做完整对照，第 3 章接上它的配置层部分。

---

## 快速开始

```sh
git clone --recursive https://github.com/zzq2000/deepseek-harness-roadmap.git
cd deepseek-harness-roadmap
python3 serve.py
```

然后打开 http://127.0.0.1:5173，`Ctrl-C` 停止。

**忘了 `--recursive`？** 补一句即可：

```sh
git submodule update --init
```

判卷需要 DeepSeek API Key，在仓库根目录建一个 `.env`：

```sh
DEEPSEEK_API_KEY=sk-...
DEEPSEEK_BASE_URL_OPENAI=https://api.deepseek.com
```

没有 Key 也能读教程、做选择题，只有开放题判卷不可用。

### 环境要求

| 组件 | 要求 | 说明 |
|---|---|---|
| **Python** | 3.9+ | 只用标准库，**无需 `pip install`**（开发与测试环境为 3.14） |
| **现代浏览器** | 支持 ES2020 | 前端无构建、无 CDN、无框架 |
| **DeepSeek API Key** | 可选 | 缺失时除开放题判卷外一切照常 |
| **ripgrep** | 可选 | 加速全文搜索；未装则回退纯 Python 扫描（约 0.5 秒） |

学习 DSH 本身（第 3 章起的动手实验）另需 Node 与 pnpm，要求见课程第 0 章。

### 常用选项

- 换端口：`ROADMAP_PORT=8080 python3 serve.py`
- 换判题模型：在 `.env` 里加 `ROADMAP_MODEL=deepseek-v4-flash`
- 装 ripgrep 加速搜索：`brew install ripgrep`（macOS）

启动时会打印仓库路径、搜索引擎、API Key 是否已载入。判题不工作时先看这几行。

---

## 课程大纲

13 章，从框架地基一路读到二次开发。深度基准是**关键路径逐行走读**：对主干链路做函数级走读并配调用栈图，非主干包只讲职责与接口。

| 阶段 | 章 | 主题 | 状态 |
|---|---|---|---|
| 起步 | 0 | 先跑起来，再看地图 | ✅ |
| 地基 | 1 | Cordis 插件模型：Context、Fiber 与可撤销副作用 | ✅ |
| 地基 | 2 | 服务与事件：`ctx` 上的能力如何解析与分发 | ✅ |
| 装配 | 3 | 启动链：从 `dsh web` 到一棵插件树 | ✅ |
| 状态 | 4 | 会话日志：模型可见即已记录 | ✅ |
| 心脏 | 5 | Agent Loop：一次轮次的完整生命周期 | ✅ |
| 模型 | 6 | LLM 层：流式协议与适配器契约 | ✅ |
| 上下文 | 7 | 提示词组装、skill 与压缩 | 待写 |
| 工具 | 8 | 工具注册与受保护的执行流水线 | 待写 |
| 工具 | 9 | 能力 seam 与安全边界 | 待写 |
| 编排 | 10 | subagent、workflow 与后台任务 | 待写 |
| 边界 | 11 | 概要：typert RPC 与 host/client 分层 | 待写 |
| 产出 | 12 | 二次开发：把研究问题落到扩展点上 | 待写 |

最终目标是第 12 章：在 DSH 上写出新的 plugin，包括新工具、自进化、记忆机制、多智能体排布。

---

## 目录结构

```
.
├── serve.py              本地服务（零第三方依赖）
├── check-content.js      内容校验：源码引用、渲染、双语对称
├── static/
│   ├── index.html        页面骨架
│   ├── app.css           深浅双主题样式
│   ├── app.js            主逻辑：教程↔IDE 联动、题目、进度、判题
│   ├── markdown.js       Markdown 渲染器（含三种自定义语法）
│   └── highlight.js      语法高亮（TS / YAML / JSON / Shell）
├── content/              课程内容（写作约定见 content/README.md）
│   ├── manifest.json     章节清单
│   ├── chNN.zh.md        中文正文
│   ├── chNN.en.md        英文正文
│   └── chNN.quiz.json    题目（双语题面 + 仅服务端可见的评分要点）
├── deepseek-harness/     被学习的源码（git submodule，锁定 commit）
└── progress.json         学习进度（自动生成，已 gitignore）
```

### 为什么源码是 submodule

`deepseek-harness/` 以 submodule 形式锁定在一个具体 commit 上。教程里有**上百条精确到行号的源码引用**，锁定 commit 才能保证它们永远对得上。上游一更新，未锁定的行号就会错位。

要升级到上游新版本：

```sh
cd deepseek-harness && git pull origin master && cd ..
node check-content.js        # 立刻检查哪些行号引用失效了
git add deepseek-harness && git commit -m "bump harness"
```

---

## 进度与完成判定

进度存在 `progress.json`（已 gitignore）。一章标记为「已完成」需要同时满足：

1. 手动点了「标记本章已读」
2. 选择题全对
3. 开放题平均分 ≥ 70

---

## 许可

课程内容归本仓库作者。被学习的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 由 DeepSeek AI 以 MIT 许可发布，以 submodule 引用，不在本仓库内分发。
