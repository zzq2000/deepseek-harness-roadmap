# 章节写作约定

这一份是给**写课程内容的人**看的，不是使用手册。使用说明见[仓库根 README](../README.md)。

每章由三个文件组成：

```
chNN.zh.md      中文正文
chNN.en.md      英文正文
chNN.quiz.json  题目（双语题面 + 仅服务端可见的评分要点）
```

章节的标题、阶段、序号、是否已完成，登记在 [manifest.json](manifest.json)。`ready: false` 的章节在目录里显示为「编写中」，点开会提示尚未编写。

## 自定义 Markdown 语法

标准 Markdown 之外有三种语法，都用于和右侧 IDE 联动。路径一律相对于 `deepseek-harness/` 仓库根，**不带该前缀**。

**行内源码引用**，点击在右侧打开并高亮：

```
{{src:vendor/cordis/src/fiber.ts#L418-L561|ctx.effect()}}
```

竖线后是显示文字，省略则显示 `路径:行号`。也支持只给文件不给行号。

**块级源码卡片**，更醒目的整块引用：

````
```srcref vendor/cordis/src/fiber.ts#L427-L442
卡片上显示的说明文字
```
````

**可交互插图**，内嵌 SVG。给节点加 `class="node-hit" data-path=… data-start=… data-end=…` 即可点击跳源码：

````
```figure 图注文字
<svg viewBox="0 0 720 300">…</svg>
```
````

SVG 里的颜色请用 CSS 变量（`var(--fg)`、`var(--accent)`、`var(--bg-sunken)` 等），这样深浅两种主题下都能读。变量定义见 [static/app.css](../static/app.css)。

**提示框**，四种类型：

```
:::key 标题
内容
:::
```

| 类型 | 用途 |
|---|---|
| `key` | 本节最该记住的结论 |
| `note` | 补充说明 |
| `warn` | 容易踩的坑 |
| `lab` | 动手实验 |

## 题目格式

选择题与开放题分开。题面字段（`prompt` / `options` / `explain`）写成双语对象：

```json
{
  "id": "c1",
  "prompt": { "zh": "…", "en": "…" },
  "options": { "zh": ["…"], "en": ["…"] },
  "answer": 1,
  "explain": { "zh": "…", "en": "…" }
}
```

开放题多两个字段，`rubric` 与 `reference`。它们**只用中文，且永远不会下发到前端**，仅在服务端拼进判题 prompt：

```json
{
  "id": "o1",
  "prompt": { "zh": "…", "en": "…" },
  "context": [
    { "path": "vendor/cordis/src/fiber.ts", "lineStart": 427, "lineEnd": 442, "note": "倒序串行" }
  ],
  "rubric": ["必须指出…", "（加分）注意到…"],
  "reference": "参考答案全文"
}
```

`context` 声明该题涉及的源码位置。判题时服务端按这些声明**去仓库实时抠出代码**拼进 prompt，所以源码更新后题目上下文不会过期。

写 `rubric` 时把要点拆细、逐条可判，判卷会逐条回报命中与否。加分项用「（加分）」开头，漏掉不影响及格。

## 写作基调

- **不用破折号**（`——` 和 ` — `），改用冒号、逗号或断句。
- **不做防御性铺垫**。该下结论就下结论，不写「你不需要记住这些」「答不上来也正常」这类预先安慰。
- **贴源码、逐句拆、追问为什么这么写**。讲清一段代码在防什么，比复述它做什么有用。
- 行号引用必须精确到函数边界，写完用校验脚本确认。

## 校验

改完内容跑一次：

```sh
node ../check-content.js
```

它会校验每条源码引用的文件与行号、Markdown 渲染是否干净（标签配平、无未解析语法、无占位符泄漏）、双语题面是否对称。断链会直接列出来。
