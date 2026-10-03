(() => {
  'use strict';

  const DATA = window.XINZHA;
  const ISSUES = DATA.issues.slice().sort((a, b) => b.no - a.no);
  const BY_NO = new Map(ISSUES.map((it) => [it.no, it]));
  const LATEST = ISSUES[0].no;
  const READER = DATA.reader;

  const CN = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const WEEK_SHORT = ['一', '二', '三', '四', '五', '六', '日'];
  const KW_HINT = '点一个词，信里写到它的地方会被铅笔圈出来。';
  const HINT = '草稿只保存在这台设备上';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const motionOK = () => !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const scrollBehavior = () => (motionOK() ? 'smooth' : 'auto');
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  const els = {
    letter: $('#letter'),
    review: $('#review'),
    archive: $('#archive'),
    toast: $('#toast'),
    next: $('#next-letter'),
  };

  /* ── 本机存储：已读、草稿、对话。读写失败时页面照常工作 ── */
  const KEY = 'xinzha.v1';
  const saved = (() => {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { s = {}; }
    return { read: s.read || {}, drafts: s.drafts || {}, threads: s.threads || {} };
  })();
  const persist = () => {
    try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (e) { /* 无痕窗口等情况下不保存 */ }
  };

  /* ── 日期与文字 ── */
  const parseDay = (s) => {
    const [y, m, d] = s.slice(0, 10).split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const addDays = (dt, n) => { const d = new Date(dt); d.setDate(d.getDate() + n); return d; };
  const md = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
  const mdDot = (d) => `${d.getMonth() + 1}.${d.getDate()}`;
  const pad = (n) => String(n).padStart(2, '0');
  const cnNum = (n) => (n <= 10 ? CN[n] : n < 20 ? `十${CN[n - 10]}` : `${CN[Math.floor(n / 10)]}十${n % 10 ? CN[n % 10] : ''}`);
  const stampLong = (s) => { const d = parseDay(s); return `${WEEK[d.getDay()]} ${md(d)} ${s.slice(11, 16)}`; };
  const stampShort = (s) => `${md(parseDay(s))} ${s.slice(11, 16)}`;
  const nowStamp = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const moodWord = (v) => (v < 2 ? '低落' : v < 2.7 ? '有点闷' : v < 3.4 ? '平稳' : v < 4.1 ? '轻松' : '舒展');
  const weekDays = (it) => {
    const start = parseDay(it.weekStart);
    return it.review.days.map((day, i) => ({ ...day, i, date: addDays(start, i) }));
  };
  const rangeText = (it) => {
    const s = parseDay(it.weekStart);
    return `${mdDot(s)} — ${mdDot(addDays(s, 6))}`;
  };
  const keepDates = (text) => text.replace(/(\d+) 月 (\d+) 日/g, '$1\u00a0月\u00a0$2\u00a0日');
  const threadOf = (it) => (it.thread || []).concat(saved.threads[it.no] || []);

  /* ── 状态 ── */
  let issue = null;
  let selectedDay = null;
  let activeWord = null;
  let busy = false;
  let chart = null;
  let chartObserver = null;
  let openTimer = 0;

  /* ── 信封线稿：开信时信封盖翻开、信纸上移 ── */
  const BUD = 'M0 0C-1.2-1.8-3.4-3.6-3.4-5.8C-3.4-7.4-1.4-8 0-6.3C1.4-8 3.4-7.4 3.4-5.8C3.4-3.6 1.2-1.8 0 0Z';
  const ENVELOPE = `
    <svg class="env" viewBox="0 0 120 100" aria-hidden="true" focusable="false">
      <g class="env-letter">
        <rect x="24" y="14" width="72" height="50"/>
        <path class="stroke" d="M24 14h72v50H24z" opacity=".55"/>
        <path class="stroke" d="M32 23h34M32 29h46M32 35h26" opacity=".7"/>
      </g>
      <g class="env-body">
        <rect x="6" y="34" width="108" height="62"/>
        <path class="stroke" d="M6 34h108v62H6z"/>
        <path class="rule" d="M1 39h118M1 91h118M11 29v71M109 29v71"/>
        <path class="stroke" d="M6 34L50 66M114 34L70 66"/>
        <path class="stroke" d="M80 96L60 77C49 66 45 58 50 53C54 49 60 52 60 58M40 96L60 77C71 66 75 58 70 53C66 49 60 52 60 58"/>
        <path class="stroke" d="M17 88C17 80 21 76 27 77C31 78 31 83 27 83M27 77C27 70 30 66 34 64"/>
        <path class="stroke" d="M103 88C103 80 99 76 93 77C89 78 89 83 93 83M93 77C93 70 90 66 86 64"/>
        <path class="bud" transform="translate(34 64) rotate(40) scale(.75)" d="${BUD}"/>
        <path class="bud" transform="translate(86 64) rotate(-40) scale(.75)" d="${BUD}"/>
      </g>
      <g class="env-flap">
        <path class="stroke" d="M6 34L60 6L114 34Z"/>
        <path class="rule" d="M17 34L60 11.5L103 34"/>
      </g>
    </svg>`;

  /* ═════════════ 信件 ═════════════ */
  function renderLetter(it) {
    const d = parseDay(it.date);
    let qn = 0;
    const paras = it.paragraphs.map((text, idx) => {
      const slips = [];
      const html = keepDates(text).replace(/\[\[(q\d+)\]\]/g, (_, key) => {
        const q = it.quotes[key];
        qn += 1;
        const id = `q-${it.no}-${qn}`;
        slips.push(
          `<div class="slip-wrap" id="${id}" inert><div class="slip-clip">` +
            `<figure class="slip"><figcaption class="slip__cap"><span>原话${CN[qn]}</span><span>${READER.name} · ${stampLong(q.at)}</span></figcaption>` +
            `<blockquote class="slip__text">${q.text}</blockquote></figure>` +
          '</div></div>'
        );
        return `<button type="button" class="quote-toggle" aria-expanded="false" aria-controls="${id}"><span class="quote-toggle__mark" aria-hidden="true"></span>原话${CN[qn]}</button>`;
      });
      return `<div class="para" id="p-${it.no}-${idx + 1}"><p>${html}</p>${slips.join('')}</div>`;
    }).join('');

    const chips = it.suggestions.map((s) => `<button type="button" class="chip" data-chip="${s}">${s}</button>`).join('');
    const isLatest = it.no === LATEST;

    els.letter.innerHTML = `
      <div class="sheet">
        <header class="letter-head">
          <div class="head-text">
            <p class="issue-no"><span>第</span><span class="issue-no__num">${it.no}</span><span>封</span>${isLatest ? '<span class="tag">最新</span>' : ''}</p>
            <p class="issue-date"><time datetime="${it.date}T${it.sentAt}"><span>${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日</span><span>${WEEK[d.getDay()]} ${it.sentAt} 寄出</span></time></p>
            <p class="issue-meta"><span>写给${READER.name}</span><span>回看 ${rangeText(it)}</span><span>${it.chats} 次对话</span></p>
            <a class="permalink" href="#no-${it.no}" data-permalink title="复制这封信的链接">
              <svg aria-hidden="true"><use href="#i-link"/></svg><span>定位链接</span><code>#no-${it.no}</code>
            </a>
          </div>
          <div class="envelope">${ENVELOPE}</div>
        </header>

        <h1 class="letter-title" id="letter-title">${it.title}</h1>

        <div class="letter-body" id="letter-body">
          <p class="salute">${READER.name}：</p>
          ${paras}
        </div>

        <div class="closing">
          <p class="closing__wish">${it.closing.wish[0]}</p>
          <p>${it.closing.wish[1]}</p>
          <p class="closing__sign">${it.closing.sign}</p>
          <p class="closing__date">${it.closing.signDate}</p>
        </div>

        <svg class="knot" aria-hidden="true"><use href="#knot"/></svg>

        <section class="ask" aria-labelledby="ask-q">
          <p class="ask__label">又及 · 这周想问你</p>
          <h2 class="ask__q" id="ask-q">${keepDates(it.question)}</h2>
          <ol class="thread" id="thread" aria-live="polite" aria-label="和信札的对话"></ol>
          <form class="reply" id="reply-form" novalidate>
            <div class="chips" role="group" aria-label="不知道怎么开头，可以从这里选一句">${chips}</div>
            <label class="sr-only" for="reply-input">写下你的回答</label>
            <textarea id="reply-input" name="reply" rows="3" maxlength="500" placeholder="写下第一句就好，不必完整。" aria-describedby="reply-hint"></textarea>
            <div class="reply__meta"><span class="reply__hint" id="reply-hint">${HINT}</span><span class="reply__count" id="reply-count">0 / 500</span></div>
            <div class="reply__actions">
              <button type="submit" class="btn-solid" id="reply-send">现在聊聊</button>
              <span class="reply__kbd">Ctrl / ⌘ + Enter 也能发送</span>
            </div>
          </form>
        </section>

        <svg class="sprig sprig--l" aria-hidden="true"><use href="#sprig"/></svg>
        <svg class="sprig sprig--r" aria-hidden="true"><use href="#sprig"/></svg>
      </div>`;

    const input = $('#reply-input');
    input.value = saved.drafts[it.no] || '';
    updateCount();
    renderThread(it);
  }

  function playOpening() {
    if (!motionOK()) return;
    clearTimeout(openTimer);
    els.letter.classList.remove('is-opening');
    void els.letter.offsetWidth; // 重新触发动画
    els.letter.classList.add('is-opening');
    openTimer = setTimeout(() => els.letter.classList.remove('is-opening'), 1300);
  }

  function toggleQuote(btn) {
    const open = btn.getAttribute('aria-expanded') !== 'true';
    const wrap = document.getElementById(btn.getAttribute('aria-controls'));
    btn.setAttribute('aria-expanded', String(open));
    wrap.classList.toggle('is-open', open);
    if (open) wrap.removeAttribute('inert');
    else wrap.setAttribute('inert', '');
  }

  function flashPara(idx) {
    const el = document.getElementById(`p-${issue.no}-${idx}`);
    if (!el) return;
    el.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
    el.classList.remove('is-flash');
    void el.offsetWidth;
    el.classList.add('is-flash');
  }

  /* ── 定位链接：写入地址栏并复制 ── */
  function legacyCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    return ok ? Promise.resolve() : Promise.reject(new Error('copy failed'));
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
    }
    return legacyCopy(text);
  }
  function setHash(no) {
    try { history.replaceState(null, '', `#no-${no}`); } catch (e) { /* 受限框架里地址栏不可写 */ }
  }
  function onPermalink() {
    const url = `${location.href.split('#')[0]}#no-${issue.no}`;
    setHash(issue.no);
    els.letter.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
    copyText(url)
      .then(() => toast(`已复制第 ${issue.no} 封的链接`))
      .catch(() => toast(`复制没有成功，可以手动复制：${url}`, 6000));
  }

  /* ═════════════ 回信与对话 ═════════════ */
  function msgNode(m) {
    const li = document.createElement('li');
    li.className = `msg msg--${m.from}`;
    const who = document.createElement('span');
    who.className = 'msg__who';
    who.textContent = `${m.from === 'you' ? READER.name : '信札'} · ${stampShort(m.at)}`;
    const p = document.createElement('p');
    p.className = 'msg__text';
    p.textContent = m.text;
    li.append(who, p);
    return li;
  }

  function renderThread(it) {
    const all = threadOf(it);
    $('#thread').replaceChildren(...all.map(msgNode));
    syncChips(all);
  }

  /* 对话开始后，开头建议就不再需要了 */
  function syncChips(all) {
    const chips = $('.chips', els.letter);
    if (chips) chips.hidden = all.some((m) => m.from === 'you');
  }

  function updateCount() {
    const input = $('#reply-input');
    const count = $('#reply-count');
    if (input && count) count.textContent = `${input.value.length} / 500`;
  }

  function setHint(text, warn) {
    const hint = $('#reply-hint');
    if (!hint) return;
    hint.textContent = text;
    hint.classList.toggle('is-warn', Boolean(warn));
  }

  function composeReply(it, text, nth) {
    if (nth === 1 && it.no === 38) {
      if (/外婆|衡阳|阁楼|桂花|回家|家里|妈/.test(text)) {
        return '那就先把这个画面留住：在外婆家的阁楼上醒来。票的事我们先放一放。说说看，醒来以后，你最想做的第一件事是什么？';
      }
      if (/宿舍|北京|睡|中午|青岛|室友|留/.test(text)) {
        return '在宿舍睡到自然醒，听起来是你很久没给过自己的东西。想留下来不需要理由。要不要一起想想，怎么让外婆不用一直等？';
      }
      if (/不知道|没想好|不确定|说不好|随便/.test(text)) {
        return '没想好也是一种回答。换个问法：10 月 2 日早上睁开眼，看到什么会让你松一口气？';
      }
    }
    const pool = [
      '我收到了。慢慢说，不着急。这件事里，哪一部分最让你放不下？',
      '嗯，我在听。刚才那句话，能再多说一点吗？',
      '谢谢你愿意写下来。今天就聊到你想停下的地方为止，我一直在。',
    ];
    return pool[(nth - 1) % pool.length];
  }

  function typeOut(el, text, done) {
    if (!motionOK()) { el.textContent = text; done(); return; }
    let i = 0;
    const step = () => {
      i = Math.min(text.length, i + 2);
      el.textContent = text.slice(0, i);
      if (i < text.length) setTimeout(step, 32);
      else done();
    };
    step();
  }

  function send(text) {
    const it = issue;
    const thread = $('#thread');
    const btn = $('#reply-send');
    const input = $('#reply-input');
    const mine = saved.threads[it.no] || (saved.threads[it.no] = []);

    const you = { from: 'you', at: nowStamp(), text };
    mine.push(you);
    delete saved.drafts[it.no];
    persist();
    thread.append(msgNode(you));
    syncChips(threadOf(it));
    input.value = '';
    updateCount();

    busy = true;
    btn.setAttribute('aria-busy', 'true');
    setHint('信札正在落笔…');

    const pending = document.createElement('li');
    pending.className = 'msg msg--xz msg--pending';
    pending.innerHTML = '<span class="msg__who">信札</span><p class="msg__text">正在落笔<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span></p>';
    thread.append(pending);

    const nth = mine.filter((m) => m.from === 'you').length;
    const replyText = composeReply(it, text, nth);

    setTimeout(() => {
      pending.remove();
      const xz = { from: 'xz', at: nowStamp(), text: replyText };
      const node = msgNode({ ...xz, text: '' });
      thread.append(node);
      typeOut(node.querySelector('.msg__text'), replyText, () => {
        mine.push(xz);
        persist();
        busy = false;
        btn.removeAttribute('aria-busy');
        if (issue === it) setHint('可以接着写，信札会一直回你');
        renderArchive();
      });
    }, motionOK() ? 1100 : 150);
  }

  function onSubmit(e) {
    e.preventDefault();
    const input = $('#reply-input');
    const text = input.value.trim();
    if (busy) { setHint('信札还在写上一句，稍等一下'); return; }
    if (!text) {
      setHint('先写一句吧，三个字也可以。', true);
      input.focus();
      return;
    }
    send(text);
  }

  /* ═════════════ 周回顾 ═════════════ */
  function renderReview(it) {
    const days = weekDays(it);
    const total = days.reduce((s, d) => s + d.msgs, 0);

    const dayItems = days.map((d) => `
      <li class="day" data-i="${d.i}">
        <button type="button" class="day__btn" aria-pressed="false" aria-controls="day-more-${d.i}">
          <span class="day__date"><b>${WEEK[d.date.getDay()]}</b>${md(d.date)}</span>
          <span class="day__topic">${d.topic}</span>
        </button>
        <div class="day__more" id="day-more-${d.i}" hidden>
          <span>${d.msgs} 条消息 · 情绪 ${d.mood.toFixed(1)} ${moodWord(d.mood)}</span>
          <a class="day__jump" href="#p-${it.no}-${d.para}" data-para="${d.para}">见信第${cnNum(d.para)}段<svg aria-hidden="true"><use href="#i-arrow"/></svg></a>
        </div>
      </li>`).join('');

    const rows = days.map((d) => `<tr><td>${WEEK[d.date.getDay()]} ${md(d.date)}</td><td>${d.topic}</td><td class="num">${d.mood.toFixed(1)}</td><td class="num">${d.msgs}</td></tr>`).join('');

    const kws = it.review.keywords.map((k) => `
      <button type="button" class="kw" aria-pressed="false" data-word="${k.word}">
        <span class="kw__word">${k.word}</span><span class="kw__count">${k.count} 次</span>
      </button>`).join('');

    els.review.innerHTML = `
      <header class="panel-head">
        <h2 class="panel-title" id="review-title">周回顾</h2>
        <p class="panel-sub">${rangeText(it)} · 第 ${it.no} 封</p>
      </header>
      <p class="review-summary">${it.review.summary}</p>

      <section class="block" aria-labelledby="topics-title">
        <div class="block-head"><h3 class="block-title" id="topics-title">七日话题</h3><span class="block-note">共 ${total} 条消息</span></div>
        <ol class="days">${dayItems}</ol>
      </section>

      <section class="block" aria-labelledby="mood-title">
        <div class="block-head">
          <h3 class="block-title" id="mood-title">情绪折线</h3>
          <button type="button" class="text-btn" data-table-toggle aria-expanded="false" aria-controls="mood-table">看表格</button>
        </div>
        <p class="block-note">按当天对话估计，1 为低落，5 为舒展</p>
        <div class="chart" id="mood-chart" tabindex="0" role="group" aria-roledescription="折线图"></div>
        <div class="chart-table" id="mood-table" hidden>
          <table>
            <thead><tr><th scope="col">日期</th><th scope="col">话题</th><th scope="col" class="num">情绪</th><th scope="col" class="num">消息</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </section>

      <section class="block" aria-labelledby="kw-title">
        <h3 class="block-title" id="kw-title">三个关键词</h3>
        <div class="keywords">${kws}</div>
        <p class="kw-detail" id="kw-detail" aria-live="polite">${KW_HINT}</p>
      </section>`;

    const box = $('#mood-chart');
    renderChart(box, it);
    if (chartObserver) chartObserver.disconnect();
    if ('ResizeObserver' in window) {
      let lastW = box.clientWidth;
      chartObserver = new ResizeObserver(() => {
        if (Math.abs(box.clientWidth - lastW) < 2) return;
        lastW = box.clientWidth;
        renderChart(box, it);
      });
      chartObserver.observe(box);
    }
  }

  /* 情绪折线：单序列，铅笔灰线 + 10% 面积，十字准线随指针吸附到最近一天 */
  function renderChart(box, it) {
    const days = weekDays(it);
    const W = Math.max(240, Math.round(box.clientWidth) || 300);
    const H = 176;
    const m = { l: 36, r: 18, t: 22, b: 28 };
    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;
    const step = iw / (days.length - 1);
    const x = (i) => m.l + step * i;
    const y = (v) => m.t + ((5 - v) * ih) / 4;
    const f = (n) => n.toFixed(1);

    const pts = days.map((d) => [x(d.i), y(d.mood)]);
    const linePath = pts.map((p, i) => `${i ? 'L' : 'M'}${f(p[0])} ${f(p[1])}`).join('');
    const areaPath = `${linePath}L${f(pts[pts.length - 1][0])} ${f(y(1))}L${f(pts[0][0])} ${f(y(1))}Z`;

    let minI = 0;
    days.forEach((d) => { if (d.mood < days[minI].mood) minI = d.i; });
    const lastI = days.length - 1;
    const labelled = minI === lastI ? [lastI] : [minI, lastI];

    const grid = [[5, '舒展'], [3, '平稳'], [1, '低落']].map(([v, t]) =>
      `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${f(y(v))}" y2="${f(y(v))}"/>` +
      `<text class="axis-y" x="${m.l - 8}" y="${f(y(v) + 4)}" text-anchor="end">${t}</text>`).join('');
    const xLabels = days.map((d) => `<text class="axis-x" data-i="${d.i}" x="${f(x(d.i))}" y="${H - 8}" text-anchor="middle">${WEEK_SHORT[d.i]}</text>`).join('');
    const vals = labelled.map((i) => {
      const py = y(days[i].mood);
      const below = py - m.t < 14;
      return `<text class="val" data-i="${i}" x="${f(x(i))}" y="${f(below ? py + 20 : py - 11)}" text-anchor="middle">${days[i].mood.toFixed(1)}</text>`;
    }).join('');
    const dots = days.map((d) => `<circle class="pt" data-i="${d.i}" cx="${f(x(d.i))}" cy="${f(y(d.mood))}" r="4"/>`).join('');

    box.setAttribute('aria-label', `情绪折线，${days.map((d) => `${WEEK[d.date.getDay()]} ${d.mood.toFixed(1)}`).join('，')}。用左右方向键逐日查看。`);
    box.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">
        ${grid}
        <path class="area" d="${areaPath}"/>
        <line class="cross" x1="0" x2="0" y1="${m.t - 6}" y2="${f(y(1))}" visibility="hidden"/>
        <path class="line" d="${linePath}"/>
        ${dots}
        ${vals}
        ${xLabels}
        <rect class="hit" x="${m.l - step / 2}" y="0" width="${iw + step}" height="${H}"/>
      </svg>
      <div class="tip" hidden></div>`;

    const svg = $('svg', box);
    const cross = $('.cross', box);
    const tip = $('.tip', box);

    const show = (i) => {
      $$('.pt', box).forEach((c) => {
        const on = Number(c.dataset.i) === i || Number(c.dataset.i) === selectedDay;
        c.classList.toggle('is-on', on);
        c.setAttribute('r', on ? '6' : '4');
      });
      $$('.axis-x', box).forEach((t) => t.classList.toggle('is-on', Number(t.dataset.i) === i));
      $$('.val', box).forEach((t) => t.setAttribute('visibility', Number(t.dataset.i) === i ? 'hidden' : 'visible'));
      if (i == null) {
        cross.setAttribute('visibility', 'hidden');
        tip.hidden = true;
        return;
      }
      const d = days[i];
      cross.setAttribute('x1', f(x(i)));
      cross.setAttribute('x2', f(x(i)));
      cross.setAttribute('visibility', 'visible');

      tip.replaceChildren();
      const top = document.createElement('div');
      const val = document.createElement('span');
      val.className = 'tip__val';
      val.textContent = d.mood.toFixed(1);
      const word = document.createElement('span');
      word.className = 'tip__word';
      word.textContent = moodWord(d.mood);
      top.append(val, word);
      const date = document.createElement('div');
      date.className = 'tip__date';
      date.textContent = `${WEEK[d.date.getDay()]} ${md(d.date)} · ${d.msgs} 条`;
      const topic = document.createElement('div');
      topic.className = 'tip__topic';
      topic.textContent = d.topic;
      tip.append(top, date, topic);
      tip.hidden = false;

      const scale = svg.getBoundingClientRect().width / W || 1;
      const px = x(i) * scale;
      const tw = tip.offsetWidth;
      const left = px + 12 + tw > box.clientWidth ? px - 12 - tw : px + 12;
      tip.style.left = `${clamp(left, 0, Math.max(0, box.clientWidth - tw))}px`;
      const py = y(d.mood) * scale;
      tip.style.top = `${py > H * scale * 0.5 ? 0 : Math.round(H * scale * 0.42)}px`;
    };

    const idxAt = (clientX) => {
      const r = svg.getBoundingClientRect();
      const px = ((clientX - r.left) * W) / r.width;
      return clamp(Math.round((px - m.l) / step), 0, days.length - 1);
    };

    svg.addEventListener('pointermove', (e) => show(idxAt(e.clientX)));
    svg.addEventListener('pointerleave', () => show(selectedDay));
    svg.addEventListener('click', (e) => selectDay(idxAt(e.clientX)));
    box.addEventListener('keydown', (e) => {
      const last = days.length - 1;
      const cur = selectedDay == null ? -1 : selectedDay;
      let next = null;
      if (e.key === 'ArrowRight') next = cur < 0 ? 0 : Math.min(last, cur + 1);
      else if (e.key === 'ArrowLeft') next = cur < 0 ? last : Math.max(0, cur - 1);
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = last;
      else if (e.key === 'Escape') { e.preventDefault(); selectDay(null); return; }
      else return;
      e.preventDefault();
      selectDay(next);
    });

    chart = { show };
    show(selectedDay);
  }

  function selectDay(i) {
    selectedDay = i;
    $$('.day', els.review).forEach((li) => {
      const on = Number(li.dataset.i) === i;
      $('.day__btn', li).setAttribute('aria-pressed', String(on));
      $('.day__more', li).hidden = !on;
    });
    if (chart) chart.show(i);
  }

  /* ── 关键词：在信里用铅笔圈出 ── */
  function clearMarks() {
    $$('mark.kw-hit', els.letter).forEach((mk) => {
      const parent = mk.parentNode;
      mk.replaceWith(mk.textContent);
      parent.normalize();
    });
  }

  function markWord(word) {
    let n = 0;
    $$('.para > p', els.letter).forEach((p) => {
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => (node.parentElement.closest('button') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
      });
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach((node) => {
        const parts = node.nodeValue.split(word);
        if (parts.length < 2) return;
        const frag = document.createDocumentFragment();
        parts.forEach((part, idx) => {
          if (idx) {
            const mk = document.createElement('mark');
            mk.className = 'kw-hit';
            mk.textContent = word;
            frag.append(mk);
            n += 1;
          }
          if (part) frag.append(part);
        });
        node.replaceWith(frag);
      });
    });
    return n;
  }

  function toggleWord(word) {
    activeWord = activeWord === word ? null : word;
    clearMarks();
    $$('.kw', els.review).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.word === activeWord)));
    const detail = $('#kw-detail');
    if (!activeWord) { detail.textContent = KW_HINT; return; }
    const k = issue.review.keywords.find((kw) => kw.word === activeWord);
    const n = markWord(activeWord);
    detail.innerHTML =
      `「<strong>${k.word}</strong>」这周在对话里出现了 ${k.count} 次，${k.note}。` +
      (n ? `信里写到 ${n} 处，已用铅笔圈出。<button type="button" class="text-btn" data-kw-jump>定位到第一处</button>`
         : '这封信里没有直接写到它。');
  }

  /* ═════════════ 往期 ═════════════ */
  function renderArchive() {
    const groups = new Map();
    ISSUES.forEach((it) => {
      const d = parseDay(it.date);
      const key = `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(it);
    });

    const item = (it) => {
      const d = parseDay(it.date);
      const current = issue && it.no === issue.no;
      const flags = [];
      if (it.no === LATEST) flags.push('<span class="arc__flag">最新</span>');
      if (it.unread && !saved.read[it.no]) flags.push('<span class="arc__flag arc__flag--unread">未读</span>');
      if (threadOf(it).some((msg) => msg.from === 'you')) flags.push('<span class="arc__flag">已回信</span>');
      if (current) flags.push('<span class="arc__flag arc__flag--reading">正在读</span>');
      const excerpt = it.paragraphs[0].replace(/\[\[q\d+\]\]/g, '');
      return `
        <li>
          <a class="arc" href="#no-${it.no}" data-no="${it.no}"${current ? ' aria-current="page"' : ''}>
            <span class="arc__top"><span class="arc__no">No.${it.no}</span><span>${mdDot(d)} ${WEEK[d.getDay()]}</span>${flags.join('')}</span>
            <span class="arc__title">${it.title}</span>
            <span class="arc__excerpt">${excerpt}</span>
          </a>
        </li>`;
    };

    const unread = ISSUES.filter((it) => it.unread && !saved.read[it.no]).length;
    els.archive.innerHTML = `
      <header class="panel-head">
        <h2 class="panel-title" id="archive-title">往期来信</h2>
        <p class="panel-sub">共 ${ISSUES.length} 封${unread ? ` · ${unread} 封未读` : ''}</p>
      </header>
      ${Array.from(groups, ([month, list]) => `
        <section class="archive-group" aria-label="${month}">
          <h3 class="archive-month">${month}</h3>
          <ul class="archive-list">${list.map(item).join('')}</ul>
        </section>`).join('')}`;
  }

  /* ═════════════ 打开一封信 ═════════════ */
  function openIssue(no, opts = {}) {
    const it = BY_NO.get(no) || BY_NO.get(LATEST);
    issue = it;
    selectedDay = null;
    activeWord = null;
    saved.read[it.no] = true;
    persist();

    renderLetter(it);
    renderReview(it);
    renderArchive();
    document.title = it.no === LATEST ? '信札' : `信札 · 第 ${it.no} 封`;

    if (opts.updateHash) setHash(it.no);
    if (opts.animate) playOpening();
    if (opts.scroll) els.letter.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
  }

  /* ── 提示条 ── */
  let toastTimer = 0;
  function toast(msg, ms = 2600) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.hidden = true; }, ms);
  }

  /* ═════════════ 事件 ═════════════ */
  function bind() {
    els.letter.addEventListener('click', (e) => {
      const q = e.target.closest('.quote-toggle');
      if (q) { toggleQuote(q); return; }
      if (e.target.closest('[data-permalink]')) { e.preventDefault(); onPermalink(); return; }
      const chip = e.target.closest('.chip');
      if (chip) {
        const input = $('#reply-input');
        input.value = chip.dataset.chip;
        saved.drafts[issue.no] = input.value;
        persist();
        updateCount();
        setHint(HINT);
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
    });

    els.letter.addEventListener('submit', onSubmit);

    els.letter.addEventListener('input', (e) => {
      if (e.target.id !== 'reply-input') return;
      saved.drafts[issue.no] = e.target.value;
      persist();
      updateCount();
      if (!busy) setHint(HINT);
    });

    els.letter.addEventListener('keydown', (e) => {
      if (e.target.id === 'reply-input' && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        $('#reply-form').requestSubmit();
      }
    });

    els.review.addEventListener('click', (e) => {
      const dayBtn = e.target.closest('.day__btn');
      if (dayBtn) {
        const i = Number(dayBtn.closest('.day').dataset.i);
        selectDay(selectedDay === i ? null : i);
        return;
      }
      const jump = e.target.closest('.day__jump');
      if (jump) { e.preventDefault(); flashPara(Number(jump.dataset.para)); return; }
      const kw = e.target.closest('.kw');
      if (kw) { toggleWord(kw.dataset.word); return; }
      if (e.target.closest('[data-kw-jump]')) {
        const first = $('mark.kw-hit', els.letter);
        if (first) first.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
        return;
      }
      const tableBtn = e.target.closest('[data-table-toggle]');
      if (tableBtn) {
        const table = $('#mood-table');
        const open = table.hidden;
        table.hidden = !open;
        tableBtn.setAttribute('aria-expanded', String(open));
        tableBtn.textContent = open ? '收起表格' : '看表格';
      }
    });

    els.archive.addEventListener('click', (e) => {
      const a = e.target.closest('.arc');
      if (!a) return;
      e.preventDefault();
      const no = Number(a.dataset.no);
      if (no === issue.no) {
        els.letter.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
        return;
      }
      const letterTop = els.letter.getBoundingClientRect().top;
      openIssue(no, { updateHash: true, animate: true, scroll: letterTop < 0 || letterTop > window.innerHeight * 0.5 });
    });

    document.addEventListener('click', (e) => {
      const link = e.target.closest('[data-jump]');
      if (!link) return;
      const target = document.querySelector(link.getAttribute('href'));
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
    });

    window.addEventListener('hashchange', () => {
      const no = noFromHash();
      if (no && BY_NO.has(no) && no !== issue.no) openIssue(no, { animate: true, scroll: true });
    });
  }

  function watchSections() {
    const links = $$('.jump a');
    if (!links.length || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        links.forEach((a) => a.setAttribute('aria-current', String(a.getAttribute('href') === `#${en.target.id}`)));
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    ['letter', 'review', 'archive'].forEach((id) => io.observe(document.getElementById(id)));
  }

  function noFromHash() {
    const match = /^#no-(\d+)$/.exec(location.hash);
    return match ? Number(match[1]) : null;
  }

  /* ── 启动 ── */
  const next = parseDay(DATA.nextLetter);
  els.next.textContent = `下一封 ${mdDot(next)} ${WEEK[next.getDay()]} 21:00`;
  bind();
  watchSections();
  const fromHash = noFromHash();
  openIssue(fromHash && BY_NO.has(fromHash) ? fromHash : LATEST, { animate: true });
})();
