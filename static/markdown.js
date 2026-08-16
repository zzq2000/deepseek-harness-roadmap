/* 教程正文的 Markdown 渲染器，零依赖。
   在标准 Markdown 之上加了三种自定义语法，都是为了和右侧 IDE 联动：

     行内源码引用   {{src:vendor/cordis/src/fiber.ts#L418-L561|ctx.effect()}}
     块级源码卡片   ```srcref vendor/cordis/src/fiber.ts#L418-L561
                    卡片上的说明文字
                    ```
     可交互插图     ```figure 图注
                    <svg>…</svg>
                    ```
     提示框         :::note 标题 … :::   （类型：note / warn / key / lab）
*/

(function (global) {
  'use strict';

  const esc = (text) => text.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));

  /** 解析 `path#L12-L34` / `path#L12` / `path` 三种引用写法。 */
  function parseRef(raw) {
    const [path, hash] = String(raw || '').trim().split('#');
    let start = null;
    let end = null;
    if (hash) {
      const match = hash.match(/^L(\d+)(?:-L?(\d+))?$/);
      if (match) {
        start = parseInt(match[1], 10);
        end = match[2] ? parseInt(match[2], 10) : start;
      }
    }
    return { path, start, end };
  }

  function refAttrs(ref) {
    let attrs = ` data-path="${esc(ref.path)}"`;
    if (ref.start) attrs += ` data-start="${ref.start}" data-end="${ref.end}"`;
    return attrs;
  }

  function refLabel(ref) {
    return ref.start ? `${ref.path}:${ref.start}${ref.end !== ref.start ? '-' + ref.end : ''}` : ref.path;
  }

  // -------------------------------------------------------------- 行内

  function inline(text) {
    const stash = [];
    const keep = (html) => '\uE000' + (stash.push(html) - 1) + '\uE000';

    let out = esc(text);

    // 行内代码最先摘出来，免得里面的 ** 和 [] 被后面的规则误伤
    out = out.replace(/`([^`]+)`/g, (_, code) => keep(`<code>${code}</code>`));

    // 自定义源码引用
    out = out.replace(/\{\{src:([^|}]+)(?:\|([^}]*))?\}\}/g, (_, raw, label) => {
      const ref = parseRef(raw);
      const text = (label || refLabel(ref)).trim();
      return keep(`<span class="srclink"${refAttrs(ref)}>${text}</span>`);
    });

    out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) =>
      keep(`<a href="${href}" target="_blank" rel="noreferrer">${label}</a>`));
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');

    // \u5360\u4F4D\u7B26\u53EF\u4EE5\u5D4C\u5957\uFF1A{{src:path|`code`}} \u7684 label \u5148\u88AB\u884C\u5185\u4EE3\u7801\u89C4\u5219\u5B58\u4E86\u4E00\u5C42\uFF0C
    // \u6574\u4E2A srclink \u53C8\u88AB\u5B58\u4E86\u4E00\u5C42\u3002\u53CD\u590D\u5C55\u5F00\u76F4\u5230\u4E0D\u518D\u53D8\u5316\u3002
    let prev;
    do {
      prev = out;
      out = out.replace(/\uE000(\d+)\uE000/g, (_, i) => stash[+i]);
    } while (out !== prev);
    return out;
  }

  // -------------------------------------------------------------- 块级

  function renderTable(rows) {
    // 单元格里的 \| 是转义的字面管道符（源码引用 {{src:path|label}} 会用到），
    // 先藏成私用区字符再按真正的分隔符拆，最后还原。
    const cells = (row) => row
      .replace(/\\\|/g, '\uE001')
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((cell) => cell.trim().replace(/\uE001/g, '|'));
    const head = cells(rows[0]);
    const body = rows.slice(2).map(cells);
    let html = '<table><thead><tr>';
    for (const cell of head) html += `<th>${inline(cell)}</th>`;
    html += '</tr></thead><tbody>';
    for (const row of body) {
      html += '<tr>';
      for (let i = 0; i < head.length; i++) html += `<td>${inline(row[i] || '')}</td>`;
      html += '</tr>';
    }
    return html + '</tbody></table>';
  }

  const CALLOUT_LABEL = { note: '说明', warn: '注意', key: '关键', lab: '动手实验' };
  const CALLOUT_ICON = { note: '❖', warn: '▲', key: '✓', lab: '⌨' };

  function render(markdown) {
    const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
    let html = '';
    let i = 0;

    const flushParagraph = (buffer) => {
      if (buffer.length) html += `<p>${inline(buffer.join(' '))}</p>`;
      buffer.length = 0;
    };
    const paragraph = [];

    while (i < lines.length) {
      const line = lines[i];

      // --- 围栏代码块及其三种变体 ---
      const fence = line.match(/^```(\S*)\s*(.*)$/);
      if (fence) {
        const kind = fence[1];
        const rest = fence[2];
        const body = [];
        i++;
        while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++]);
        i++; // 吃掉收尾的 ```
        flushParagraph(paragraph);

        if (kind === 'srcref') {
          const ref = parseRef(rest);
          const note = body.join(' ').trim();
          html += `<div class="srcref"${refAttrs(ref)}>`
            + '<span class="srcref-icon">◧</span>'
            + '<span class="srcref-body">'
            + `<span class="srcref-path">${esc(refLabel(ref))}</span>`
            + (note ? `<span class="srcref-note">${inline(note)}</span>` : '')
            + '</span>'
            + '<span class="srcref-go">在右侧打开 →</span>'
            + '</div>';
        } else if (kind === 'figure') {
          html += `<figure class="figure">${body.join('\n')}`
            + (rest ? `<figcaption>${inline(rest)}</figcaption>` : '')
            + '</figure>';
        } else {
          const code = body.join('\n');
          html += `<pre><code class="lang-${esc(kind || 'text')}">${global.HL.highlight(code, kind)}</code></pre>`;
        }
        continue;
      }

      // --- 提示框 ---
      const callout = line.match(/^:::(note|warn|key|lab)\s*(.*)$/);
      if (callout) {
        const type = callout[1];
        const title = callout[2].trim() || CALLOUT_LABEL[type];
        const body = [];
        i++;
        while (i < lines.length && !/^:::\s*$/.test(lines[i])) body.push(lines[i++]);
        i++;
        flushParagraph(paragraph);
        html += `<div class="callout callout-${type}">`
          + `<div class="callout-title">${CALLOUT_ICON[type]} ${inline(title)}</div>`
          + render(body.join('\n'))
          + '</div>';
        continue;
      }

      // --- 标题 ---
      const heading = line.match(/^(#{1,4})\s+(.*)$/);
      if (heading) {
        flushParagraph(paragraph);
        const level = heading[1].length;
        const id = heading[2].trim().toLowerCase().replace(/[^\w一-龥]+/g, '-');
        html += `<h${level} id="h-${id}">${inline(heading[2])}</h${level}>`;
        i++;
        continue;
      }

      // --- 分隔线 ---
      if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
        flushParagraph(paragraph);
        html += '<hr>';
        i++;
        continue;
      }

      // --- 表格 ---
      if (/^\|.*\|\s*$/.test(line) && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
        flushParagraph(paragraph);
        const rows = [];
        while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) rows.push(lines[i++]);
        html += renderTable(rows);
        continue;
      }

      // --- 引用 ---
      if (/^>\s?/.test(line)) {
        flushParagraph(paragraph);
        const body = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ''));
        html += `<blockquote>${render(body.join('\n'))}</blockquote>`;
        continue;
      }

      // --- 列表（支持一层缩进嵌套）---
      if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
        flushParagraph(paragraph);
        const ordered = /^\s*\d+\./.test(line);
        html += ordered ? '<ol>' : '<ul>';
        // 两层各自记录「有没有未闭合的 li」：进入嵌套时外层 li 故意不闭合
        // （嵌套 ul 属于它），但同层相邻的项之间必须闭合。
        let openItem = false;
        let nested = false;
        let openNestedItem = false;
        while (i < lines.length && (/^\s*([-*+]|\d+\.)\s+/.test(lines[i]) || (openItem && /^\s{2,}\S/.test(lines[i])))) {
          const item = lines[i].match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
          if (item) {
            const deep = item[1].length >= 2;
            if (deep) {
              if (!nested) {
                html += '<ul>';
                nested = true;
              } else if (openNestedItem) {
                html += '</li>';
              }
              html += `<li>${inline(item[3])}`;
              openNestedItem = true;
            } else {
              if (nested) {
                html += (openNestedItem ? '</li>' : '') + '</ul>';
                nested = false;
                openNestedItem = false;
              }
              if (openItem) html += '</li>';
              html += `<li>${inline(item[3])}`;
              openItem = true;
            }
          } else {
            // 列表项的续行
            html += ' ' + inline(lines[i].trim());
          }
          i++;
        }
        if (nested) html += (openNestedItem ? '</li>' : '') + '</ul>';
        if (openItem) html += '</li>';
        html += ordered ? '</ol>' : '</ul>';
        continue;
      }

      // --- 空行 / 普通段落 ---
      if (!line.trim()) {
        flushParagraph(paragraph);
        i++;
        continue;
      }
      paragraph.push(line.trim());
      i++;
    }

    flushParagraph(paragraph);
    return html;
  }

  global.MD = { render, parseRef };
})(window);
