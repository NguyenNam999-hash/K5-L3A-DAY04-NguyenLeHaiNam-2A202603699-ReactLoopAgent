/* ============================================================
   Testbench — replay harness
   Runs recorded eval traces back through a small execution
   engine so the dashboard has real step / log / timing states.
   ============================================================ */

(() => {
  "use strict";

  const DATA = window.DASHBOARD_DATA;
  const CASES = DATA.cases;
  const BY_ID = new Map(CASES.map((c) => [c.id, c]));
  const TOTAL = DATA.totalCases ?? CASES.length;
  const STATUS_TEXT = { "not-run": "Not Run", running: "Running", passed: "Passed", failed: "Failed" };

  const state = {
    runs: new Map(),
    filter: "all",
    currentId: null,
    runningAll: false,
    runAllEpoch: 0,
  };

  const $ = (sel, root = document) => root.querySelector(sel);

  const els = {
    grid: $("#grid"),
    runAll: $("#run-all"),
    runAllLabel: $("#run-all-label"),
    resetAll: $("#reset-all"),
    detail: $("#detail"),
    detailRun: $("#detail-run"),
    detailRunLabel: $("#detail-run .btn-label"),
    detailClose: $("#detail-close"),
    detailId: $("#detail-id"),
    detailGroup: $("#detail-group"),
    detailScenario: $("#detail-scenario"),
    detailTitle: $("#detail-title"),
    detailStatus: $("#detail-status"),
    detailStatusText: $("#detail-status span"),
    metaStart: $("#meta-start"),
    metaEnd: $("#meta-end"),
    metaDuration: $("#meta-duration"),
    metaScore: $("#meta-score"),
    stepList: $("#step-list"),
    stepsProgress: $("#steps-progress"),
    log: $("#log"),
    logState: $("#log-state"),
    detailReason: $("#detail-reason"),
    detailImprovement: $("#detail-improvement"),
    detailAnswer: $("#detail-answer"),
    progressLabel: $("#progress-label"),
    judgeScore: $("#judge-score"),
    bonusScore: $("#bonus-score"),
    countTotal: $("#count-total"),
    counts: {
      passed: $("#count-passed"),
      failed: $("#count-failed"),
      running: $("#count-running"),
      idle: $("#count-idle"),
    },
    chips: {
      passed: $("#chip-passed"),
      failed: $("#chip-failed"),
      running: $("#chip-running"),
      idle: $("#chip-idle"),
    },
    segments: {
      passed: $("#seg-passed"),
      failed: $("#seg-failed"),
      running: $("#seg-running"),
    },
    notePassed: $("#note-passed"),
    noteRunning: $("#note-running"),
  };

  /* ---------------------------------------------------------- helpers */

  const pad = (n) => String(n).padStart(2, "0");

  const esc = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const fmtClock = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const fmtClockMs = (d) => `${fmtClock(d)}.${String(d.getMilliseconds()).padStart(3, "0")}`;
  const fmtStamp = (d) => `${pad(d.getDate())} Nov · ${fmtClock(d)}`;

  function fmtDur(ms) {
    if (ms == null || Number.isNaN(ms)) return "—";
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function stepDelay(step, fast) {
    const base = step.kind === "tool" ? 560 : 400;
    const jitter = Math.random() * base * 0.85;
    return (base + jitter) * (fast ? 0.5 : 1);
  }

  function compactArgs(args) {
    if (!args || typeof args !== "object") return "—";
    const entries = Object.entries(args);
    if (!entries.length) return "no arguments";
    return entries
      .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
      .join("  ·  ");
  }

  /* ---------------------------------------------------------- state */

  function buildSteps(c) {
    const steps = [{
      kind: "plan",
      label: "Read case & lay out a plan",
      detail: `scenario ${c.scenario} · budget ${c.maxSteps ?? DATA.config.max_steps ?? "?"} steps · ${c.suite} suite`,
      note: "",
      fail: false,
    }];

    if (c.trace.length) {
      c.trace.forEach((t) => {
        steps.push({
          kind: "tool",
          label: t.name,
          detail: compactArgs(t.arguments),
          note: t.summary,
          fail: !t.ok,
        });
      });
    } else {
      steps.push({
        kind: "think",
        label: "Answer from snapshot context",
        detail: "no tool calls recorded for this case",
        note: "The recorded run produced an answer without touching the tools.",
        fail: false,
      });
    }

    steps.push({
      kind: "write",
      label: "Synthesize final answer",
      detail: "compose a response grounded in the collected observations",
      note: "",
      fail: c.verdict === "failed",
    });
    steps.push({
      kind: "verify",
      label: "Validate sources & data limits",
      detail: "confirm observed incident URLs and stated boundaries",
      note: "",
      fail: c.verdict === "failed",
    });

    return steps.map((s) => ({
      ...s,
      status: "pending",
      startedAt: null,
      endedAt: null,
      duration: null,
    }));
  }

  function freshRun(c) {
    return {
      status: "not-run",
      start: null,
      end: null,
      duration: null,
      steps: buildSteps(c),
      logs: [],
    };
  }

  function runFor(id) {
    if (!state.runs.has(id)) state.runs.set(id, freshRun(BY_ID.get(id)));
    return state.runs.get(id);
  }

  /* ---------------------------------------------------------- shell */

  function cardHTML(c, index) {
    return `
      <article class="case-card" data-id="${c.id}" data-suite="${c.suite}" data-status="not-run" style="--i:${index}">
        <button class="card-hit" type="button" data-open="${c.id}"
          aria-label="Open execution details for ${c.id}: ${esc(c.question)}"></button>
        <div class="card-body">
          <div class="card-top">
            <div>
              <span class="case-id">${c.id}</span>
              <span class="case-group">${esc(c.groupLabel)}</span>
            </div>
            <span class="ghost-index">${String(index + 1).padStart(2, "0")} / ${TOTAL}</span>
          </div>
          <p class="card-question">${esc(c.question)}</p>
        </div>
        <div class="card-foot">
          <span class="status-pill" data-status="not-run"><i></i><span>Not Run</span></span>
          <span class="card-meta">${c.trace.length} tool calls</span>
          <button class="run-btn" type="button" data-run="${c.id}">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5 13 8l-9 5.5z"/></svg>
            <span class="spin" aria-hidden="true"></span>
            <span class="run-label">Run test</span>
          </button>
        </div>
      </article>`;
  }

  function renderGrid() {
    els.grid.innerHTML = CASES.map(cardHTML).join("");

    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.id = "empty-state";
    empty.hidden = true;
    empty.textContent = "No cases match this filter.";
    els.grid.after(empty);

    CASES.forEach((c) => paintCard(c.id));
    updateSummary();
  }

  /* ---------------------------------------------------------- card paint */

  function paintCard(id) {
    const c = BY_ID.get(id);
    const run = runFor(id);
    const card = els.grid.querySelector(`.case-card[data-id="${id}"]`);
    if (!card) return;

    card.dataset.status = run.status;

    const pill = card.querySelector(".status-pill");
    pill.dataset.status = run.status;
    pill.querySelector("span").textContent = STATUS_TEXT[run.status];

    const meta = card.querySelector(".card-meta");
    if (run.status === "running") {
      meta.textContent = run.start ? fmtDur(Date.now() - run.start.getTime()) : "0ms";
    } else if (run.status === "passed" || run.status === "failed") {
      meta.textContent = fmtDur(run.duration);
    } else {
      meta.textContent = `${c.trace.length} tool calls`;
    }

    const btn = card.querySelector(".run-btn");
    const label = btn.querySelector(".run-label");
    const running = run.status === "running";
    btn.disabled = running;
    btn.setAttribute("aria-busy", String(running));
    label.textContent = running ? "Running" : "Run test";

    card.setAttribute(
      "aria-label",
      `${id} — ${STATUS_TEXT[run.status]}. ${c.question}`
    );

    applyFilter();
  }

  function updateSummary() {
    const counts = { passed: 0, failed: 0, running: 0, "not-run": 0 };
    CASES.forEach((c) => {
      counts[runFor(c.id).status] += 1;
    });

    els.countTotal.textContent = TOTAL;
    els.counts.passed.textContent = counts.passed;
    els.counts.failed.textContent = counts.failed;
    els.counts.running.textContent = counts.running;
    els.counts.idle.textContent = counts["not-run"];

    const allChip = document.querySelector('.chip[data-filter="all"] b');
    if (allChip) allChip.textContent = TOTAL;
    els.chips.passed.textContent = counts.passed;
    els.chips.failed.textContent = counts.failed;
    els.chips.running.textContent = counts.running;
    els.chips.idle.textContent = counts["not-run"];

    const done = counts.passed + counts.failed;
    els.notePassed.textContent = done ? `${done} executed` : "no runs yet";
    els.noteRunning.textContent = counts.running ? `${counts.running} active` : "idle";

    els.segments.passed.style.width = `${(counts.passed / TOTAL) * 100}%`;
    els.segments.failed.style.width = `${(counts.failed / TOTAL) * 100}%`;
    els.segments.running.style.width = `${(counts.running / TOTAL) * 100}%`;
    els.progressLabel.textContent = `${done} / ${TOTAL} executed`;

    const score = DATA.summary.score_0_100;
    els.judgeScore.textContent = typeof score === "number" ? score.toFixed(2) : "—";
    els.judgeScore.parentElement.title = "Mean judge score over the 22 core cases";

    const bonus = DATA.bonusSummary?.bonus_points_0_15;
    els.bonusScore.textContent = typeof bonus === "number" ? bonus.toFixed(2) : "—";
    els.bonusScore.parentElement.title = "Bonus points over the 10 bonus cases (max 15)";
  }

  function applyFilter() {
    let visible = 0;
    CASES.forEach((c) => {
      const card = els.grid.querySelector(`.case-card[data-id="${c.id}"]`);
      if (!card) return;
      const status = runFor(c.id).status;
      const show = state.filter === "all" || status === state.filter;
      card.classList.toggle("is-hidden", !show);
      if (show) visible += 1;
    });

    const empty = $("#empty-state");
    if (empty) empty.hidden = visible > 0;
  }

  function setFilter(filter) {
    state.filter = filter;
    document.querySelectorAll(".chip[data-filter]").forEach((chip) => {
      chip.classList.toggle("is-active", chip.dataset.filter === filter);
    });
    applyFilter();
  }

  /* ---------------------------------------------------------- run engine */

  async function startRun(id, { fast = false, epoch = null } = {}) {
    const c = BY_ID.get(id);
    const existing = runFor(id);
    if (existing.status === "running") return;
    if (epoch !== null && epoch !== state.runAllEpoch) return;

    const run = freshRun(c);
    run.status = "running";
    run.start = new Date();
    state.runs.set(id, run);

    paintCard(id);
    updateSummary();

    if (state.currentId === id) {
      paintModalStatic();
      renderSteps();
      renderLogs();
    }

    addLog(id, "run", `Run started · ${id} · scenario ${c.scenario} · ${run.steps.length} steps queued`);
    addLog(id, "info", `Replaying ${c.trace.length} recorded tool call${c.trace.length === 1 ? "" : "s"} · budget ${c.maxSteps ?? DATA.config.max_steps ?? "?"} steps`);

    await sleep(fast ? 120 : 240);
    if (state.runs.get(id) !== run) return;

    for (let i = 0; i < run.steps.length; i += 1) {
      if (state.runs.get(id) !== run) return;
      if (epoch !== null && epoch !== state.runAllEpoch) return;

      const step = run.steps[i];
      step.status = "running";
      step.startedAt = new Date();
      addLog(id, "info", `→ [${pad(i + 1)}/${pad(run.steps.length)}] ${step.label} — started`);
      if (state.currentId === id) renderSteps();

      await sleep(stepDelay(step, fast));
      if (state.runs.get(id) !== run) return;

      step.endedAt = new Date();
      step.duration = step.endedAt - step.startedAt;
      step.status = step.fail ? "failed" : "passed";
      addLog(
        id,
        step.fail ? "error" : "ok",
        `${step.label} — ${step.fail ? "failed" : "passed"} (${fmtDur(step.duration)})${step.fail && step.note ? ` · ${step.note}` : ""}`
      );
      if (state.currentId === id) renderSteps();
    }

    if (state.runs.get(id) !== run) return;

    run.status = c.verdict === "failed" ? "failed" : "passed";
    run.end = new Date();
    run.duration = run.end - run.start;

    const failedSteps = run.steps.filter((s) => s.status === "failed").length;
    addLog(
      id,
      run.status === "passed" ? "ok" : "error",
      `Run ${run.status} · ${run.steps.length - failedSteps}/${run.steps.length} steps passed · ${fmtDur(run.duration)}`
    );
    addLog(id, "info", `Recorded judge score ${c.score ?? "—"} / 100 · status ${c.recordedStatus}`);

    paintCard(id);
    updateSummary();
    if (state.currentId === id) {
      paintModalStatic();
      renderSteps();
      updateLogState();
    }
  }

  async function runAll() {
    if (state.runningAll) return;
    state.runningAll = true;
    state.runAllEpoch += 1;
    const epoch = state.runAllEpoch;
    updateRunAllButton();

    const queue = CASES.map((c) => c.id);
    const worker = async () => {
      while (queue.length && epoch === state.runAllEpoch) {
        const id = queue.shift();
        await startRun(id, { fast: true, epoch });
      }
    };

    await Promise.all(Array.from({ length: 4 }, worker));

    if (epoch === state.runAllEpoch) {
      state.runningAll = false;
      updateRunAllButton();
      updateSummary();
    }
  }

  function resetAll() {
    state.runAllEpoch += 1;
    state.runningAll = false;
    CASES.forEach((c) => state.runs.set(c.id, freshRun(c)));
    updateRunAllButton();

    CASES.forEach((c) => paintCard(c.id));
    updateSummary();

    if (state.currentId) {
      paintModalStatic();
      renderSteps();
      renderLogs();
    }
  }

  function updateRunAllButton() {
    els.runAll.disabled = state.runningAll;
    els.runAllLabel.textContent = state.runningAll ? "Running suite…" : "Run all cases";
  }

  /* ---------------------------------------------------------- logs */

  function addLog(id, level, text) {
    const run = state.runs.get(id);
    if (!run) return;
    const entry = { time: new Date(), level, text };
    run.logs.push(entry);
    if (state.currentId === id && els.detail.open) appendLogLine(entry);
  }

  function logLineHTML(entry) {
    return `<div class="log-line" data-level="${entry.level}">
      <span class="log-time">${fmtClockMs(entry.time)}</span>
      <span class="log-level">${entry.level}</span>
      <span class="log-text">${esc(entry.text)}</span>
    </div>`;
  }

  function appendLogLine(entry) {
    const log = els.log;
    const empty = log.querySelector(".log-empty");
    if (empty) empty.remove();

    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
    log.insertAdjacentHTML("beforeend", logLineHTML(entry));
    if (nearBottom) log.scrollTop = log.scrollHeight;
  }

  function renderLogs() {
    const id = state.currentId;
    if (!id) return;
    const run = runFor(id);
    const c = BY_ID.get(id);

    if (!run.logs.length) {
      els.log.innerHTML = `<div class="log-empty">
        <b>No execution data yet.</b>
        <span>Run this test to stream step-by-step logs here.</span>
        <span>Recorded trace: ${c.trace.length} tool call${c.trace.length === 1 ? "" : "s"} · judge score ${c.score ?? "—"}/100.</span>
      </div>`;
    } else {
      els.log.innerHTML = run.logs.map(logLineHTML).join("");
      els.log.scrollTop = els.log.scrollHeight;
    }
    updateLogState();
  }

  function updateLogState() {
    const id = state.currentId;
    if (!id) return;
    const run = runFor(id);
    const live = run.status === "running";
    els.logState.dataset.live = String(live);
    els.logState.innerHTML = `<i></i>${live ? "STREAMING" : run.status === "not-run" ? "IDLE" : "COMPLETE"}`;
  }

  /* ---------------------------------------------------------- modal */

  function paintModalStatic() {
    const id = state.currentId;
    if (!id) return;
    const c = BY_ID.get(id);
    const run = runFor(id);

    els.detailStatus.dataset.status = run.status;
    els.detailStatusText.textContent = STATUS_TEXT[run.status];

    const running = run.status === "running";
    els.detailRun.disabled = running;
    els.detailRunLabel.textContent = running ? "Running…" : "Run test";

    els.metaStart.textContent = run.start ? fmtStamp(run.start) : "—";
    els.metaEnd.textContent = run.end ? fmtStamp(run.end) : "—";
    els.metaDuration.textContent = run.status === "running"
      ? fmtDur(Date.now() - run.start.getTime())
      : run.duration != null ? fmtDur(run.duration) : "—";
    els.metaScore.textContent = `${c.score ?? "—"} / 100${c.judgeStatus ? ` · ${c.judgeStatus}` : ""}`;

    updateLogState();
  }

  function stepHTML(step, index) {
    const elapsed = step.status === "running"
      ? fmtDur(Date.now() - step.startedAt.getTime())
      : step.duration != null ? fmtDur(step.duration) : "—";

    return `<li class="step" data-status="${step.status}" data-step="${index}">
      <div class="step-rail"><span class="step-marker" aria-hidden="true"></span></div>
      <div class="step-body">
        <div class="step-top">
          <span class="step-index">${pad(index + 1)}</span>
          <span class="step-label">${esc(step.label)}</span>
          <span class="step-time">${elapsed}</span>
        </div>
        <div class="step-detail">${esc(step.detail)}</div>
        ${step.note && step.status !== "pending" ? `<div class="step-note">${esc(step.note)}</div>` : ""}
      </div>
    </li>`;
  }

  function renderSteps() {
    const id = state.currentId;
    if (!id) return;
    const run = runFor(id);
    els.stepList.innerHTML = run.steps.map(stepHTML).join("");
    const done = run.steps.filter((s) => s.status === "passed" || s.status === "failed").length;
    els.stepsProgress.textContent = `${done} / ${run.steps.length} steps`;
  }

  function openCase(id) {
    const c = BY_ID.get(id);
    if (!c) return;

    state.currentId = id;
    runFor(id);

    els.detailId.textContent = id;
    els.detailGroup.textContent = c.groupLabel;
    els.detailScenario.textContent = c.scenario;
    els.detail.dataset.suite = c.suite;
    els.detailTitle.textContent = c.question;
    els.detailReason.textContent = c.reason || "No judge rationale recorded.";
    els.detailImprovement.textContent = c.improvement || "No improvement note recorded.";
    els.detailAnswer.textContent = c.answer || "No answer recorded.";

    if (!els.detail.open) {
      els.detail.showModal();
      document.body.classList.add("locked");
    }

    paintModalStatic();
    renderSteps();
    renderLogs();
    els.detail.querySelector(".detail-shell").scrollTop = 0;
  }

  function closeCase() {
    if (els.detail.open) els.detail.close();
  }

  /* ---------------------------------------------------------- ticker */

  function tick() {
    const now = Date.now();
    CASES.forEach((c) => {
      const run = state.runs.get(c.id);
      if (!run || run.status !== "running" || !run.start) return;

      const card = els.grid.querySelector(`.case-card[data-id="${c.id}"]`);
      if (card) {
        const meta = card.querySelector(".card-meta");
        if (meta) meta.textContent = fmtDur(now - run.start.getTime());
      }
    });

    if (state.currentId && els.detail.open) {
      const run = runFor(state.currentId);
      if (run.status === "running" && run.start) {
        els.metaDuration.textContent = fmtDur(now - run.start.getTime());
        const runningStep = els.stepList.querySelector('.step[data-status="running"]');
        if (runningStep) {
          const step = run.steps[Number(runningStep.dataset.step)];
          if (step && step.startedAt) {
            const time = runningStep.querySelector(".step-time");
            if (time) time.textContent = fmtDur(now - step.startedAt.getTime());
          }
        }
      }
    }
  }

  /* ---------------------------------------------------------- events */

  els.grid.addEventListener("click", (event) => {
    const runBtn = event.target.closest("[data-run]");
    if (runBtn) {
      event.preventDefault();
      event.stopPropagation();
      if (!runBtn.disabled) startRun(runBtn.dataset.run);
      return;
    }
    const open = event.target.closest("[data-open]");
    if (open) openCase(open.dataset.open);
  });

  document.querySelectorAll(".chip[data-filter]").forEach((chip) => {
    chip.addEventListener("click", () => setFilter(chip.dataset.filter));
  });

  els.runAll.addEventListener("click", runAll);
  els.resetAll.addEventListener("click", resetAll);
  els.detailRun.addEventListener("click", () => {
    if (state.currentId) startRun(state.currentId);
  });
  els.detailClose.addEventListener("click", closeCase);

  els.detail.addEventListener("close", () => {
    state.currentId = null;
    document.body.classList.remove("locked");
  });

  els.detail.addEventListener("click", (event) => {
    if (event.target === els.detail) closeCase();
  });

  /* ---------------------------------------------------------- boot */

  els.judgeScore.parentElement.title = "Mean judge score over the 22 core cases";
  els.bonusScore.parentElement.title = "Bonus points over the 10 bonus cases (max 15)";
  renderGrid();
  setFilter("all");
  setInterval(tick, 100);
})();
