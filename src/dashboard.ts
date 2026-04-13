export function dashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cacophony</title>
<script>
  // Apply saved theme synchronously before Alpine loads so there's no flash.
  try {
    var t = localStorage.getItem('caco.theme');
    document.documentElement.dataset.theme = t === 'light' ? 'light' : 'dark';
  } catch (e) {
    document.documentElement.dataset.theme = 'dark';
  }
</script>
<script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.14.1/dist/cdn.min.js"></script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  /* ----- Palette: grayscale only, flat, sharp edges ------------------------
     Accent colors (red / green) are used ONLY on indicator badges:
       connection dot, run status pills, running/failed counters,
       running task border, and the state dot on a running task.
     Everything else — text, borders, buttons, inputs — stays grayscale.   */

  :root {
    --bg: #000000;
    --bg-elev: #0a0a0a;
    --bg-hover: #141414;
    --border: #1f1f1f;
    --border-strong: #333333;
    --text: #ffffff;
    --text-dim: #888888;
    --text-faint: #555555;
    --green: #22c55e;
    --red: #ef4444;
    --modal-backdrop: rgba(0, 0, 0, 0.75);
    color-scheme: dark;
  }

  :root[data-theme="light"] {
    --bg: #ffffff;
    --bg-elev: #fafafa;
    --bg-hover: #f0f0f0;
    --border: #e5e5e5;
    --border-strong: #cccccc;
    --text: #000000;
    --text-dim: #666666;
    --text-faint: #999999;
    --green: #15803d;
    --red: #b91c1c;
    --modal-backdrop: rgba(0, 0, 0, 0.35);
    color-scheme: light;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    background: var(--bg);
    color: var(--text);
    font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 13px;
    font-feature-settings: "calt" 1, "liga" 1;
  }
  body { max-width: 1100px; margin: 0 auto; padding: 1.5rem; min-height: 100vh; }
  button { font: inherit; color: inherit; cursor: pointer; border: none; background: none; }
  input, textarea, select { font: inherit; color: inherit; }
  a { color: var(--text); }

  /* Header */
  header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem; }
  h1 { font-size: 1.1rem; font-weight: 700; color: var(--text); letter-spacing: 0.02em; text-transform: uppercase; }
  h1 .tracker-badge {
    font-size: 0.65rem; font-weight: 500; color: var(--text-dim); text-transform: lowercase;
    margin-left: 0.5rem; padding: 2px 8px; background: var(--bg-elev); border: 1px solid var(--border);
    letter-spacing: 0.05em;
  }
  .header-right { display: flex; align-items: center; gap: 0.5rem; }
  .theme-toggle {
    padding: 4px 10px; font-size: 0.7rem; font-weight: 500; color: var(--text-dim);
    background: var(--bg-elev); border: 1px solid var(--border); text-transform: lowercase;
  }
  .theme-toggle:hover { color: var(--text); border-color: var(--border-strong); }
  .conn {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 4px 10px; font-size: 0.7rem; font-weight: 600;
    background: var(--bg-elev); border: 1px solid var(--border); text-transform: lowercase;
  }
  .conn-dot { width: 6px; height: 6px; background: var(--text-faint); }
  .conn.live .conn-dot { background: var(--green); }
  .conn.dead .conn-dot { background: var(--red); }

  /* Stats */
  .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem; margin-bottom: 1.5rem; }
  .stat {
    background: var(--bg-elev); border: 1px solid var(--border);
    padding: 0.75rem 1rem; cursor: pointer;
    transition: border-color 0.15s;
  }
  .stat:hover { border-color: var(--border-strong); }
  .stat.selected { border-color: var(--text); }
  .stat-label { font-size: 0.65rem; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em; }
  .stat-value { font-size: 1.5rem; font-weight: 700; margin-top: 2px; font-variant-numeric: tabular-nums; color: var(--text); }
  .stat-value.running { color: var(--green); }
  .stat-value.failed { color: var(--red); }
  .stat-sub { font-size: 0.65rem; color: var(--text-dim); margin-top: 2px; }

  /* Create task */
  .creator {
    background: var(--bg-elev); border: 1px solid var(--border);
    padding: 0.75rem; margin-bottom: 1.5rem;
  }
  .creator-row { display: flex; gap: 0.5rem; align-items: center; }
  .creator input[type="text"] {
    flex: 1; background: var(--bg); border: 1px solid var(--border);
    padding: 8px 12px; color: var(--text);
  }
  .creator input:focus, .creator textarea:focus, .creator select:focus {
    outline: none; border-color: var(--text);
  }
  .creator select {
    background: var(--bg); border: 1px solid var(--border);
    padding: 8px 10px; color: var(--text);
  }
  .creator textarea {
    display: block; width: 100%; min-height: 60px; resize: vertical; font-family: inherit;
    background: var(--bg); border: 1px solid var(--border);
    padding: 8px 12px; color: var(--text); margin-bottom: 0.5rem;
  }
  .creator-expand { margin-top: 0.5rem; display: flex; gap: 0.5rem; align-items: center; }

  /* Filter tabs */
  .filters { display: flex; gap: 0; margin-bottom: 1rem; border-bottom: 1px solid var(--border); }
  .filter-btn {
    padding: 8px 16px; font-size: 0.8rem; font-weight: 500; color: var(--text-dim);
    border-bottom: 2px solid transparent; transition: color 0.15s, border-color 0.15s;
    text-transform: lowercase;
  }
  .filter-btn:hover { color: var(--text); }
  .filter-btn.active { color: var(--text); border-bottom-color: var(--text); }
  .filter-btn .count {
    margin-left: 6px; padding: 1px 6px; background: var(--bg-elev); border: 1px solid var(--border);
    font-size: 0.7rem; font-variant-numeric: tabular-nums; color: var(--text-dim);
  }
  .filter-spacer { flex: 1; }
  .search {
    background: var(--bg-elev); border: 1px solid var(--border);
    padding: 6px 10px; color: var(--text); font-size: 0.75rem; width: 200px;
    margin-bottom: 4px; font-family: inherit;
  }
  .search:focus { outline: none; border-color: var(--text); }

  /* Section headers */
  .section-head {
    display: flex; align-items: center; gap: 0.5rem;
    font-size: 0.75rem; font-weight: 600; color: var(--text-dim);
    text-transform: uppercase; letter-spacing: 0.05em;
    margin: 1rem 0 0.5rem;
  }
  .section-head .count { color: var(--text-faint); }

  /* Task rows */
  .task-list { display: flex; flex-direction: column; gap: 2px; }
  .task {
    display: flex; align-items: center; gap: 0.75rem;
    padding: 0.7rem 0.9rem;
    background: var(--bg-elev); border: 1px solid var(--border);
    transition: background 0.15s, border-color 0.15s; cursor: pointer;
  }
  .task:hover { background: var(--bg-hover); border-color: var(--border-strong); }
  .task.done { opacity: 0.5; }
  .task.running { border-color: var(--green); }
  /* .failed intentionally does NOT get a border — the red state dot is enough. */
  .task .state-dot { width: 8px; height: 8px; flex-shrink: 0; background: var(--text-faint); }
  .task .state-dot.todo { background: var(--text-dim); }
  .task .state-dot.in-progress { background: var(--text); }
  .task .state-dot.done { background: var(--text-faint); }
  .task .state-dot.cancelled,
  .task .state-dot.wontfix { background: var(--text-faint); }
  .task .state-dot.running {
    background: var(--green); animation: pulse 2s infinite;
  }
  .task.failed .state-dot { background: var(--red); }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.35; }
  }
  .task-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .task-meta { font-size: 0.7rem; color: var(--text-faint); white-space: nowrap; }
  .blocked-tag, .failed-tag {
    font-size: 0.65rem; font-weight: 600;
    padding: 1px 6px; background: var(--bg); border: 1px solid var(--border);
    text-transform: uppercase; letter-spacing: 0.05em;
  }
  .blocked-tag { color: var(--text-dim); }
  .failed-tag { color: var(--red); border-color: var(--red); }
  .task-actions {
    display: flex; gap: 4px; opacity: 0.4;
    transition: opacity 0.15s;
  }
  .task:hover .task-actions { opacity: 1; }
  .icon-btn {
    width: 24px; height: 24px; display: inline-flex;
    align-items: center; justify-content: center; font-size: 12px;
    color: var(--text-dim); transition: background 0.15s, color 0.15s;
    border: 1px solid transparent;
  }
  .icon-btn:hover { background: var(--bg-hover); color: var(--text); border-color: var(--border); }
  .icon-btn.danger:hover { color: var(--red); border-color: var(--red); background: var(--bg); }

  /* Empty states */
  .empty {
    text-align: center; padding: 2rem 1rem; color: var(--text-faint);
    background: var(--bg-elev); border: 1px dashed var(--border);
    font-size: 0.8rem;
  }
  .empty strong { color: var(--text-dim); display: block; margin-bottom: 0.25rem; font-weight: 600; }

  /* Modal */
  .modal-backdrop {
    position: fixed; inset: 0; background: var(--modal-backdrop);
    display: flex; align-items: center; justify-content: center; padding: 2rem;
    z-index: 100;
  }
  .modal {
    background: var(--bg); border: 1px solid var(--border-strong);
    width: 100%; max-width: 720px; max-height: 90vh;
    display: flex; flex-direction: column; overflow: hidden;
  }
  .modal-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 1rem 1.25rem; border-bottom: 1px solid var(--border);
  }
  .modal-title { font-size: 0.95rem; font-weight: 600; }
  .modal-id { font-size: 0.75rem; color: var(--text-dim); }
  .modal-body { padding: 1.25rem; overflow-y: auto; flex: 1; }
  .modal-section { margin-bottom: 1.25rem; }
  .modal-label { font-size: 0.65rem; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.4rem; font-weight: 600; }
  .modal-desc {
    white-space: pre-wrap; font-size: 0.8rem; line-height: 1.55;
    background: var(--bg-elev); border: 1px solid var(--border);
    padding: 0.75rem 1rem; color: var(--text-dim);
    max-height: 300px; overflow-y: auto;
  }
  .modal-desc:empty::before { content: "No description"; color: var(--text-faint); font-style: italic; }
  .modal-foot {
    display: flex; gap: 0.5rem; justify-content: flex-end;
    padding: 1rem 1.25rem; border-top: 1px solid var(--border); background: var(--bg-elev);
  }
  .btn {
    padding: 6px 14px; font-size: 0.75rem; font-weight: 500;
    background: var(--bg-elev); border: 1px solid var(--border); color: var(--text);
    transition: background 0.15s, border-color 0.15s, color 0.15s;
    text-transform: lowercase; font-family: inherit;
  }
  .btn:hover { background: var(--bg-hover); border-color: var(--border-strong); }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn.primary { background: var(--text); border-color: var(--text); color: var(--bg); font-weight: 600; }
  .btn.primary:hover { background: var(--text-dim); border-color: var(--text-dim); }
  .btn.danger { color: var(--text-dim); border-color: var(--border); }
  .btn.danger:hover { color: var(--red); border-color: var(--red); background: var(--bg); }

  /* Run history */
  .run-list { display: flex; flex-direction: column; gap: 2px; }
  .run-item {
    display: flex; align-items: center; gap: 0.75rem;
    padding: 0.5rem 0.75rem;
    background: var(--bg-elev); border: 1px solid var(--border);
    font-size: 0.75rem;
  }
  .run-item .status {
    font-weight: 700; padding: 1px 8px; font-size: 0.65rem;
    text-transform: uppercase; letter-spacing: 0.05em;
    border: 1px solid var(--border);
  }
  .run-item .status.succeeded,
  .run-item .status.running { color: var(--green); border-color: var(--green); }
  .run-item .status.failed,
  .run-item .status.timed_out { color: var(--red); border-color: var(--red); }
  .run-item .status.canceled { color: var(--text-dim); border-color: var(--border-strong); }
  .run-meta { color: var(--text-faint); margin-left: auto; font-variant-numeric: tabular-nums; }
  .run-error {
    font-size: 0.7rem; color: var(--text);
    margin-top: 4px; padding: 6px 10px;
    background: var(--bg); border: 1px solid var(--red); border-left-width: 3px;
    white-space: pre-wrap; word-break: break-word;
  }
  .run-hook-output { margin-top: 4px; font-size: 0.75rem; }
  .run-hook-output summary {
    cursor: pointer; color: var(--text-dim); padding: 2px 0;
  }
  .run-hook-output summary:hover { color: var(--text); }
  .run-hook-output pre {
    margin-top: 4px; padding: 8px 10px;
    background: var(--bg); border: 1px solid var(--border);
    font-size: 0.7rem;
    white-space: pre-wrap; word-break: break-word;
    max-height: 320px; overflow-y: auto;
    color: var(--text);
  }

  /* Brief clarification questions */
  .brief-question {
    margin-bottom: 1rem; padding: 0.75rem;
    background: var(--bg-elev); border: 1px solid var(--border);
  }
  .brief-question:last-child { margin-bottom: 0; }
  .brief-q-text {
    font-size: 0.85rem; font-weight: 600; color: var(--text);
    margin-bottom: 0.5rem;
  }
  .brief-option {
    display: flex; align-items: center; gap: 0.5rem;
    padding: 4px 6px; cursor: pointer;
    font-size: 0.8rem; color: var(--text);
  }
  .brief-option:hover { background: var(--bg-hover); }
  .brief-option input[type="radio"] {
    margin: 0; accent-color: var(--text);
  }
  .brief-option-other input[type="text"] {
    flex: 1; margin-left: 0.5rem; padding: 4px 8px;
    background: var(--bg); border: 1px solid var(--border);
    color: var(--text); font-family: inherit; font-size: 0.8rem;
  }
  .brief-option-other input[type="text"]:disabled { opacity: 0.4; }
  .brief-option-other input[type="text"]:focus { outline: none; border-color: var(--text); }
  .brief-free-input {
    display: block; width: 100%; padding: 6px 10px;
    background: var(--bg); border: 1px solid var(--border);
    color: var(--text); font-family: inherit; font-size: 0.8rem;
  }
  .brief-free-input:focus { outline: none; border-color: var(--text); }

  /* Brief "your answers" read-only summary shown while refining */
  .brief-summary-row {
    display: flex; gap: 0.75rem; align-items: flex-start;
    padding: 0.6rem 0.75rem; margin-bottom: 2px;
    background: var(--bg-elev); border: 1px solid var(--border);
    font-size: 0.8rem;
  }
  .brief-summary-q {
    flex: 0 0 40%; color: var(--text-dim); font-weight: 500;
  }
  .brief-summary-a {
    flex: 1; color: var(--text); font-weight: 600;
  }
  .brief-refining {
    display: flex; align-items: center; gap: 0.75rem;
    padding: 0.75rem; margin-top: 0.75rem;
    background: var(--bg-elev); border: 1px solid var(--border-strong);
    font-size: 0.8rem; color: var(--text-dim);
  }
  .brief-refining-dot {
    width: 8px; height: 8px; background: var(--text);
    animation: pulse 1.2s infinite;
  }

  /* Skill suggestion card */
  .skill-suggestion {
    background: var(--bg-elev); border: 1px solid var(--border-strong);
    padding: 1rem; margin-bottom: 1.5rem;
  }
  .skill-suggestion-head {
    display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;
  }
  .skill-suggestion-title {
    font-size: 0.85rem; font-weight: 700; color: var(--text);
    text-transform: uppercase; letter-spacing: 0.03em;
  }
  .skill-suggestion-desc {
    font-size: 0.8rem; color: var(--text-dim); margin-bottom: 0.75rem;
    line-height: 1.4;
  }
  .skill-suggestion-actions {
    display: flex; gap: 0.5rem; justify-content: flex-end;
  }
  .brief-hint {
    font-size: 0.7rem; color: var(--text-faint);
    width: 100%; margin-bottom: 0.5rem;
  }
  .hook-suggestion-cmd {
    display: block; width: 100%;
    font-family: inherit; font-size: 0.75rem; color: var(--text);
    padding: 0.5rem 0.75rem; margin-bottom: 0.75rem;
    background: var(--bg); border: 1px solid var(--border);
  }
  .hook-suggestion-cmd:focus { outline: none; border-color: var(--text); }

  /* Keyboard hint */
  kbd {
    background: var(--bg); border: 1px solid var(--border-strong);
    padding: 1px 5px; font-family: inherit;
    font-size: 0.7rem; color: var(--text-dim);
  }

  /* Utilities */
  .hidden { display: none !important; }
  [x-cloak] { display: none !important; }

  /* Scrollbars — match the flat/minimal vibe */
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border); }
  ::-webkit-scrollbar-thumb:hover { background: var(--border-strong); }
</style>
</head><body>

<div x-data="app()" x-init="init()" x-cloak>

  <header>
    <h1>Cacophony <span class="tracker-badge" x-text="trackerKind || 'loading'"></span></h1>
    <div class="header-right">
      <button class="theme-toggle" @click="toggleTheme()" x-text="theme === 'dark' ? 'light' : 'dark'" title="Toggle theme"></button>
      <div class="conn" :class="{live: connected, dead: !connected}">
        <span class="conn-dot"></span>
        <span x-text="connected ? 'live' : 'offline'"></span>
      </div>
    </div>
  </header>

  <!-- Stats — clickable to jump to the corresponding filter tab -->
  <div class="stats">
    <div class="stat" @click="filter = 'active'" :class="{selected: filter === 'active'}">
      <div class="stat-label">Active</div>
      <div class="stat-value running" x-text="running.length + retrying.length"></div>
      <div class="stat-sub" x-show="retrying.length > 0" x-text="retrying.length + ' retrying'"></div>
    </div>
    <div class="stat" @click="filter = 'done'" :class="{selected: filter === 'done'}">
      <div class="stat-label">Done</div>
      <div class="stat-value" x-text="succeededCount"></div>
    </div>
    <div class="stat" @click="filter = 'failed'" :class="{selected: filter === 'failed'}">
      <div class="stat-label">Failed</div>
      <div class="stat-value failed" x-text="failedCount"></div>
    </div>
  </div>

  <!-- Create task (files tracker only) -->
  <div class="creator" x-show="trackerKind === 'files'">
    <form @submit.prevent="runTask()">
      <textarea x-model="newTask.prompt" placeholder="Describe what needs to be done..." required rows="3" :disabled="runBusy"></textarea>
      <div class="creator-row">
        <label x-show="briefEnabled" style="display:flex;align-items:center;gap:0.35rem;font-size:0.85rem;color:var(--text-dim);">
          <input type="checkbox" x-model="newTask.skipBrief"> Skip brief
        </label>
        <div class="creator-spacer" style="flex:1;"></div>
        <button type="submit" class="btn primary" :disabled="runBusy" x-text="runBusy ? 'Briefing…' : 'Run'"></button>
      </div>
    </form>
  </div>

  <!-- Brief modal: clarification questions before the task runs -->
  <div class="modal-backdrop" x-show="brief" @keydown.escape.window="cancelBrief()">
    <div class="modal" @click.stop x-show="brief" x-transition>
      <div class="modal-head">
        <div>
          <div class="modal-title">Brief the agent</div>
          <div class="modal-id" x-text="'round ' + (brief?.round || 1) + ' of ' + (briefMaxRounds || 2)"></div>
        </div>
        <button class="icon-btn" @click="cancelBrief()">✕</button>
      </div>
      <div class="modal-body">
        <div class="modal-section">
          <div class="modal-label">Your request</div>
          <div class="modal-desc" x-text="brief?.originalPrompt || ''"></div>
        </div>
        <!-- Interactive question form (shown while not refining) -->
        <div class="modal-section" x-show="!runBusy">
          <div class="modal-label">A few clarifying questions</div>
          <template x-for="(q, i) in (brief?.questions || [])" :key="i">
            <div class="brief-question">
              <div class="brief-q-text" x-text="q.question"></div>
              <template x-for="(opt, j) in q.options" :key="j">
                <label class="brief-option">
                  <input type="radio" :name="'brief-q-' + i" :value="opt" x-model="brief.answers[i].choice">
                  <span x-text="opt"></span>
                </label>
              </template>
              <label class="brief-option brief-option-other" x-show="q.options.length > 0">
                <input type="radio" :name="'brief-q-' + i" value="__other__" x-model="brief.answers[i].choice">
                <span>Other:</span>
                <input type="text" x-model="brief.answers[i].other"
                       :disabled="brief.answers[i].choice !== '__other__'"
                       @focus="brief.answers[i].choice = '__other__'"
                       placeholder="Type your answer…">
              </label>
              <input type="text" x-show="q.options.length === 0"
                     class="brief-free-input"
                     x-model="brief.answers[i].other"
                     placeholder="Type your answer…">
            </div>
          </template>
        </div>

        <!-- Read-only summary of answers while the next round is in flight -->
        <div class="modal-section" x-show="runBusy">
          <div class="modal-label">Your answers</div>
          <template x-for="(q, i) in (brief?.questions || [])" :key="i">
            <div class="brief-summary-row">
              <div class="brief-summary-q" x-text="q.question"></div>
              <div class="brief-summary-a" x-text="_resolveBriefAnswer(i) || '—'"></div>
            </div>
          </template>
          <div class="brief-refining">
            <span class="brief-refining-dot"></span>
            <span>Refining your task with the agent…</span>
          </div>
        </div>
      </div>
      <div class="modal-foot">
        <div class="brief-hint">Unanswered questions will be decided by the agent.</div>
        <button class="btn" @click="cancelBrief()">Back</button>
        <button class="btn" @click="skipBriefNow()">Agent's best guess</button>
        <button class="btn primary" :disabled="runBusy" @click="continueBrief()" x-text="runBusy ? 'Refining…' : 'Submit answers'"></button>
      </div>
    </div>
  </div>

  <!-- Hook suggestion (shown when brief suggests verification tools for the detected stack) -->
  <div class="skill-suggestion" x-show="hookSuggestion">
    <div class="skill-suggestion-head">
      <span class="skill-suggestion-title">Verification hooks suggested</span>
    </div>
    <div class="skill-suggestion-desc">
      Configure automatic build + test verification for this project?
    </div>
    <input type="text" class="hook-suggestion-cmd" x-model="hookSuggestion.after_run">
    <div class="skill-suggestion-actions">
      <button class="btn" @click="skipHooksAndRun()">Skip</button>
      <button class="btn primary" :disabled="runBusy" @click="applyHooksAndRun()" x-text="runBusy ? 'Applying…' : 'Apply & Run'"></button>
    </div>
  </div>

  <!-- Skill suggestion (shown when brief detects a framework with a known skill pack) -->
  <div class="skill-suggestion" x-show="skillSuggestion">
    <div class="skill-suggestion-head">
      <span class="skill-suggestion-title" x-text="(skillSuggestion?.name || '') + ' skills available'"></span>
    </div>
    <div class="skill-suggestion-desc" x-text="skillSuggestion?.description || ''"></div>
    <div class="skill-suggestion-actions">
      <button class="btn" @click="skipSkillsAndRun()">Skip</button>
      <button class="btn primary" :disabled="runBusy" @click="installSkillsAndRun()" x-text="runBusy ? 'Installing…' : 'Install & Run'"></button>
    </div>
  </div>

  <!-- Filter tabs -->
  <div class="filters">
    <button class="filter-btn" :class="{active: filter === 'active'}" @click="filter = 'active'">
      Active <span class="count" x-text="counts.active"></span>
    </button>
    <button class="filter-btn" :class="{active: filter === 'failed'}" @click="filter = 'failed'">
      Failed <span class="count" x-text="counts.failed"></span>
    </button>
    <button class="filter-btn" :class="{active: filter === 'done'}" @click="filter = 'done'">
      Done <span class="count" x-text="counts.done"></span>
    </button>
    <button class="filter-btn" :class="{active: filter === 'all'}" @click="filter = 'all'">
      All <span class="count" x-text="counts.all"></span>
    </button>
    <div class="filter-spacer"></div>
    <input type="text" class="search" x-model="search" placeholder="Search tasks... (press /)">
    <button class="btn danger" @click="deleteAllVisible()" x-show="filteredTasks.length > 0" :title="'Delete all ' + filteredTasks.length + ' visible tasks'">Clear</button>
  </div>

  <!-- Task list -->
  <div class="task-list">
    <template x-for="t in filteredTasks" :key="t.identifier">
      <div class="task" :class="{
          done: isDone(t),
          running: isRunning(t),
          failed: hasFailed(t),
          child: t._depth > 0
        }" :style="t._depth > 0 ? 'margin-left:' + (t._depth * 1.5) + 'rem' : ''" @click="openTask(t)">
        <div class="state-dot" :class="stateClass(t)"></div>
        <div class="task-title" x-text="t.title"></div>

        <span class="blocked-tag" x-show="(t.blockedBy?.length || 0) > 0" :title="'Blocked by: ' + t.blockedBy.map(b => b.identifier).join(', ')">blocked</span>
        <span class="failed-tag" x-show="hasFailed(t)">failed</span>

        <div class="task-meta" x-text="timeAgo(t.updatedAt || t.createdAt)"></div>

        <div class="task-actions" @click.stop>
          <template x-if="!t._historical && !isDone(t)">
            <a class="icon-btn" :href="'/preview/' + encodeURIComponent(t.identifier) + '/'" target="_blank" title="Preview" @click.stop>◎</a>
          </template>
          <template x-if="isRunning(t)">
            <button class="icon-btn" @click="stopRun(t.identifier)" title="Stop">■</button>
          </template>
          <template x-if="!isRunning(t) && t.state === 'todo'">
            <button class="icon-btn" @click="setState(t, 'in-progress')" title="Start">▶</button>
          </template>
          <template x-if="!isRunning(t) && t.state === 'in-progress'">
            <button class="icon-btn" @click="setState(t, 'done')" title="Mark done">✓</button>
          </template>
          <template x-if="!isDone(t) && !isRunning(t)">
            <button class="icon-btn danger" @click="deleteTask(t)" title="Delete">✕</button>
          </template>
        </div>
      </div>
    </template>

    <div class="empty" x-show="filteredTasks.length === 0">
      <strong x-text="filter === 'active' ? 'No active tasks' : filter === 'done' ? 'No completed tasks' : 'No tasks yet'"></strong>
      <span x-show="trackerKind === 'files' && filter !== 'done'">Create one above to get started.</span>
    </div>
  </div>

  <!-- Task detail modal -->
  <div class="modal-backdrop" x-show="selected" @click="selected = null" @keydown.escape.window="selected = null">
    <div class="modal" @click.stop x-show="selected" x-transition>
      <div class="modal-head">
        <div>
          <div class="modal-title" x-text="selected?.title"></div>
          <div class="modal-id" x-text="selected?.identifier"></div>
        </div>
        <button class="icon-btn" @click="selected = null">✕</button>
      </div>
      <div class="modal-body" x-show="selected">
        <div class="modal-section">
          <div class="modal-label">Description</div>
          <div class="modal-desc" x-text="selected?.description || ''"></div>
        </div>

        <div class="modal-section" x-show="selected?.blockedBy?.length">
          <div class="modal-label">Blocked by</div>
          <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
            <template x-for="b in selected?.blockedBy || []">
              <span class="blocked-tag" x-text="b.identifier + ' (' + b.state + ')'"></span>
            </template>
          </div>
        </div>

        <div class="modal-section" x-show="selectedRuns.length">
          <div class="modal-label">Run history (<span x-text="selectedRuns.length"></span>)</div>
          <div class="run-list">
            <template x-for="r in selectedRuns" :key="r.id">
              <div>
                <div class="run-item">
                  <span class="status" :class="r.status" x-text="r.status"></span>
                  <span x-text="'attempt ' + r.attempt"></span>
                  <span class="run-meta" x-text="duration(r.durationMs) + ' · ' + timeAgo(r.startedAt)"></span>
                </div>
                <div class="run-error" x-show="r.error && r.status !== 'succeeded'" x-text="r.error"></div>
                <details x-show="r.hookOutput" class="run-hook-output">
                  <summary>Build output</summary>
                  <pre x-text="r.hookOutput"></pre>
                </details>
              </div>
            </template>
          </div>
        </div>
      </div>
      <div class="modal-foot" x-show="trackerKind === 'files' && selected">
        <template x-if="selected && isRunning(selected)">
          <button class="btn danger" @click="stopRun(selected.identifier); selected = null">Stop</button>
        </template>
        <template x-if="selected && !selected?._historical && !isRunning(selected) && selected?.state === 'todo'">
          <button class="btn primary" @click="setState(selected, 'in-progress'); selected = null">Start</button>
        </template>
        <template x-if="selected && !selected?._historical && !isRunning(selected) && selected?.state === 'in-progress'">
          <button class="btn primary" @click="setState(selected, 'done'); selected = null">Mark done</button>
        </template>
        <template x-if="selected && !selected?._historical && !isRunning(selected) && isDone(selected)">
          <button class="btn" @click="setState(selected, 'todo'); selected = null">Reopen</button>
        </template>
        <button class="btn danger" x-show="!isRunning(selected)" @click="deleteTask(selected); selected = null">Delete</button>
      </div>
    </div>
  </div>

</div>

<script>
function app() {
  return {
    status: {},
    tasks: [],
    runs: [],
    running: [],
    retrying: [],
    trackerKind: '',
    activeStates: ['todo','in-progress'],
    terminalStates: ['done','cancelled','wontfix'],
    briefEnabled: false,
    briefMaxRounds: 2,
    connected: false,
    theme: 'dark',
    filter: 'active',
    search: '',
    selected: null,
    newTask: { prompt: '', skipBrief: false },
    brief: null,
    briefGen: 0,
    runBusy: false,
    skillSuggestion: null,  // { framework, name, description, prompt }
    hookSuggestion: null,   // { after_run, prompt }
    _tick: 0,  // force re-render for elapsed time

    async init() {
      // Restore saved theme before first paint; default to dark.
      const saved = localStorage.getItem('caco.theme');
      this.theme = saved === 'light' ? 'light' : 'dark';
      document.documentElement.dataset.theme = this.theme;

      await this.refresh();
      setInterval(() => this.refresh(), 3000);
      setInterval(() => this._tick++, 1000);
      window.addEventListener('keydown', (e) => {
        if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
          e.preventDefault();
          document.querySelector('.search')?.focus();
        }
      });
    },

    toggleTheme() {
      this.theme = this.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = this.theme;
      localStorage.setItem('caco.theme', this.theme);
    },

    async refresh() {
      try {
        const [status, tasks, runs] = await Promise.all([
          this.fetch('/api/v1/status'),
          this.fetch('/api/v1/tasks').catch(() => []),
          this.fetch('/api/v1/runs?limit=100').catch(() => []),
        ]);
        this.status = status;
        this.trackerKind = status.trackerKind || '';
        if (status.activeStates?.length) this.activeStates = status.activeStates;
        if (status.terminalStates?.length) this.terminalStates = status.terminalStates;
        this.briefEnabled = !!status.briefEnabled;
        this.briefMaxRounds = status.briefMaxRounds || 2;
        this.running = status.running || [];
        this.retrying = status.retrying || [];
        this.tasks = tasks;
        this.runs = runs;
        this.connected = true;
      } catch {
        this.connected = false;
      }
    },

    async fetch(url, opts) {
      const r = await fetch(url, opts);
      if (!r.ok) throw new Error(r.statusText);
      return r.json();
    },

    // --- computed ---
    // Synthetic "task" entries built from successful run history. Used for the
    // Done tab so finished work is still visible after the .md file is deleted.
    get historicalDoneTasks() {
      // Find the latest successful run AND the latest run with a prompt for each
      // identifier — sometimes the prompt is only on earlier attempts (e.g. retries
      // that didn't preserve description) but we still want to show what was asked.
      const latestSuccess = new Map();
      const latestPrompt = new Map();
      for (const r of this.runs) {
        if (r.status === 'succeeded') {
          const existing = latestSuccess.get(r.issueIdentifier);
          if (!existing || (r.finishedAt && r.finishedAt > (existing.finishedAt || ''))) {
            latestSuccess.set(r.issueIdentifier, r);
          }
        }
        if (r.prompt) {
          const existing = latestPrompt.get(r.issueIdentifier);
          if (!existing || (r.startedAt && r.startedAt > (existing.startedAt || ''))) {
            latestPrompt.set(r.issueIdentifier, r);
          }
        }
      }
      return Array.from(latestSuccess.values()).map(r => {
        const promptRun = latestPrompt.get(r.issueIdentifier);
        const description = promptRun?.prompt || '';
        // Derive a readable title from the first non-empty line of the prompt
        let title = r.issueIdentifier;
        if (description) {
          const firstLine = description.split('\\n').map(l => l.trim()).find(l => l) || '';
          const cleaned = firstLine.replace(/^#+\s*/, '').slice(0, 80);
          if (cleaned) title = cleaned;
        }
        return {
          id: r.issueId || r.issueIdentifier,
          identifier: r.issueIdentifier,
          title,
          description,
          state: 'done',
          priority: null,
          labels: [],
          blockedBy: [],
          // Recover parent from the run record (prefer the prompt run since
          // both should have it, but fall back to the success run).
          parent: promptRun?.parent || r.parent || null,
          url: null,
          startedAt: r.startedAt,
          updatedAt: r.finishedAt || r.startedAt,
          createdAt: r.startedAt,
          _historical: true,
        };
      });
    },
    // Set of identifiers that have at least one unresolved failure (no subsequent success).
    // Reused by the Failed tab filter and the failedCount getter.
    get _failedIdentifiers() {
      const succeeded = new Set(this.runs.filter(r => r.status === 'succeeded').map(r => r.issueIdentifier));
      const failed = new Set();
      for (const r of this.runs) {
        if ((r.status === 'failed' || r.status === 'timed_out') && !succeeded.has(r.issueIdentifier)) {
          failed.add(r.issueIdentifier);
        }
      }
      return failed;
    },
    get filteredTasks() {
      const term = this.search.toLowerCase().trim();
      let list;
      if (this.filter === 'done') {
        // Done tab pulls from run history, not task files (which are deleted on success).
        list = this.historicalDoneTasks;
      } else if (this.filter === 'active') {
        list = this.tasks.filter(t => this.activeStates.includes(t.state));
      } else if (this.filter === 'failed') {
        // Failed tab: task files with unresolved failures, excluding tasks that
        // are currently running (those show in Active instead — they're being
        // retried, not stuck).
        const failedIds = this._failedIdentifiers;
        list = this.tasks.filter(t => failedIds.has(t.identifier) && !this.isRunning(t));
      } else {
        // 'all': merge active task files with historical done runs
        const activeIds = new Set(this.tasks.map(t => t.identifier));
        const historical = this.historicalDoneTasks.filter(t => !activeIds.has(t.identifier));
        list = [...this.tasks, ...historical];
      }
      if (term) list = list.filter(t =>
        (t.title || '').toLowerCase().includes(term) ||
        (t.identifier || '').toLowerCase().includes(term) ||
        (t.description || '').toLowerCase().includes(term)
      );

      const sortFn = (a, b) => {
        const ar = this.isRunning(a) ? 0 : 1;
        const br = this.isRunning(b) ? 0 : 1;
        if (ar !== br) return ar - br;
        const pa = a.priority ?? 999;
        const pb = b.priority ?? 999;
        if (pa !== pb) return pa - pb;
        return (a.identifier || '').localeCompare(b.identifier || '');
      };

      // Group by parent so children render under their parent (flattened, with depth).
      const byId = new Map(list.map(t => [t.identifier, t]));
      const childrenOf = new Map();
      for (const t of list) {
        if (t.parent && byId.has(t.parent)) {
          if (!childrenOf.has(t.parent)) childrenOf.set(t.parent, []);
          childrenOf.get(t.parent).push(t);
        }
      }
      const topLevel = list.filter(t => !t.parent || !byId.has(t.parent)).sort(sortFn);
      const result = [];
      const visited = new Set();
      const emit = (task, depth) => {
        if (visited.has(task.identifier)) return;
        visited.add(task.identifier);
        result.push({ ...task, _depth: depth });
        const kids = (childrenOf.get(task.identifier) || []).slice().sort(sortFn);
        for (const kid of kids) emit(kid, depth + 1);
      };
      for (const t of topLevel) emit(t, 0);
      return result;
    },
    get counts() {
      const active = this.tasks.filter(t => this.activeStates.includes(t.state)).length;
      const failed = this.tasks.filter(t => this._failedIdentifiers.has(t.identifier)).length;
      const done = this.historicalDoneTasks.length;
      const activeIds = new Set(this.tasks.map(t => t.identifier));
      const historicalUnique = this.historicalDoneTasks.filter(t => !activeIds.has(t.identifier)).length;
      return {
        active,
        failed,
        done,
        all: this.tasks.length + historicalUnique,
      };
    },
    get succeededCount() {
      const seen = new Set();
      let n = 0;
      for (const r of this.runs) {
        if (r.status === 'succeeded' && !seen.has(r.issueIdentifier)) {
          seen.add(r.issueIdentifier);
          n++;
        }
      }
      return n;
    },
    get failedCount() {
      // Count unique task identifiers that have at least one failed/timed_out
      // run and have NOT yet succeeded. Don't exclude currently-running tasks
      // — a task being retried should stay in the failed count until it
      // actually succeeds, not flicker to 0 every time a retry starts.
      const succeeded = new Set(this.runs.filter(r => r.status === 'succeeded').map(r => r.issueIdentifier));
      const seen = new Set();
      let n = 0;
      for (const r of this.runs) {
        if ((r.status === 'failed' || r.status === 'timed_out')
            && !succeeded.has(r.issueIdentifier)
            && !seen.has(r.issueIdentifier)) {
          seen.add(r.issueIdentifier);
          n++;
        }
      }
      return n;
    },
    get selectedRuns() {
      if (!this.selected) return [];
      return this.runs.filter(r => r.issueIdentifier === this.selected.identifier);
    },

    // --- helpers ---
    isDone(t) { return this.terminalStates.includes(t.state); },
    isRunning(t) {
      return this.running.some(r => r.identifier === t.identifier || r.issueId === t.id);
    },
    hasFailed(t) {
      if (this.isDone(t) || this.isRunning(t)) return false;
      const latest = this.runs.find(r => r.issueIdentifier === t.identifier);
      return latest && (latest.status === 'failed' || latest.status === 'timed_out');
    },
    stateClass(t) {
      if (this.isRunning(t)) return 'running';
      return t.state;
    },

    timeAgo(iso) {
      this._tick; // reactivity
      if (!iso) return '';
      const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
      if (s < 60) return s + 's ago';
      if (s < 3600) return Math.floor(s/60) + 'm ago';
      if (s < 86400) return Math.floor(s/3600) + 'h ago';
      return Math.floor(s/86400) + 'd ago';
    },
    duration(ms) {
      if (ms == null) return '—';
      const s = Math.floor(ms / 1000);
      const m = Math.floor(s / 60);
      if (m > 0) return m + 'm ' + (s % 60) + 's';
      return s + 's';
    },

    // --- actions ---
    openTask(t) {
      this.selected = t;
    },

    async runTask() {
      const prompt = (this.newTask.prompt || '').trim();
      if (!prompt || this.runBusy) return;

      // Skip brief: either the user checked the box, or brief is disabled in config.
      if (!this.briefEnabled || this.newTask.skipBrief) {
        await this.submitTask(prompt);
        return;
      }

      // Kick off a brief round with just the user's prompt. The gen counter
      // lets us discard the result if the user cancels or skips mid-flight.
      this.runBusy = true;
      const gen = ++this.briefGen;
      try {
        const result = await this.briefCall([{ role: 'user', content: prompt }]);
        if (gen !== this.briefGen) return;
        await this.handleBriefResult(result, prompt, [{ role: 'user', content: prompt }]);
      } finally {
        if (gen === this.briefGen) this.runBusy = false;
      }
    },

    async briefCall(transcript) {
      try {
        const r = await fetch('/api/v1/brief', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ transcript }),
        });
        if (!r.ok) throw new Error('brief failed');
        return await r.json();
      } catch (e) {
        // Brief endpoint unavailable or failed — degrade gracefully.
        return { status: 'ready', title: '', prompt: transcript[0].content, round: 1, maxRounds: this.briefMaxRounds };
      }
    },

    // Known skill packs — mirrors the server-side SKILL_REGISTRY so the
    // dashboard can show a suggestion without an extra API call.
    _skillPacks: {
      defold: { name: 'Defold Agent Config', description: '13 skills for Defold: proto editing, API docs, shaders, project build' },
    },

    async handleBriefResult(result, originalPrompt, transcript) {
      if (result.status === 'ready') {
        this.brief = null;
        // Check if the brief detected a framework that has a known skill pack
        const frameworks = result.frameworks || [];
        for (const fw of frameworks) {
          const pack = this._skillPacks[fw];
          if (pack) {
            // Check if skills are already installed
            try {
              const check = await fetch('/api/v1/skills/status');
              const status = await check.json();
              if (!status.installed) {
                // Show skill suggestion — pause before creating the task
                this.skillSuggestion = {
                  framework: fw,
                  name: pack.name,
                  description: pack.description,
                  prompt: result.prompt || originalPrompt,
                };
                return;
              }
            } catch {
              // skills status check failed — proceed without suggestion
            }
          }
        }
        // Check if the brief suggested verification hooks and we don't have any yet
        if (result.suggestedHooks?.after_run && !this.hookSuggestion) {
          // Show hook suggestion — pause before creating the task
          this.hookSuggestion = {
            after_run: result.suggestedHooks.after_run,
            prompt: result.prompt || originalPrompt,
          };
          return;
        }
        await this.submitTask(result.prompt || originalPrompt);
        return;
      }
      // clarify: open / update the brief modal. Each question gets an
      // {choice, other} pair — choice is the selected option (or '__other__'
      // if the user chose the free-text fallback); other is the typed text.
      const questions = result.questions || [];
      this.brief = {
        originalPrompt,
        transcript,
        questions,
        answers: questions.map((q) => ({
          choice: q.options && q.options.length > 0 ? '' : '__other__',
          other: '',
        })),
        round: result.round || 1,
      };
    },

    // Resolve a question's answer to a single string. Preference order:
    //   1. if the user picked a concrete option, use that option's text
    //   2. otherwise if they typed into the "other" field, use that
    //   3. otherwise, empty
    _resolveBriefAnswer(i) {
      const a = this.brief.answers[i];
      if (!a) return '';
      if (a.choice && a.choice !== '__other__') return a.choice;
      return (a.other || '').trim();
    },

    async continueBrief() {
      if (!this.brief || this.runBusy) return;
      this.runBusy = true;
      const gen = ++this.briefGen;
      try {
        const answersText = this.brief.questions
          .map((q, i) => 'Q: ' + q.question + '\\nA: ' + this._resolveBriefAnswer(i))
          .join('\\n\\n');
        const nextTranscript = [
          ...this.brief.transcript,
          { role: 'assistant', content: JSON.stringify({ status: 'clarify', questions: this.brief.questions }) },
          { role: 'user', content: answersText },
        ];
        const result = await this.briefCall(nextTranscript);
        if (gen !== this.briefGen) return;
        await this.handleBriefResult(result, this.brief.originalPrompt, nextTranscript);
      } finally {
        if (gen === this.briefGen) this.runBusy = false;
      }
    },

    async skipBriefNow() {
      if (!this.brief) return;
      // Invalidate any in-flight brief call so its result can't fire handleBriefResult.
      this.briefGen++;
      this.runBusy = false;
      const { originalPrompt } = this.brief;
      this.brief = null;
      await this.submitTask(originalPrompt);
    },

    async applyHooksAndRun() {
      if (!this.hookSuggestion) return;
      const { after_run, prompt } = this.hookSuggestion;
      this.runBusy = true;
      try {
        await fetch('/api/v1/config/hooks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ after_run }),
        });
      } catch {
        // Apply failed — proceed anyway
      }
      this.hookSuggestion = null;
      this.runBusy = false;
      await this.submitTask(prompt);
    },

    async skipHooksAndRun() {
      if (!this.hookSuggestion) return;
      const { prompt } = this.hookSuggestion;
      this.hookSuggestion = null;
      await this.submitTask(prompt);
    },

    async installSkillsAndRun() {
      if (!this.skillSuggestion) return;
      const { framework, prompt } = this.skillSuggestion;
      this.runBusy = true;
      try {
        await fetch('/api/v1/skills/install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ framework }),
        });
      } catch (e) {
        // Install failed — proceed anyway, gate will catch issues
      }
      this.skillSuggestion = null;
      this.runBusy = false;
      await this.submitTask(prompt);
    },

    async skipSkillsAndRun() {
      if (!this.skillSuggestion) return;
      const { prompt } = this.skillSuggestion;
      this.skillSuggestion = null;
      await this.submitTask(prompt);
    },

    cancelBrief() {
      // Invalidate any in-flight brief call and clear any pending suggestions.
      this.briefGen++;
      this.runBusy = false;
      this.brief = null;
      this.skillSuggestion = null;
      this.hookSuggestion = null;
    },

    async submitTask(prompt) {
      await this.fetch('/api/v1/tasks', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ prompt }),
      });
      this.newTask = { prompt: '', skipBrief: false };
      await this.refresh();
    },

    async setState(t, state) {
      await this.fetch('/api/v1/tasks/' + encodeURIComponent(t.identifier) + '/state', {
        method: 'PUT', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ state }),
      });
      await this.refresh();
    },

    async deleteTask(t) {
      if (!confirm('Delete ' + t.identifier + '?')) return;
      await this.fetch('/api/v1/tasks/' + encodeURIComponent(t.identifier), { method: 'DELETE' });
      await this.refresh();
    },

    async deleteAllVisible() {
      const targets = this.filteredTasks.slice();
      if (targets.length === 0) return;
      const label = this.filter === 'active'
        ? 'all ' + targets.length + ' active task' + (targets.length === 1 ? '' : 's')
        : this.filter === 'done'
          ? 'all ' + targets.length + ' completed task' + (targets.length === 1 ? '' : 's') + ' from history'
          : 'all ' + targets.length + ' task' + (targets.length === 1 ? '' : 's');
      if (!confirm('Delete ' + label + '? This cannot be undone.')) return;
      await Promise.all(targets.map(t =>
        this.fetch('/api/v1/tasks/' + encodeURIComponent(t.identifier), { method: 'DELETE' }).catch(() => {})
      ));
      await this.refresh();
    },

    async stopRun(identifier) {
      await this.fetch('/api/v1/stop/' + encodeURIComponent(identifier), { method: 'POST' });
      await this.refresh();
    },
  };
}
</script>
</body></html>`;
}
