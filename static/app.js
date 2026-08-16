/* DeepSeek Harness 源码精读：主逻辑
   左侧教程与右侧 IDE 的联动全部经由 openSource()：
   教程里的任何源码引用都带 data-path / data-start / data-end，点击即定位。 */

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const api = async (path, options) => {
    const response = await fetch(path, options);
    return response.json();
  };

  const state = {
    lang: localStorage.getItem('dsh.lang') || 'zh',
    theme: localStorage.getItem('dsh.theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
    manifest: { chapters: [] },
    chapterId: null,
    progress: { chapters: {}, answers: {} },
    openFile: null,
    fileCache: new Map(),
  };

  const I18N = {
    zh: {
      brand: '源码精读 Roadmap', tocTitle: '课程目录', quizTitle: '检验：你真的读懂了吗',
      tabTree: '文件树', tabCode: '源码', tabSearch: '搜索',
      searchPlaceholder: '搜索全仓源码…',
      codeEmpty: '点击教程里的源码引用，或从文件树打开一个文件。',
      submit: '提交批改', judging: '批改中…', rejudge: '重新提交',
      answerHint: '用自己的话写，越具体越好。判卷会带上本题的源码上下文。',
      contextLabel: '本题涉及的源码：',
      markRead: '标记本章已读', marked: '本章已读',
      next: '下一章 →', prev: '← 上一章',
      statusTodo: '未开始', statusDoing: '进行中', statusDone: '已完成',
      choiceRight: '答对了', choiceWrong: '答错了',
      footChoice: '选择题', footOpen: '问答题', footAvg: '平均分',
      resetConfirm: '确定要清空全部学习进度吗？此操作不可撤销。',
      choiceLabel: '选', openLabel: '问',
      vPoints: '逐点批改', vCorrections: '说错的地方', vMissed: '漏掉的关键点', vRef: '参考答案',
      judgeFail: '批改失败', judgeHint: 'DeepSeek 正在对照源码批改，通常 20-60 秒',
      footEmpty: '完成本章的题目来记录进度', footUnit: '题',
      loading: '载入中…', openFail: '打不开', emptyAnswer: '先写点什么再提交',
      searching: '搜索中…', hitsUnit: '处命中', saveFail: '进度保存失败（服务未响应）',
      symFinding: '查找定义', symNone: '没有找到定义', symDefs: '处定义',
      notReady: '尚未编写', notReadyBody: '这一章的内容还在写。已完成的章节见左侧目录。',
      chapterWord: '第 %s 章',
    },
    en: {
      brand: 'Source Reading Roadmap', tocTitle: 'Curriculum', quizTitle: 'Check: did you really get it?',
      tabTree: 'Files', tabCode: 'Source', tabSearch: 'Search',
      searchPlaceholder: 'Search the repository…',
      codeEmpty: 'Click a source reference in the lesson, or open a file from the tree.',
      submit: 'Submit for grading', judging: 'Grading…', rejudge: 'Resubmit',
      answerHint: 'Answer in your own words. Grading includes this question\'s source context.',
      contextLabel: 'Source for this question:',
      markRead: 'Mark chapter as read', marked: 'Chapter read',
      next: 'Next chapter →', prev: '← Previous',
      statusTodo: 'Not started', statusDoing: 'In progress', statusDone: 'Done',
      choiceRight: 'Correct', choiceWrong: 'Incorrect',
      footChoice: 'Multiple choice', footOpen: 'Open questions', footAvg: 'Average',
      resetConfirm: 'Clear all learning progress? This cannot be undone.',
      choiceLabel: 'MC', openLabel: 'Q',
      vPoints: 'Point by point', vCorrections: 'What you got wrong', vMissed: 'What you missed', vRef: 'Reference answer',
      judgeFail: 'Grading failed', judgeHint: 'DeepSeek is grading against the source, usually 20-60s',
      footEmpty: 'Answer this chapter\'s questions to record progress', footUnit: 'answered',
      loading: 'Loading…', openFail: 'Cannot open', emptyAnswer: 'Write something first',
      searching: 'Searching…', hitsUnit: 'hits', saveFail: 'Failed to save progress (server not responding)',
      symFinding: 'Finding definition', symNone: 'No definition found', symDefs: 'definitions',
      notReady: 'Not written yet', notReadyBody: 'This chapter is still being written. See the sidebar for finished chapters.',
      chapterWord: 'Chapter %s',
    },
  };
  const t = (key) => (I18N[state.lang] || I18N.zh)[key] || key;

  function toast(message, ms = 2600) {
    const el = $('toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { el.hidden = true; }, ms);
  }

  // ============================================================ IDE

  function switchIdeView(view) {
    for (const tab of document.querySelectorAll('.ide-tab')) {
      tab.classList.toggle('is-active', tab.dataset.view === view);
    }
    for (const pane of document.querySelectorAll('.ide-view')) {
      pane.classList.toggle('is-active', pane.id === 'view' + view[0].toUpperCase() + view.slice(1));
    }
  }

  async function fetchFile(path) {
    if (state.fileCache.has(path)) return state.fileCache.get(path);
    const data = await api('/api/file?path=' + encodeURIComponent(path));
    if (!data.error) state.fileCache.set(path, data);
    return data;
  }

  /** 教程与 IDE 之间唯一的联动入口。 */
  async function openSource(path, start, end) {
    switchIdeView('code');
    $('idePath').textContent = path;
    const view = $('viewCode');
    view.innerHTML = '<div class="loading-block" style="padding-left:20px">'
      + '<span class="spinner"></span> ' + path + '</div>';

    const data = await fetchFile(path);
    if (data.error) {
      view.innerHTML = `<div class="code-empty">${t('openFail')} <code>${path}</code><br>${data.error}</div>`;
      return;
    }

    state.openFile = path;
    const lang = window.HL.langFromPath(path);
    const lines = data.content.split('\n');
    const from = start ? parseInt(start, 10) : 0;
    const to = end ? parseInt(end, 10) : from;

    // 整文件一次性高亮，再按行切分：跨行的块注释和模板字符串才不会被截断。
    const highlighted = window.HL.highlight(data.content, lang).split('\n');

    let html = '<div class="code-wrap">';
    for (let i = 0; i < lines.length; i++) {
      const no = i + 1;
      const inRange = from && no >= from && no <= to;
      const classes = ['code-line'];
      if (inRange) {
        classes.push('is-hl');
        if (no === from) classes.push('is-hl-first');
        if (no === to) classes.push('is-hl-last');
      }
      html += `<div class="${classes.join(' ')}" id="L${no}">`
        + `<span class="code-no">${no}</span>`
        + `<span class="code-src">${highlighted[i] || ''}</span></div>`;
    }
    view.innerHTML = html + '</div>';

    if (from) {
      const target = document.getElementById('L' + from);
      if (target) {
        // 把高亮区间顶到视窗上三分之一处，比 scrollIntoView 的居中更好读
        view.scrollTop = Math.max(0, target.offsetTop - view.clientHeight / 3);
      }
    }
    markOpenInTree(path);
  }

  // ---- 文件树 ----

  function fileIcon(name) {
    if (/\.tsx?$/.test(name)) return 'TS';
    if (/\.(js|mjs|cjs)$/.test(name)) return 'JS';
    if (/\.json$/.test(name)) return '{}';
    if (/\.(ya?ml)$/.test(name)) return 'Y';
    if (/\.md$/.test(name)) return 'M';
    return '·';
  }

  async function loadTreeInto(container, path) {
    const data = await api('/api/tree?path=' + encodeURIComponent(path || ''));
    container.innerHTML = '';
    for (const entry of data.entries || []) {
      const li = document.createElement('li');
      li.className = entry.type === 'dir' ? 'tree-dir' : 'tree-file';
      li.dataset.path = entry.path;

      const row = document.createElement('div');
      row.className = 'tree-row';
      row.innerHTML = entry.type === 'dir'
        ? '<span class="tree-caret">▶</span><span class="tree-icon">▸</span>'
          + `<span class="tree-name">${entry.name}</span>`
        : '<span class="tree-caret"></span>'
          + `<span class="tree-icon">${fileIcon(entry.name)}</span>`
          + `<span class="tree-name">${entry.name}</span>`;
      li.appendChild(row);

      if (entry.type === 'dir') {
        const nested = document.createElement('ul');
        nested.hidden = true;
        li.appendChild(nested);
        row.addEventListener('click', async () => {
          const caret = row.querySelector('.tree-caret');
          if (nested.hidden) {
            if (!nested.dataset.loaded) {
              nested.innerHTML = '<li class="tree-row" style="color:var(--fg-faint)">…</li>';
              await loadTreeInto(nested, entry.path);
              nested.dataset.loaded = '1';
            }
            nested.hidden = false;
            caret.classList.add('is-open');
          } else {
            nested.hidden = true;
            caret.classList.remove('is-open');
          }
        });
      } else {
        row.addEventListener('click', () => openSource(entry.path));
      }
      container.appendChild(li);
    }
  }

  function markOpenInTree(path) {
    for (const row of document.querySelectorAll('.tree-row.is-open-file')) {
      row.classList.remove('is-open-file');
    }
    const li = document.querySelector(`.tree-file[data-path="${CSS.escape(path)}"] > .tree-row`);
    if (li) li.classList.add('is-open-file');
  }

  // ---- 搜索 ----

  let searchTimer = null;
  async function runSearch() {
    const query = $('searchInput').value.trim();
    if (!query) return;
    switchIdeView('search');
    $('searchMeta').textContent = t('searching');
    $('searchHits').innerHTML = '';

    const isRegex = $('searchRegex').checked;
    const data = await api(`/api/search?q=${encodeURIComponent(query)}&regex=${isRegex ? 1 : 0}`);
    const hits = data.hits || [];
    $('searchMeta').textContent = `${hits.length} ${t('hitsUnit')} · ${data.engine} · ${data.ms}ms`;

    const list = $('searchHits');
    for (const hit of hits) {
      if (hit.error) { $('searchMeta').textContent = hit.error; continue; }
      const li = document.createElement('li');
      li.className = 'search-hit';
      const text = window.HL.esc(hit.text);
      const marked = isRegex ? text : text.split(window.HL.esc(query)).join(`<mark>${window.HL.esc(query)}</mark>`);
      li.innerHTML = `<div class="search-hit-path">${hit.path}:${hit.line}</div>`
        + `<div class="search-hit-line">${marked}</div>`;
      li.addEventListener('click', () => openSource(hit.path, hit.line, hit.line));
      list.appendChild(li);
    }
  }

  // ---- 符号跳转 ----

  async function showSymbol(name, x, y) {
    const pop = $('symbolPop');
    pop.innerHTML = `<div class="symbol-pop-head">${t('symFinding')}: ${name}…</div>`;
    pop.hidden = false;
    pop.style.left = Math.min(x, innerWidth - 480) + 'px';
    pop.style.top = Math.min(y + 14, innerHeight - 340) + 'px';

    const data = await api('/api/symbol?name=' + encodeURIComponent(name));
    if (!data.hits || !data.hits.length) {
      pop.innerHTML = `<div class="symbol-pop-head">${t('symNone')}: <b>${name}</b></div>`;
      return;
    }
    let html = `<div class="symbol-pop-head">${name} · ${data.total} ${t('symDefs')}</div>`;
    for (const hit of data.hits) {
      html += `<div class="symbol-hit" data-path="${hit.path}" data-line="${hit.line}">`
        + `<div class="symbol-hit-path"><span class="symbol-kind">${hit.kind}</span>${hit.path}:${hit.line}</div>`
        + `<div class="symbol-hit-text">${window.HL.esc(hit.text)}</div></div>`;
    }
    pop.innerHTML = html;
    for (const el of pop.querySelectorAll('.symbol-hit')) {
      el.addEventListener('click', () => {
        pop.hidden = true;
        openSource(el.dataset.path, el.dataset.line, el.dataset.line);
      });
    }
  }

  // ============================================================ 教程

  function chapterById(id) {
    return state.manifest.chapters.find((chapter) => chapter.id === id);
  }

  function chapterState(id) {
    const record = state.progress.chapters[id];
    if (!record) return 'todo';
    return record.done ? 'done' : 'doing';
  }

  function renderToc() {
    const list = $('toc');
    list.innerHTML = '';
    let stage = null;
    for (const chapter of state.manifest.chapters) {
      const chapterStage = chapter.stage?.[state.lang] || chapter.stage?.zh;
      if (chapterStage !== stage) {
        stage = chapterStage;
        const header = document.createElement('li');
        header.className = 'toc-stage';
        header.textContent = stage;
        list.appendChild(header);
      }
      const item = document.createElement('li');
      const status = chapterState(chapter.id);
      item.className = 'toc-item' + (chapter.id === state.chapterId ? ' is-active' : '');
      item.dataset.state = status;
      const badge = status === 'done' ? '✓' : chapter.no;
      item.innerHTML = `<span class="toc-badge">${badge}</span>`
        + `<span class="toc-name">${chapter.title?.[state.lang] || chapter.title?.zh || chapter.id}`
        + (chapter.ready === false ? '<span class="toc-sub">编写中</span>' : '')
        + '</span>';
      item.addEventListener('click', () => loadChapter(chapter.id));
      list.appendChild(item);
    }
    renderGlobalProgress();
  }

  function renderGlobalProgress() {
    const chapters = state.manifest.chapters.filter((chapter) => chapter.ready !== false);
    const done = chapters.filter((chapter) => chapterState(chapter.id) === 'done').length;
    $('globalBar').style.width = chapters.length ? (done / chapters.length * 100) + '%' : '0';
    $('globalLabel').textContent = `${done} / ${chapters.length}`;
  }

  /** 给渲染出来的教程正文接上源码联动。 */
  function wireSourceLinks(root) {
    for (const el of root.querySelectorAll('[data-path]')) {
      el.addEventListener('click', (event) => {
        event.preventDefault();
        openSource(el.dataset.path, el.dataset.start, el.dataset.end);
      });
    }
  }

  async function loadChapter(id, skipHash) {
    state.chapterId = id;
    if (!skipHash) location.hash = id;

    const chapter = chapterById(id);
    const lesson = $('lesson');
    lesson.innerHTML = `<div class="loading-block"><span class="spinner"></span> ${t('loading')}</div>`;
    $('quiz').hidden = true;
    $('lessonFoot').innerHTML = '';
    renderToc();

    const data = await api(`/api/chapter?id=${encodeURIComponent(id)}&lang=${state.lang}`);
    if (data.error) {
      lesson.innerHTML = `<h1>${chapter?.title?.[state.lang] || id}</h1>`
        + `<div class="callout callout-warn"><div class="callout-title">▲ ${t('notReady')}</div>`
        + `<p>${t('notReadyBody')}</p></div>`;
      $('lessonPane').scrollTop = 0;
      return;
    }

    const kicker = `<div class="chapter-kicker">${chapter?.stage?.[state.lang] || ''} · ${t('chapterWord').replace('%s', chapter?.no)}</div>`;
    lesson.innerHTML = kicker + window.MD.render(data.markdown)
      + (data.fallback ? '<div class="callout callout-warn"><div class="callout-title">▲ Fallback</div>'
        + '<p>English version not written yet. Showing the Chinese text.</p></div>' : '');
    wireSourceLinks(lesson);
    $('lessonPane').scrollTop = 0;

    // 首次打开即记为进行中
    if (!state.progress.chapters[id]) {
      state.progress.chapters[id] = { started: true, read: false, done: false };
      saveProgress({ chapters: { [id]: state.progress.chapters[id] } });
      renderToc();
    }

    await loadQuiz(id);
    renderFoot(id);
  }

  // ============================================================ 题目

  function answerKey(chapterId, questionId) {
    return `${chapterId}/${questionId}`;
  }

  async function loadQuiz(chapterId) {
    const quiz = await api(`/api/quiz?id=${encodeURIComponent(chapterId)}&lang=${state.lang}`);
    const hasQuestions = (quiz.choice?.length || 0) + (quiz.open?.length || 0) > 0;
    $('quiz').hidden = !hasQuestions;
    if (!hasQuestions) return;

    $('quiz').querySelector('.quiz-title').textContent = t('quizTitle');
    renderChoiceQuestions(chapterId, quiz.choice || []);
    renderOpenQuestions(chapterId, quiz.open || []);
  }

  function renderChoiceQuestions(chapterId, questions) {
    const container = $('quizChoice');
    container.innerHTML = '';
    questions.forEach((question, index) => {
      const saved = state.progress.answers[answerKey(chapterId, question.id)];
      const card = document.createElement('div');
      card.className = 'q-card';
      card.innerHTML = `<div class="q-head"><span class="q-index">${t('choiceLabel')} ${index + 1}</span>`
        + `<span class="q-prompt">${window.MD.render(question.prompt).replace(/^<p>|<\/p>$/g, '')}</span></div>`;

      const list = document.createElement('ul');
      list.className = 'q-options';
      question.options.forEach((option, optionIndex) => {
        const li = document.createElement('li');
        li.className = 'q-option';
        li.innerHTML = `<span class="q-key">${'ABCD'[optionIndex]}</span><span>${window.MD.render(option).replace(/^<p>|<\/p>$/g, '')}</span>`;
        li.addEventListener('click', () => {
          if (li.closest('.q-card').dataset.locked) return;
          pickChoice(chapterId, question, card, optionIndex);
        });
        list.appendChild(li);
      });
      card.appendChild(list);
      container.appendChild(card);

      if (saved && saved.picked !== undefined) {
        pickChoice(chapterId, question, card, saved.picked, true);
      }
    });
  }

  function pickChoice(chapterId, question, card, picked, restoring) {
    card.dataset.locked = '1';
    const options = card.querySelectorAll('.q-option');
    options.forEach((option, index) => {
      option.classList.add('is-locked');
      if (index === question.answer) option.classList.add('is-right');
      else if (index === picked) option.classList.add('is-wrong');
    });

    const right = picked === question.answer;
    const existing = card.querySelector('.q-explain');
    if (existing) existing.remove();
    const explain = document.createElement('div');
    explain.className = 'q-explain ' + (right ? 'is-right' : 'is-wrong');
    explain.innerHTML = `<div class="q-explain-title">${right ? '✓ ' + t('choiceRight') : '✗ ' + t('choiceWrong')}</div>`
      + window.MD.render(question.explain || '');
    card.appendChild(explain);
    wireSourceLinks(explain);

    if (!restoring) {
      state.progress.answers[answerKey(chapterId, question.id)] = { type: 'choice', picked, right };
      saveProgress({ answers: { [answerKey(chapterId, question.id)]: { type: 'choice', picked, right } } });
      renderFoot(chapterId);
    }
  }

  function renderOpenQuestions(chapterId, questions) {
    const container = $('quizOpen');
    container.innerHTML = '';
    questions.forEach((question, index) => {
      const key = answerKey(chapterId, question.id);
      const saved = state.progress.answers[key];

      const card = document.createElement('div');
      card.className = 'q-card';
      card.innerHTML = `<div class="q-head"><span class="q-index">${t('openLabel')} ${index + 1}</span>`
        + `<span class="q-prompt">${window.MD.render(question.prompt).replace(/^<p>|<\/p>$/g, '')}</span></div>`;

      if (question.context?.length) {
        const links = document.createElement('div');
        links.className = 'q-context-links';
        links.innerHTML = `<span class="q-hint">${t('contextLabel')}</span>`;
        for (const ref of question.context) {
          const span = document.createElement('span');
          span.className = 'srclink';
          span.dataset.path = ref.path;
          if (ref.lineStart) { span.dataset.start = ref.lineStart; span.dataset.end = ref.lineEnd || ref.lineStart; }
          span.textContent = ref.path.split('/').pop() + (ref.lineStart ? `:${ref.lineStart}` : '');
          links.appendChild(span);
        }
        card.appendChild(links);
        wireSourceLinks(links);
      }

      const textarea = document.createElement('textarea');
      textarea.className = 'q-answer';
      textarea.placeholder = t('answerHint');
      textarea.value = saved?.answer || '';
      card.appendChild(textarea);

      const actions = document.createElement('div');
      actions.className = 'q-actions';
      const button = document.createElement('button');
      button.className = 'btn-primary';
      button.textContent = saved?.verdict ? t('rejudge') : t('submit');
      const hint = document.createElement('span');
      hint.className = 'q-hint';
      actions.append(button, hint);
      card.appendChild(actions);

      const verdictBox = document.createElement('div');
      card.appendChild(verdictBox);
      if (saved?.verdict) renderVerdict(verdictBox, saved.verdict);

      button.addEventListener('click', async () => {
        const answer = textarea.value.trim();
        if (!answer) { toast(t('emptyAnswer')); return; }
        button.disabled = true;
        button.textContent = t('judging');
        hint.innerHTML = `<span class="spinner"></span> ${t('judgeHint')}`;
        verdictBox.innerHTML = '';

        const result = await api('/api/judge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chapterId, questionId: question.id, answer }),
        });

        button.disabled = false;
        button.textContent = t('rejudge');
        hint.textContent = '';

        if (result.error) {
          verdictBox.innerHTML = '<div class="q-explain is-wrong">'
            + `<div class="q-explain-title">${t('judgeFail')}</div><div>${window.HL.esc(result.error)}</div></div>`;
          return;
        }
        renderVerdict(verdictBox, result);
        const record = { type: 'open', answer, verdict: result };
        state.progress.answers[key] = record;
        saveProgress({ answers: { [key]: record } });
        renderFoot(chapterId);
      });

      container.appendChild(card);
    });
  }

  function renderVerdict(container, verdict) {
    const kind = verdict.verdict || (verdict.score >= 85 ? 'correct' : verdict.score >= 55 ? 'partial' : 'incorrect');
    let html = `<div class="verdict verdict-${kind}">`
      + '<div class="verdict-head">'
      + `<span class="verdict-score">${verdict.score ?? '—'}</span>`
      + `<span class="verdict-summary">${window.HL.esc(verdict.summary || '')}</span>`
      + '</div><div class="verdict-body">';

    if (verdict.points?.length) {
      html += `<div class="verdict-section"><div class="verdict-label">${t('vPoints')}</div>`;
      for (const point of verdict.points) {
        html += `<div class="verdict-point ${point.got ? 'got' : 'miss'}">`
          + `<span class="verdict-mark">${point.got ? '✓' : '✗'}</span>`
          + `<span class="verdict-point-text">${window.HL.esc(point.point || '')}`
          + (point.comment ? `<div class="verdict-point-comment">${window.HL.esc(point.comment)}</div>` : '')
          + '</span></div>';
      }
      html += '</div>';
    }
    if (verdict.corrections?.length) {
      html += `<div class="verdict-section"><div class="verdict-label">${t('vCorrections')}</div><ul>`
        + verdict.corrections.map((item) => `<li>${window.HL.esc(item)}</li>`).join('')
        + '</ul></div>';
    }
    if (verdict.missed?.length) {
      html += `<div class="verdict-section"><div class="verdict-label">${t('vMissed')}</div><ul>`
        + verdict.missed.map((item) => `<li>${window.HL.esc(item)}</li>`).join('')
        + '</ul></div>';
    }
    if (verdict.reference) {
      html += `<div class="verdict-section"><div class="verdict-label">${t('vRef')}</div>`
        + `<div class="verdict-ref">${window.MD.render(verdict.reference)}</div></div>`;
    }
    if (verdict.usage) {
      html += `<div class="verdict-usage">tokens: ${verdict.usage.total_tokens ?? '?'}</div>`;
    }
    container.innerHTML = html + '</div></div>';
    wireSourceLinks(container);
  }

  // ============================================================ 章节完成状态

  function chapterStats(chapterId) {
    const entries = Object.entries(state.progress.answers)
      .filter(([key]) => key.startsWith(chapterId + '/'))
      .map(([, value]) => value);
    const choice = entries.filter((entry) => entry.type === 'choice');
    const open = entries.filter((entry) => entry.type === 'open' && entry.verdict);
    const scores = open.map((entry) => entry.verdict.score || 0);
    return {
      choiceRight: choice.filter((entry) => entry.right).length,
      choiceTotal: choice.length,
      openDone: open.length,
      avg: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
    };
  }

  function renderFoot(chapterId) {
    const record = state.progress.chapters[chapterId] || {};
    const stats = chapterStats(chapterId);
    const chapters = state.manifest.chapters;
    const index = chapters.findIndex((chapter) => chapter.id === chapterId);

    const bits = [];
    if (stats.choiceTotal) bits.push(`${t('footChoice')} <b>${stats.choiceRight}/${stats.choiceTotal}</b>`);
    if (stats.openDone) bits.push(`${t('footOpen')} <b>${stats.openDone}</b> ${t('footUnit')} · ${t('footAvg')} <b>${stats.avg}</b>`);

    const foot = $('lessonFoot');
    foot.innerHTML = '<div class="foot-bar">'
      + `<span class="foot-status">${bits.join(' · ') || t('footEmpty')}</span>`
      + `<button class="btn-next" id="markRead">${record.read ? '✓ ' + t('marked') : t('markRead')}</button>`
      + (index < chapters.length - 1 ? `<button class="btn-next" id="nextChapter">${t('next')}</button>` : '')
      + '</div>';

    $('markRead').addEventListener('click', () => {
      const next = { ...record, read: !record.read };
      next.done = next.read && (stats.choiceTotal === 0 || stats.choiceRight === stats.choiceTotal)
        && (stats.openDone === 0 || (stats.avg ?? 0) >= 70);
      state.progress.chapters[chapterId] = next;
      saveProgress({ chapters: { [chapterId]: next } });
      renderToc();
      renderFoot(chapterId);
    });
    const nextButton = $('nextChapter');
    if (nextButton) nextButton.addEventListener('click', () => loadChapter(chapters[index + 1].id));

    // 题目状态变化后，已读章节的完成判定要跟着更新
    if (record.read) {
      const done = (stats.choiceTotal === 0 || stats.choiceRight === stats.choiceTotal)
        && (stats.openDone === 0 || (stats.avg ?? 0) >= 70);
      if (done !== record.done) {
        state.progress.chapters[chapterId] = { ...record, done };
        saveProgress({ chapters: { [chapterId]: { ...record, done } } });
        renderToc();
      }
    }
  }

  async function saveProgress(patch) {
    try {
      await api('/api/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
    } catch {
      toast(t('saveFail'));
    }
  }

  // ============================================================ 外壳

  function applyTheme() {
    document.documentElement.dataset.theme = state.theme;
    localStorage.setItem('dsh.theme', state.theme);
  }

  function applyLang() {
    localStorage.setItem('dsh.lang', state.lang);
    document.documentElement.lang = state.lang;
    for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
    for (const el of document.querySelectorAll('[data-i18n-ph]')) el.placeholder = t(el.dataset.i18nPh);
    for (const button of document.querySelectorAll('.lang-btn')) {
      button.classList.toggle('is-active', button.dataset.lang === state.lang);
    }
  }

  function initSplitters() {
    for (const splitter of document.querySelectorAll('.splitter')) {
      splitter.addEventListener('mousedown', (event) => {
        event.preventDefault();
        const target = $(splitter.dataset.target);
        const startX = event.clientX;
        const startWidth = target.getBoundingClientRect().width;
        const isLessonSplit = splitter.dataset.target === 'lessonPane';
        splitter.classList.add('is-dragging');

        const onMove = (moveEvent) => {
          const delta = moveEvent.clientX - startX;
          if (isLessonSplit) {
            // 教程栏是 flex:1，拖动它实际调整的是右侧 IDE 的宽度
            const ide = $('idePane');
            const width = Math.min(Math.max(innerWidth - moveEvent.clientX, 280), innerWidth - 480);
            ide.style.width = width + 'px';
          } else {
            target.style.width = Math.min(Math.max(startWidth + delta, 150), 480) + 'px';
          }
        };
        const onUp = () => {
          splitter.classList.remove('is-dragging');
          removeEventListener('mousemove', onMove);
          removeEventListener('mouseup', onUp);
        };
        addEventListener('mousemove', onMove);
        addEventListener('mouseup', onUp);
      });
    }
  }

  function initEvents() {
    for (const tab of document.querySelectorAll('.ide-tab')) {
      tab.addEventListener('click', () => switchIdeView(tab.dataset.view));
    }
    for (const button of document.querySelectorAll('.lang-btn')) {
      button.addEventListener('click', () => {
        if (state.lang === button.dataset.lang) return;
        state.lang = button.dataset.lang;
        applyLang();
        renderToc();
        if (state.chapterId) loadChapter(state.chapterId, true);
      });
    }
    $('themeToggle').addEventListener('click', () => {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      applyTheme();
    });
    $('searchInput').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { clearTimeout(searchTimer); runSearch(); }
    });
    $('searchInput').addEventListener('input', () => {
      clearTimeout(searchTimer);
      if ($('searchInput').value.trim().length >= 3) searchTimer = setTimeout(runSearch, 500);
    });
    $('resetProgress').addEventListener('click', async () => {
      if (!confirm(t('resetConfirm'))) return;
      state.progress = { chapters: {}, answers: {} };
      await saveProgress({ reset: true });
      renderToc();
      if (state.chapterId) loadChapter(state.chapterId, true);
    });

    // 代码里的类型名/函数名点一下查定义
    $('viewCode').addEventListener('click', (event) => {
      const symbol = event.target.dataset?.sym;
      if (symbol && symbol.length > 2) showSymbol(symbol, event.clientX, event.clientY);
    });
    document.addEventListener('click', (event) => {
      if (!event.target.closest('.symbol-pop') && !event.target.dataset?.sym) $('symbolPop').hidden = true;
    });
    addEventListener('hashchange', () => {
      const id = location.hash.slice(1);
      if (id && id !== state.chapterId) loadChapter(id, true);
    });
    addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'f') {
        event.preventDefault();
        $('searchInput').focus();
        $('searchInput').select();
      }
      if (event.key === 'Escape') $('symbolPop').hidden = true;
    });
  }

  async function boot() {
    applyTheme();
    applyLang();
    initSplitters();
    initEvents();

    state.manifest = await api('/api/manifest');
    state.progress = await api('/api/progress');
    if (!state.progress.chapters) state.progress.chapters = {};
    if (!state.progress.answers) state.progress.answers = {};

    renderToc();
    loadTreeInto($('tree'), '');

    const fromHash = location.hash.slice(1);
    const first = state.manifest.chapters.find((chapter) => chapter.ready !== false);
    loadChapter(fromHash && chapterById(fromHash) ? fromHash : (first?.id || state.manifest.chapters[0]?.id));
  }

  boot();
})();
