/* 轻量语法高亮 —— 零依赖，够用即可。
   TypeScript 走完整 tokenizer，其余语言走简化规则。
   类型名和函数名会带上 data-sym，供符号跳转使用。 */

(function (global) {
  'use strict';

  function esc(text) {
    return text.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
  }

  // 顺序即优先级：注释 → 字符串 → 数字 → 关键字 → 字面量 → 类型名 → 调用 → 装饰器
  const TS_RE = new RegExp([
    /(\/\*[\s\S]*?\*\/|\/\/[^\n]*)/,                                       // 1 注释
    /(`(?:\\[\s\S]|[^`\\])*`|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*")/,    // 2 字符串
    /\b(0[xXbBoO][\da-fA-F_]+n?|\d[\d_]*\.?[\d_]*(?:[eE][+-]?\d+)?n?)\b/,  // 3 数字
    /\b(abstract|any|as|asserts|async|await|break|case|catch|class|const|constructor|continue|declare|default|delete|do|else|enum|export|extends|finally|for|from|function|get|if|implements|import|in|infer|instanceof|interface|is|keyof|let|namespace|never|new|of|out|override|private|protected|public|readonly|return|satisfies|set|static|super|switch|this|throw|try|type|typeof|unique|unknown|var|void|while|with|yield)\b/, // 4 关键字
    /\b(true|false|null|undefined|NaN|Infinity|string|number|boolean|symbol|object|bigint)\b/, // 5 字面量/内置类型
    /\b([A-Z][\w$]*)\b/,                                                   // 6 类型名（大驼峰约定）
    /\b([a-z_$][\w$]*)(?=\s*[(<])/,                                        // 7 函数调用
    /(@[\w$]+)/,                                                           // 8 装饰器
  ].map((r) => r.source).join('|'), 'g');

  const CLASSES = ['c-com', 'c-str', 'c-num', 'c-kw', 'c-lit', 'c-type', 'c-fn', 'c-dec'];
  // 只有这两类值得做符号跳转；关键字和字符串跳了也没用。
  const JUMPABLE = new Set(['c-type', 'c-fn']);

  function highlightTS(code) {
    let out = '';
    let last = 0;
    let match;
    TS_RE.lastIndex = 0;
    while ((match = TS_RE.exec(code)) !== null) {
      // exec 在零宽匹配上会死循环，防一手
      if (match[0] === '') { TS_RE.lastIndex++; continue; }
      out += esc(code.slice(last, match.index));
      let cls = 'c-com';
      for (let i = 1; i <= 8; i++) {
        if (match[i] !== undefined) { cls = CLASSES[i - 1]; break; }
      }
      const text = esc(match[0]);
      out += JUMPABLE.has(cls)
        ? `<span class="${cls}" data-sym="${match[0]}">${text}</span>`
        : `<span class="${cls}">${text}</span>`;
      last = match.index + match[0].length;
    }
    return out + esc(code.slice(last));
  }

  const YAML_RE = /(#[^\n]*)|('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*")|^(\s*-?\s*[\w.$/@-]+)(?=\s*:)|\b(true|false|null|~)\b|\b(\d+\.?\d*)\b/gm;
  const YAML_CLASSES = ['c-com', 'c-str', 'c-key', 'c-lit', 'c-num'];

  function highlightYAML(code) {
    let out = '';
    let last = 0;
    let match;
    YAML_RE.lastIndex = 0;
    while ((match = YAML_RE.exec(code)) !== null) {
      if (match[0] === '') { YAML_RE.lastIndex++; continue; }
      out += esc(code.slice(last, match.index));
      let cls = 'c-com';
      for (let i = 1; i <= 5; i++) {
        if (match[i] !== undefined) { cls = YAML_CLASSES[i - 1]; break; }
      }
      out += `<span class="${cls}">${esc(match[0])}</span>`;
      last = match.index + match[0].length;
    }
    return out + esc(code.slice(last));
  }

  const JSON_RE = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+\.?\d*(?:[eE][+-]?\d+)?)/g;

  function highlightJSON(code) {
    let out = '';
    let last = 0;
    let match;
    JSON_RE.lastIndex = 0;
    while ((match = JSON_RE.exec(code)) !== null) {
      if (match[0] === '') { JSON_RE.lastIndex++; continue; }
      out += esc(code.slice(last, match.index));
      if (match[1] !== undefined) {
        // 后面跟冒号的字符串是键
        out += `<span class="${match[2] ? 'c-key' : 'c-str'}">${esc(match[1])}</span>` + (match[2] ? esc(match[2]) : '');
      } else if (match[3] !== undefined) {
        out += `<span class="c-lit">${esc(match[3])}</span>`;
      } else {
        out += `<span class="c-num">${esc(match[4])}</span>`;
      }
      last = match.index + match[0].length;
    }
    return out + esc(code.slice(last));
  }

  const SHELL_RE = /(#[^\n]*)|('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")|\b(cd|ls|npm|npx|pnpm|node|git|mkdir|cat|echo|export|python3?|curl|rm|cp|mv|sudo|brew|dsh)\b|(\s-{1,2}[\w-]+)/g;
  const SHELL_CLASSES = ['c-com', 'c-str', 'c-fn', 'c-num'];

  function highlightShell(code) {
    let out = '';
    let last = 0;
    let match;
    SHELL_RE.lastIndex = 0;
    while ((match = SHELL_RE.exec(code)) !== null) {
      if (match[0] === '') { SHELL_RE.lastIndex++; continue; }
      out += esc(code.slice(last, match.index));
      let cls = 'c-com';
      for (let i = 1; i <= 4; i++) {
        if (match[i] !== undefined) { cls = SHELL_CLASSES[i - 1]; break; }
      }
      out += `<span class="${cls}">${esc(match[0])}</span>`;
      last = match.index + match[0].length;
    }
    return out + esc(code.slice(last));
  }

  const BY_LANG = {
    ts: highlightTS, tsx: highlightTS, typescript: highlightTS,
    js: highlightTS, mjs: highlightTS, cjs: highlightTS, jsx: highlightTS, javascript: highlightTS,
    yaml: highlightYAML, yml: highlightYAML,
    json: highlightJSON,
    sh: highlightShell, bash: highlightShell, shell: highlightShell, console: highlightShell,
  };

  function langFromPath(path) {
    const ext = (path.split('.').pop() || '').toLowerCase();
    return BY_LANG[ext] ? ext : 'text';
  }

  function highlight(code, lang) {
    const fn = BY_LANG[(lang || '').toLowerCase()];
    return fn ? fn(code) : esc(code);
  }

  global.HL = { highlight, langFromPath, esc };
})(window);
