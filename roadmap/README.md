# DeepSeek Harness 源码精读 Roadmap

一个本地运行的交互式学习网站：左侧教程、右侧 IDE（文件树 + 源码），教程里的每处源码引用都能点开并高亮到具体行；每章配选择题与开放问答，开放题由 DeepSeek 对照**从仓库实时抽取的源码上下文**批改。

## 运行

```sh
python3 roadmap/serve.py
```

然后打开 http://127.0.0.1:5173。

**没有任何第三方依赖**，只用 Python 标准库。不需要 `pip install`。

- 判题读取项目根目录 `.env` 里的 `DEEPSEEK_API_KEY`（已存在则自动可用）。
- 全文搜索优先用 `ripgrep`；没装则回退纯 Python 扫描（约 0.5 秒，可用）。装了 `rg` 会更快：`brew install ripgrep`。
- 换端口：`ROADMAP_PORT=8080 python3 roadmap/serve.py`
- 换判题模型：在 `.env` 里加 `ROADMAP_MODEL=deepseek-v4-flash`

## 目录

```
roadmap/
  serve.py              本地服务（零依赖）
  static/
    index.html          页面骨架
    app.css             深浅双主题样式
    app.js              主逻辑：教程↔IDE 联动、题目、进度、判题
    markdown.js         Markdown 渲染器（含三种自定义语法）
    highlight.js        语法高亮（TS/YAML/JSON/Shell）
  content/
    manifest.json       章节清单
    chNN.zh.md          中文正文
    chNN.en.md          英文正文
    chNN.quiz.json      题目（双语题面 + 仅服务端可见的评分要点）
  progress.json         学习进度（自动生成，已 gitignore）
```

## 内容里的自定义语法

写章节时可用三种标准 Markdown 之外的语法，都用于和右侧 IDE 联动：

**行内源码引用** —— 点击在右侧打开并高亮：

```
{{src:vendor/cordis/src/fiber.ts#L418-L561|ctx.effect()}}
```

**块级源码卡片** —— 更醒目的整块引用：

````
```srcref vendor/cordis/src/fiber.ts#L427-L442
卡片上显示的说明文字
```
````

**可交互插图** —— 内嵌 SVG，给节点加 `class="node-hit" data-path=… data-start=… data-end=…` 即可点击跳源码：

````
```figure 图注文字
<svg viewBox="0 0 720 300">…</svg>
```
````

**提示框** —— 四种类型 `note` / `warn` / `key` / `lab`：

```
:::key 标题
内容
:::
```

路径一律相对于 `deepseek-harness/` 仓库根，不带该前缀。

## 题目格式

`chNN.quiz.json` 分选择题与开放题。题面字段（`prompt` / `options` / `explain`）写成 `{"zh": …, "en": …}`；`rubric` 与 `reference` 只用中文，**永远不会下发到前端**，仅在服务端拼进判题 prompt。

开放题的 `context` 声明该题涉及的源码位置：

```json
"context": [
  { "path": "vendor/cordis/src/fiber.ts", "lineStart": 427, "lineEnd": 442, "note": "倒序串行" }
]
```

判题时服务端按这些声明**去仓库实时抠出代码**拼进 prompt，所以源码更新后题目上下文不会过期。

## 进度与完成判定

进度存在 `progress.json`。一章标记为「已完成」需要同时满足：

1. 手动点了「标记本章已读」
2. 选择题全对
3. 开放题平均分 ≥ 70

## 已知限制

- **选择题答案在前端**。选择题为了即时判分不消耗 API，`answer` 字段随题目下发，打开开发者工具能看到。开放题的评分要点则严格保留在服务端。
- **符号跳转是正则级的**，不是真 LSP。覆盖绝大多数 TS 顶层定义与类方法，同名符号会列出多处让你选，偶有误报。
- **服务只监听 127.0.0.1**，无鉴权。它能读取整个 `deepseek-harness/` 目录，不要暴露到公网。
- **单文件上限 2MB**，超过的文件（如 `pnpm-lock.yaml`）不予打开。

## 校验脚本

改完内容后建议跑一次引用校验，确保没有断链：

```sh
node roadmap/check-content.js
```

它会校验每条源码引用的文件与行号、Markdown 渲染是否干净、双语题面是否对称。断链会直接列出来。
