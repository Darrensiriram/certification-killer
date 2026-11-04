/* Certification Killer: vanilla JS oefenapp. Leest bank/index.json en bank/<id>/questions.json. */
(function () {
  "use strict";

  const app = document.getElementById("app");
  const nav = document.getElementById("nav");
  const STORE_PREFIX = "certification-killer:v1:";
  const state = { certs: [], cert: null, bank: null, timer: null };

  /* ---------- helpers ---------- */

  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "onclick") node.addEventListener("click", v);
      else if (k === "onchange") node.addEventListener("change", v);
      else if (k === "oninput") node.addEventListener("input", v);
      else if (k === "disabled") node.disabled = !!v;
      else if (k === "checked") node.checked = !!v;
      else if (k === "value") node.value = v;
      else node.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children.flat()) {
      if (c === undefined || c === null || c === false) continue;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function sameSet(a, b) {
    if (a.length !== b.length) return false;
    const sa = new Set(a);
    return b.every((x) => sa.has(x));
  }

  function fmtTime(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    const p = (n) => String(n).padStart(2, "0");
    return h ? `${h}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
  }

  /* ---------- storage (per certificate, per browser) ---------- */

  function emptyProgress() {
    return { results: {}, marked: [], exams: [] };
  }

  function loadProgress() {
    try {
      const raw = localStorage.getItem(STORE_PREFIX + state.cert.id);
      return raw ? Object.assign(emptyProgress(), JSON.parse(raw)) : emptyProgress();
    } catch (e) {
      return emptyProgress();
    }
  }

  function saveProgress(p) {
    try {
      localStorage.setItem(STORE_PREFIX + state.cert.id, JSON.stringify(p));
    } catch (e) {
      /* opslag niet beschikbaar (privévenster): de app blijft werken */
    }
  }

  function recordResult(qid, ok) {
    const p = loadProgress();
    p.results[qid] = { ok: !!ok, at: Date.now() };
    saveProgress(p);
  }

  function toggleMark(qid) {
    const p = loadProgress();
    const i = p.marked.indexOf(qid);
    if (i >= 0) p.marked.splice(i, 1);
    else p.marked.push(qid);
    saveProgress(p);
    return i < 0;
  }

  /* ---------- data ---------- */

  async function fetchJSON(url) {
    const r = await fetch(url, { cache: "no-cache" });
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    return r.json();
  }

  async function selectCert(id) {
    const cert = state.certs.find((c) => c.id === id) || state.certs[0];
    if (!cert) return;
    state.cert = cert;
    try { localStorage.setItem("certification-killer:cert", cert.id); } catch (e) { /* geen opslag */ }
    state.bank = await fetchJSON(`bank/${cert.id}/questions.json`);
    state.bank.questions.forEach((q) => (q.__cert = cert.id));
    nav.replaceChildren();
    nav.append(
      el("button", { class: "nav-btn ghost", onclick: () => home() }, "Start"),
      el("button", { class: "nav-btn ghost", onclick: () => progressView() }, "Voortgang")
    );
    document.title = `${cert.name} · Certification Killer`;
    home();
  }

  function topicList() {
    const map = new Map();
    for (const q of state.bank.questions) {
      map.set(q.topic, (map.get(q.topic) || 0) + 1);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }

  function byId(id) {
    return state.bank.questions.find((q) => q.id === id);
  }

  /* ---------- views ---------- */

  function home() {
    clearTimer();
    app.replaceChildren();
    if (!state.certs.length) {
      app.append(el("div", { class: "card" }, el("h2", {}, "Geen oefenbank gevonden"),
        el("p", { class: "muted" }, "Voeg een bank toe met tools/import_exam.py. Zie README.md.")));
      return;
    }
    const p = loadProgress();
    const total = state.bank.questions.length;
    const answered = Object.keys(p.results).length;

    const certSelect = state.certs.length > 1
      ? el("label", { class: "field" }, "Certificaat",
          el("select", { onchange: (e) => selectCert(e.target.value) },
            state.certs.map((c) => el("option", { value: c.id, selected: c.id === state.cert.id }, `${c.name} (${c.count})`))))
      : null;

    app.append(
      el("div", { class: "card" },
        el("h2", {}, state.cert.name),
        el("p", { class: "muted" }, `${total} vragen · ${answered} beantwoord`),
        certSelect),
      el("div", { class: "card menu" },
        el("button", { class: "primary", onclick: () => practiceSetup() }, "Oefenen per onderwerp of filter"),
        el("button", { onclick: () => examSetup() }, "Examenmodus (op tijd)"),
        el("button", { onclick: () => progressView() }, "Voortgang en examengeschiedenis")
      )
    );
  }

  /* ----- practice ----- */

  function practiceSetup() {
    clearTimer();
    app.replaceChildren();
    const topics = topicList();
    const topicSel = el("select", { id: "topic" },
      el("option", { value: "all" }, `Alle onderwerpen (${state.bank.questions.length})`),
      topics.map(([t, n]) => el("option", { value: t }, `Onderwerp ${t} (${n})`)));
    const filterSel = el("select", { id: "filter" },
      el("option", { value: "all" }, "Alle vragen"),
      el("option", { value: "new" }, "Nog niet beantwoord"),
      el("option", { value: "wrong" }, "Fout beantwoord"),
      el("option", { value: "marked" }, "Gemarkeerd"));
    const shuf = el("input", { type: "checkbox", id: "shuffle", checked: true });

    app.append(el("div", { class: "card" },
      el("h2", {}, "Oefenen"),
      el("div", { class: "row" },
        el("label", { class: "field grow" }, "Onderwerp", topicSel),
        el("label", { class: "field grow" }, "Filter", filterSel)),
      el("p", {}, el("label", { class: "row" }, shuf, " Willekeurige volgorde")),
      el("div", { class: "row" },
        el("button", { class: "primary", onclick: () => startPractice(topicSel.value, filterSel.value, shuf.checked) }, "Start"),
        el("button", { class: "ghost", onclick: () => home() }, "Terug"))));
  }

  function startPractice(topic, filter, shuffleOn) {
    const p = loadProgress();
    let qs = state.bank.questions.filter((q) => topic === "all" || String(q.topic) === topic);
    if (filter === "new") qs = qs.filter((q) => !p.results[q.id]);
    if (filter === "wrong") qs = qs.filter((q) => p.results[q.id] && !p.results[q.id].ok);
    if (filter === "marked") qs = qs.filter((q) => p.marked.includes(q.id));
    if (!qs.length) {
      alert("Geen vragen voor deze combinatie.");
      return;
    }
    const ids = (shuffleOn ? shuffle(qs) : qs).map((q) => q.id);
    practice({ type: "practice", ids, pos: 0, answers: {} });
  }

  function practice(s) {
    clearTimer();
    app.replaceChildren();
    const q = byId(s.ids[s.pos]);
    const ans = s.answers[q.id] || (s.answers[q.id] = { sel: [], checked: false, revealed: false });
    const p = loadProgress();
    const marked = p.marked.includes(q.id);

    const header = el("div", { class: "row" },
      el("span", { class: "muted grow" }, `Vraag ${s.pos + 1} van ${s.ids.length}`),
      el("button", { class: "nav-btn ghost", onclick: () => { toggleMark(q.id); practice(s); } },
        marked ? "★ Gemarkeerd" : "☆ Markeer"));

    const footer = el("div", { class: "sticky-bottom" },
      el("div", { class: "row" },
        el("button", { disabled: s.pos === 0, onclick: () => { s.pos--; practice(s); window.scrollTo(0, 0); } }, "← Vorige"),
        el("button", { class: "ghost", onclick: () => home() }, "Stoppen"),
        el("button", { class: "primary", disabled: s.pos >= s.ids.length - 1,
          onclick: () => { s.pos++; practice(s); window.scrollTo(0, 0); } }, "Volgende →")));

    app.append(el("div", { class: "card" }, header, renderQuestion(q, ans, { mode: "practice" }, () => practice(s))), footer);
  }

  /* ----- exam ----- */

  function examSetup() {
    clearTimer();
    app.replaceChildren();
    const total = state.bank.questions.length;
    const count = el("input", { type: "number", id: "count", min: 1, max: total, value: Math.min(50, total) });
    const minutes = el("input", { type: "number", id: "minutes", min: 1, value: 100 });
    count.addEventListener("input", () => { minutes.value = Math.max(1, Math.round(Number(count.value) * 2)); });
    app.append(el("div", { class: "card" },
      el("h2", {}, "Examenmodus"),
      el("p", { class: "muted" }, "Willekeurige vragen uit de hele bank. Antwoorden worden pas aan het eind nagekeken."),
      el("div", { class: "row" },
        el("label", { class: "field" }, "Aantal vragen", count),
        el("label", { class: "field" }, "Tijd (minuten)", minutes)),
      el("div", { class: "row", style: "margin-top:14px" },
        el("button", { class: "primary", onclick: () => startExam(Number(count.value), Number(minutes.value)) }, "Start examen"),
        el("button", { class: "ghost", onclick: () => home() }, "Terug"))));
  }

  function startExam(count, minutes) {
    const total = state.bank.questions.length;
    const n = Math.max(1, Math.min(count || 1, total));
    const ids = shuffle(state.bank.questions.map((q) => q.id)).slice(0, n);
    const s = { type: "exam", ids, pos: 0, answers: {}, endsAt: Date.now() + Math.max(1, minutes) * 60000, startedAt: Date.now() };
    examView(s);
    state.timer = setInterval(() => {
      const left = s.endsAt - Date.now();
      const t = document.getElementById("timer");
      if (t) t.textContent = fmtTime(left);
      if (left <= 0) finishExam(s, true);
    }, 1000);
  }

  function examView(s) {
    app.replaceChildren();
    const q = byId(s.ids[s.pos]);
    const ans = s.answers[q.id] || (s.answers[q.id] = { sel: [], checked: false, revealed: false });
    const p = loadProgress();
    const marked = s.marked && s.marked.includes(q.id);
    const doneCount = Object.values(s.answers).filter((a) => a.sel.length).length;

    const grid = el("div", { class: "qnums" }, s.ids.map((id, i) => {
      const a = s.answers[id];
      const cls = [i === s.pos ? "current" : "", a && a.sel.length ? "done" : "", s.marked && s.marked.includes(id) ? "marked" : ""].join(" ");
      return el("button", { class: cls.trim(), onclick: () => { s.pos = i; examView(s); window.scrollTo(0, 0); } }, String(i + 1));
    }));

    app.append(
      el("div", { class: "card" },
        el("div", { class: "row" },
          el("span", { class: "muted grow" }, `Vraag ${s.pos + 1} van ${s.ids.length} · ${doneCount} beantwoord`),
          el("span", { id: "timer", class: "timer" }, fmtTime(s.endsAt - Date.now()))),
        el("div", { class: "row", style: "margin-top:8px" },
          el("button", { class: "nav-btn ghost", onclick: () => {
            s.marked = s.marked || [];
            const i = s.marked.indexOf(q.id);
            if (i >= 0) s.marked.splice(i, 1); else s.marked.push(q.id);
            examView(s);
          } }, marked ? "★ Gemarkeerd" : "☆ Markeer om later te bekijken")),
        el("hr", { style: "border:0;border-top:1px solid var(--line);margin:12px 0" }),
        renderQuestion(q, ans, { mode: "exam" }, () => examView(s))),
      el("div", { class: "card" }, grid),
      el("div", { class: "sticky-bottom" },
        el("div", { class: "row" },
          el("button", { disabled: s.pos === 0, onclick: () => { s.pos--; examView(s); window.scrollTo(0, 0); } }, "← Vorige"),
          el("button", { class: "danger", onclick: () => {
            if (confirm("Examen inleveren? Niet beantwoorde vragen tellen als fout.")) finishExam(s, false);
          } }, "Inleveren"),
          el("button", { class: "primary", disabled: s.pos >= s.ids.length - 1,
            onclick: () => { s.pos++; examView(s); window.scrollTo(0, 0); } }, "Volgende →"))));
  }

  function clearTimer() {
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = null;
    }
  }

  function finishExam(s, timeUp) {
    clearTimer();
    const review = { ...s, finished: true, timeUp, finishedAt: Date.now() };
    examResult(review);
  }

  function examResult(s) {
    app.replaceChildren();
    // Score: auto-graded answers count directly; self-graded ones are scored in the review below.
    const rows = s.ids.map((id) => byId(id));
    const selfNeeded = rows.filter((q) => !q.options.length);
    const decided = {};
    rows.forEach((q) => {
      const a = s.answers[q.id];
      if (q.options.length) decided[q.id] = !!(a && sameSet(a.sel, q.correct));
    });
    const scored = () => {
      const ids = Object.keys(decided);
      const ok = ids.filter((k) => decided[k]).length;
      return { ok, total: rows.length, pct: Math.round((ok / rows.length) * 100) };
    };
    const sc = scored();

    const topicStats = {};
    rows.forEach((q) => {
      const t = topicStats[q.topic] || (topicStats[q.topic] = { n: 0, ok: 0 });
      t.n++;
    });

    const scoreCard = el("div", { class: "card" },
      el("h2", {}, s.timeUp ? "Tijd is op" : "Examen afgerond"),
      el("div", { class: "bigscore", id: "score" }, `${sc.pct}%`),
      el("p", { class: "muted", id: "scoreText" }, `${sc.ok} van ${sc.total} goed (automatisch nagekeken). ${selfNeeded.length ? selfNeeded.length + " vragen met afbeeldingsantwoord beoordeel je zelf hieronder." : ""}`),
      el("div", { class: "row" },
        el("button", { class: "primary", onclick: () => saveExamAndHome() }, "Opslaan en terug naar start"),
        el("button", { class: "ghost", onclick: () => home() }, "Terug zonder opslaan")));

    const review = el("div", { class: "card" }, el("h3", {}, "Nakijken"));
    rows.forEach((q, i) => {
      const a = s.answers[q.id] || { sel: [] };
      const block = el("div", { style: "border-top:1px solid var(--line);padding-top:12px;margin-top:12px" },
        el("div", { class: "qmeta" }, el("span", {}, `Vraag ${i + 1} · onderwerp ${q.topic}`),
          el("span", { class: "pill" }, q.type)),
        renderQuestion(q, a, { mode: "review" }, null),
        q.options.length
          ? el("p", { class: "muted" }, `Jouw antwoord: ${a.sel.join(", ") || "geen"} · juist: ${q.correct.join(", ")}`)
          : selfGradeRow(q, s, () => examResult(s)));
      review.append(block);
    });

    app.append(scoreCard, review);

    function selfGradeRow(q, sess, rerender) {
      const cur = sess.selfGrades && sess.selfGrades[q.id];
      const ok = el("button", { class: cur === true ? "primary" : "", onclick: () => { sess.selfGrades = sess.selfGrades || {}; sess.selfGrades[q.id] = true; decided[q.id] = true; rerender(); } }, "Had ik goed");
      const bad = el("button", { class: cur === false ? "primary" : "", onclick: () => { sess.selfGrades = sess.selfGrades || {}; sess.selfGrades[q.id] = false; decided[q.id] = false; rerender(); } }, "Had ik fout");
      return el("div", { class: "row" }, el("span", { class: "muted" }, "Beoordeel zelf:"), ok, bad);
    }

    function saveExamAndHome() {
      const finalDecided = {};
      rows.forEach((q) => {
        const a = s.answers[q.id];
        if (q.options.length) finalDecided[q.id] = !!(a && sameSet(a.sel, q.correct));
        else if (s.selfGrades && s.selfGrades[q.id] !== undefined) finalDecided[q.id] = s.selfGrades[q.id];
      });
      const okCount = rows.filter((q) => finalDecided[q.id] === true).length;
      const p = loadProgress();
      rows.forEach((q) => { if (finalDecided[q.id] !== undefined) p.results[q.id] = { ok: finalDecided[q.id], at: Date.now() }; });
      p.exams.push({ at: Date.now(), total: rows.length, ok: okCount, timeUp: !!s.timeUp, ids: s.ids });
      saveProgress(p);
      home();
    }
  }

  /* ----- progress ----- */

  function progressView() {
    clearTimer();
    app.replaceChildren();
    const p = loadProgress();
    const topics = topicList();
    const rows = topics.map(([t, n]) => {
      const qs = state.bank.questions.filter((q) => q.topic === t);
      const answered = qs.filter((q) => p.results[q.id]);
      const ok = answered.filter((q) => p.results[q.id].ok).length;
      const pct = answered.length ? Math.round((ok / answered.length) * 100) : null;
      return { t, n, answered: answered.length, ok, pct };
    });
    const allAnswered = rows.reduce((a, r) => a + r.answered, 0);
    const allOk = rows.reduce((a, r) => a + r.ok, 0);

    const table = el("table", {},
      el("tr", {}, el("th", {}, "Onderwerp"), el("th", {}, "Beantwoord"), el("th", {}, "Goed")),
      rows.map((r) => el("tr", {},
        el("td", {}, `Onderwerp ${r.t}`),
        el("td", {}, `${r.answered}/${r.n}`),
        el("td", {}, r.pct === null ? "—" : `${r.pct}%`))));

    const exams = el("div", {}, p.exams.length
      ? el("table", {}, el("tr", {}, el("th", {}, "Datum"), el("th", {}, "Score"), el("th", {}, "Tijd")),
          p.exams.slice().reverse().map((e) => el("tr", {},
            el("td", {}, new Date(e.at).toLocaleString("nl-NL")),
            el("td", {}, `${Math.round((e.ok / e.total) * 100)}% (${e.ok}/${e.total})`),
            el("td", {}, e.timeUp ? "Tijd op" : "Ingeleverd"))))
      : el("p", { class: "muted" }, "Nog geen examens afgerond."));

    app.append(
      el("div", { class: "card" },
        el("h2", {}, "Voortgang"),
        el("p", {}, `Beantwoord: ${allAnswered}/${state.bank.questions.length} · goed: ${allAnswered ? Math.round((allOk / allAnswered) * 100) : 0}%`),
        el("div", { class: "bar" }, el("span", { style: `width:${Math.round((allAnswered / state.bank.questions.length) * 100)}%` })),
        el("p", { class: "muted" }, "Gegevens staan alleen in deze browser en op dit apparaat.")),
      el("div", { class: "card" }, el("h3", {}, "Per onderwerp"), table),
      el("div", { class: "card" }, el("h3", {}, "Examens"), exams),
      el("div", { class: "row" },
        el("button", { class: "danger", onclick: () => {
          if (confirm("Alle voortgang voor dit certificaat wissen?")) { saveProgress(emptyProgress()); progressView(); }
        } }, "Voortgang wissen"),
        el("button", { class: "ghost", onclick: () => home() }, "Terug")));
  }

  /* ---------- question rendering (shared by practice, exam and review) ---------- */

  function renderQuestion(q, ans, opts, rerender) {
    const wrap = el("div", {});
    const lettersMode = q.options.length > 0;
    const needed = q.correct.length || 1;
    const multi = lettersMode && q.correct.length > 1;

    wrap.append(el("div", { class: "qmeta" },
      el("span", {}, `Onderwerp ${q.topic}`),
      el("span", { class: "pill" }, multi ? `kies ${needed}` : (lettersMode ? "één antwoord" : "zelf beoordelen"))));

    if (q.type === "hotspot" || q.type === "drag_drop" || q.type === "answer_area") {
      wrap.append(el("p", { class: "muted" }, q.type === "drag_drop" ? "Sleep-en-zet-vraag" : "Hotspot-vraag"));
    }
    wrap.append(formatQuestion(q.question));
    (q.images || []).forEach((src) => wrap.append(el("img", { class: "qimg", src: `bank/${q.__cert}/${src}`, loading: "lazy", alt: "Afbeelding bij de vraag" })));

    if (lettersMode) {
      const checked = ans.checked && opts.mode !== "exam";
      const showReview = opts.mode === "review";
      const list = el("div", { class: "opts" });
      q.options.forEach((o) => {
        const isSel = ans.sel.includes(o.letter);
        const isRight = q.correct.includes(o.letter);
        let cls = "opt";
        if (checked || showReview) {
          if (isRight) cls += " right";
          else if (isSel) cls += " wrong";
        } else if (isSel) cls += " sel";
        const disabled = checked || showReview;
        list.append(el("button", {
          class: cls, disabled,
          onclick: () => {
            if (disabled) return;
            if (multi) {
              ans.sel = ans.sel.includes(o.letter) ? ans.sel.filter((x) => x !== o.letter) : [...ans.sel, o.letter];
            } else {
              ans.sel = [o.letter];
            }
            rerender && rerender();
          }
        }, el("span", { class: "letter" }, o.letter + "."), el("span", {}, o.text)));
      });
      wrap.append(list);

      if (opts.mode === "practice") {
        const canCheck = ans.sel.length === needed && !ans.checked;
        const check = el("button", { class: "primary", disabled: !canCheck, onclick: () => {
          ans.checked = true;
          recordResult(q.id, sameSet(ans.sel, q.correct));
          rerender();
        } }, "Controleer antwoord");
        wrap.append(el("div", { class: "row" }, check));
        if (checked) wrap.append(feedback(q, ans));
      }
      if (opts.mode === "exam") {
        wrap.append(el("p", { class: "muted" }, multi ? `Kies ${needed} antwoorden.` : "Kies één antwoord."));
      }
      if (opts.mode === "review") {
        wrap.append(feedback(q, ans, true));
      }
    } else {
      // Geen tekstopties: antwoord staat in een afbeelding of in tekst; de gebruiker beoordeelt zelf.
      const hasAnswerPart = (q.answer_images && q.answer_images.length) || q.answer_text;
      if (opts.mode === "practice" || opts.mode === "exam") {
        if (!ans.revealed) {
          wrap.append(el("div", { class: "row" },
            el("button", { class: "primary", disabled: !hasAnswerPart, onclick: () => { ans.revealed = true; rerender && rerender(); } },
              hasAnswerPart ? "Toon antwoord" : "Geen antwoord beschikbaar")));
        }
        if (ans.revealed) {
          wrap.append(renderAnswerPart(q));
          if (opts.mode === "practice") {
            wrap.append(el("div", { class: "row", style: "margin-top:10px" },
              el("span", { class: "muted" }, "Had je het goed?"),
              el("button", { onclick: () => { ans.self = true; recordResult(q.id, true); rerender(); } }, "Ja"),
              el("button", { onclick: () => { ans.self = false; recordResult(q.id, false); rerender(); } }, "Nee")));
          }
        }
      } else {
        wrap.append(renderAnswerPart(q));
      }
    }
    return wrap;
  }

  /* Maakt de vraagtekst leesbaar: notities, typeaanduidingen en scenario-"Solution"-regels krijgen een eigen blok. */
  function formatQuestion(text) {
    const box = el("div", { class: "qtext" });
    const NOTE = /^note:/i;
    const TAG = /^(HOTSPOT|DRAG DROP|Select and Place|Hot Area|Answer Area)\b/i;
    const SOLUTION = /^solution:/i;
    let buffer = [];
    const flush = () => {
      if (!buffer.length) return;
      const joined = buffer.join(" ");
      box.append(el(/\?$/.test(joined) ? "p" : "p", { class: /\?$/.test(joined) ? "qask" : "qpara" }, joined));
      buffer = [];
    };
    for (const raw of text.split("\n")) {
      // the PDF leaves stray dashes behind ("HOTSPOT -", a lone "-" line before the text)
      const line = raw.trim().replace(/^-\s*/, "");
      if (!line) { flush(); continue; }
      if (NOTE.test(line)) {
        flush();
        box.append(el("div", { class: "qnote" }, line.replace(/^note:\s*/i, "Opmerking: ")));
      } else if (TAG.test(line)) {
        flush();
        box.append(el("div", { class: "qtag" }, line.replace(/\s*-\s*$/, "").replace(/:$/, "")));
      } else if (SOLUTION.test(line)) {
        flush();
        box.append(el("div", { class: "qsolution" }, line.replace(/^solution:\s*/i, "Oplossing: ")));
      } else {
        buffer.push(line);
        // a sentence that ends here starts a new paragraph; a wrapped line continues it
        if (/[.?:!]$/.test(line)) flush();
      }
    }
    flush();
    return box;
  }

  function renderAnswerPart(q) {
    const box = el("div", {});
    (q.answer_images || []).forEach((src) => box.append(el("img", { class: "qimg", src: `bank/${q.__cert}/${src}`, loading: "lazy", alt: "Antwoord" })));
    if (q.answer_text) box.append(el("div", { class: "answer-text" }, q.answer_text));
    if (q.community_pct !== null && q.community_pct !== undefined) {
      box.append(el("p", { class: "muted" }, `Community-stemming voor het antwoord: ${q.community_pct}%`));
    }
    return box;
  }

  function feedback(q, ans, review) {
    const ok = sameSet(ans.sel, q.correct);
    const text = ok ? "Goed." : `Fout. Juist antwoord: ${q.correct.join(", ")}.`;
    const pct = q.community_pct !== null && q.community_pct !== undefined
      ? el("p", { class: "muted", style: "margin:6px 0 0" }, `Community-stemming voor het juiste antwoord: ${q.community_pct}%. Controleer dit bij twijfel op Microsoft Learn.`)
      : null;
    return el("div", { class: `feedback ${ok ? "ok" : "bad"}` }, el("strong", {}, review ? (ok ? "Goed" : "Fout") : text), pct);
  }

  /* ---------- start ---------- */

  async function init() {
    try {
      state.certs = await fetchJSON("bank/index.json");
    } catch (e) {
      state.certs = [];
    }
    const saved = (() => { try { return localStorage.getItem("certification-killer:cert"); } catch (e) { return null; } })();
    if (!state.certs.length) {
      app.replaceChildren(el("div", { class: "card" }, el("h2", {}, "Geen oefenbank gevonden"),
        el("p", { class: "muted" }, "Voeg een bank toe met tools/import_exam.py. Zie README.md.")));
      return;
    }
    await selectCert(saved || state.certs[0].id);
  }

  init();

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => { /* offline-ondersteuning is optioneel */ });
  }
})();
