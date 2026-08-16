#!/usr/bin/env node
/* 内容校验：写完/改完章节后跑一次。
 *   node check-content.js
 *
 * 检查三件事：
 *   1. 所有源码引用（行内 {{src:}}、块级 srcref、插图 node-hit、题目 context）
 *      指向的文件确实存在，且行号在文件范围内
 *   2. Markdown 渲染无残留的未解析语法、无占位符泄漏
 *   3. 双语题面结构对称（zh/en 都在，选项数一致）
 */

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = __dirname;
const REPO = path.join(ROOT, 'deepseek-harness');
const CONTENT = path.join(ROOT, 'content');

const sandbox = { window: {}, console };
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
for (const file of ['static/highlight.js', 'static/markdown.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), sandbox);
}
const { MD } = sandbox.window;

let problems = 0;
let refs = 0;
const fail = (msg) => { console.log(`  ✗ ${msg}`); problems++; };

function checkRef(rel, start, end, where) {
  refs++;
  const abs = path.join(REPO, rel);
  if (!fs.existsSync(abs)) return fail(`${where}: 文件不存在：${rel}`);
  if (!start) return;
  const lines = fs.readFileSync(abs, 'utf8').split('\n').length;
  if (+start > lines || +end > lines) {
    fail(`${where}: ${rel} 只有 ${lines} 行，却引用了 ${start}-${end}`);
  }
}

function scanHtml(html, where) {
  const re = /data-path="([^"]+)"(?: data-start="(\d+)" data-end="(\d+)")?/g;
  let match;
  while ((match = re.exec(html))) checkRef(match[1], match[2], match[3], where);

  if (/\{\{src:/.test(html)) fail(`${where}: 有未解析的 {{src:}} 引用`);
  if (/^:::/m.test(html)) fail(`${where}: 有未闭合的 ::: 提示框`);
  if (/[]/.test(html)) fail(`${where}: 渲染占位符未回填`);

  for (const tag of ['div', 'span', 'p', 'pre', 'table', 'ul', 'ol', 'li', 'figure']) {
    const open = (html.match(new RegExp(`<${tag}[\\s>]`, 'g')) || []).length;
    const close = (html.match(new RegExp(`</${tag}>`, 'g')) || []).length;
    if (open !== close) fail(`${where}: <${tag}> 标签不配平（${open} 开 / ${close} 闭）`);
  }
}

const manifest = JSON.parse(fs.readFileSync(path.join(CONTENT, 'manifest.json'), 'utf8'));

for (const chapter of manifest.chapters) {
  if (chapter.ready === false) continue;
  for (const lang of ['zh', 'en']) {
    const file = path.join(CONTENT, `${chapter.id}.${lang}.md`);
    if (!fs.existsSync(file)) { fail(`${chapter.id}: 缺少 ${lang} 正文`); continue; }
    scanHtml(MD.render(fs.readFileSync(file, 'utf8')), `${chapter.id}.${lang}.md`);
  }

  const quizFile = path.join(CONTENT, `${chapter.id}.quiz.json`);
  if (!fs.existsSync(quizFile)) continue;
  const quiz = JSON.parse(fs.readFileSync(quizFile, 'utf8'));

  for (const question of quiz.open || []) {
    for (const ref of question.context || []) {
      checkRef(ref.path, ref.lineStart, ref.lineEnd, `${chapter.id}/${question.id}`);
    }
    if (!question.rubric?.length) fail(`${chapter.id}/${question.id}: 开放题缺 rubric，判卷会失准`);
  }
  for (const question of quiz.choice || []) {
    if (typeof question.answer !== 'number') fail(`${chapter.id}/${question.id}: 缺 answer`);
    for (const lang of ['zh', 'en']) {
      scanHtml(MD.render(question.explain?.[lang] || ''), `${chapter.id}/${question.id}.${lang}`);
    }
  }

  // 双语题面对称性
  for (const question of [...(quiz.choice || []), ...(quiz.open || [])]) {
    for (const [key, value] of Object.entries(question)) {
      const bilingual = value && typeof value === 'object' && !Array.isArray(value) && ('zh' in value || 'en' in value);
      if (!bilingual) continue;
      if (!value.zh || !value.en) fail(`${chapter.id}/${question.id}.${key}: 缺 ${value.zh ? 'en' : 'zh'}`);
      else if (key === 'options' && value.zh.length !== value.en.length) {
        fail(`${chapter.id}/${question.id}: 中英选项数不一致`);
      }
    }
  }
}

console.log(problems === 0
  ? `\n✓ 校验通过：${refs} 条源码引用全部有效\n`
  : `\n✗ 发现 ${problems} 个问题（共检查 ${refs} 条引用）\n`);
process.exit(problems === 0 ? 0 : 1);
