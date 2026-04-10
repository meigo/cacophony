export function dashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cacophony</title>
<script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.14.1/dist/cdn.min.js"></script>
<style>
  :root {
    --bg: #0d1117;
    --bg-elev: #161b22;
    --bg-hover: #1c2129;
    --border: #21262d;
    --border-strong: #30363d;
    --text: #c9d1d9;
    --text-dim: #8b949e;
    --text-faint: #484f58;
    --accent: #58a6ff;
    --green: #3fb950;
    --yellow: #d29922;
    --red: #f85149;
    --purple: #bc8cff;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: var(--bg); color: var(--text); font-family: system-ui, -apple-system, sans-serif; font-size: 14px; }
  body { max-width: 1100px; margin: 0 auto; padding: 1.5rem; min-height: 100vh; }
  button { font: inherit; color: inherit; cursor: pointer; border: none; background: none; }
  input, textarea, select { font: inherit; color: inherit; }

  /* Header */
  header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem; }
  h1 { font-size: 1.3rem; color: var(--accent); letter-spacing: -0.02em; }
  h1 .tracker-badge {
    font-size: 0.65rem; font-weight: 500; color: var(--text-dim); text-transform: uppercase;
    margin-left: 0.5rem; padding: 2px 8px; background: var(--bg-elev); border: 1px solid var(--border);
    border-radius: 10px; letter-spacing: 0.05em;
  }
  .conn {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 4px 10px; border-radius: 12px; font-size: 0.7rem; font-weight: 600;
    background: var(--bg-elev); border: 1px solid var(--border);
  }
  .conn-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--text-faint); }
  .conn.live .conn-dot { background: var(--green); box-shadow: 0 0 6px var(--green); }
  .conn.dead .conn-dot { background: var(--red); }

  /* Stats */
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.5rem; margin-bottom: 1.5rem; }
  .stat {
    background: var(--bg-elev); border: 1px solid var(--border); border-radius: 8px;
    padding: 0.75rem 1rem;
  }
  .stat-label { font-size: 0.65rem; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em; }
  .stat-value { font-size: 1.6rem; font-weight: 700; margin-top: 2px; font-variant-numeric: tabular-nums; }

  /* Create task */
  .creator {
    background: var(--bg-elev); border: 1px solid var(--border); border-radius: 8px;
    padding: 0.75rem; margin-bottom: 1.5rem;
  }
  .creator-row { display: flex; gap: 0.5rem; align-items: center; }
  .creator input[type="text"] {
    flex: 1; background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
    padding: 8px 12px; color: var(--text);
  }
  .creator input:focus, .creator textarea:focus, .creator select:focus { outline: none; border-color: var(--accent); }
  .creator select {
    background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
    padding: 8px 10px; color: var(--text);
  }
  .creator textarea {
    display: block; width: 100%; min-height: 60px; resize: vertical; font-family: inherit;
    background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
    padding: 8px 12px; color: var(--text); margin-top: 0.5rem;
  }
  .creator-expand { margin-top: 0.5rem; display: flex; gap: 0.5rem; align-items: center; }

  /* Filter tabs */
  .filters { display: flex; gap: 2px; margin-bottom: 1rem; border-bottom: 1px solid var(--border); }
  .filter-btn {
    padding: 8px 16px; font-size: 0.85rem; font-weight: 500; color: var(--text-dim);
    border-bottom: 2px solid transparent; transition: all 0.15s;
  }
  .filter-btn:hover { color: var(--text); }
  .filter-btn.active { color: var(--accent); border-bottom-color: var(--accent); }
  .filter-btn .count {
    margin-left: 6px; padding: 1px 6px; border-radius: 8px; background: var(--bg-elev);
    font-size: 0.7rem; font-variant-numeric: tabular-nums;
  }
  .filter-spacer { flex: 1; }
  .search {
    background: var(--bg-elev); border: 1px solid var(--border); border-radius: 6px;
    padding: 6px 10px; color: var(--text); font-size: 0.8rem; width: 200px;
    margin-bottom: 4px;
  }
  .search:focus { outline: none; border-color: var(--accent); }

  /* Section headers */
  .section-head {
    display: flex; align-items: center; gap: 0.5rem;
    font-size: 0.75rem; font-weight: 600; color: var(--text-dim);
    text-transform: uppercase; letter-spacing: 0.05em;
    margin: 1rem 0 0.5rem;
  }
  .section-head .count { color: var(--text-faint); }

  /* Task cards */
  .task-list { display: flex; flex-direction: column; gap: 4px; }
  .task {
    display: flex; align-items: center; gap: 0.75rem;
    padding: 0.7rem 0.9rem; border-radius: 6px;
    background: var(--bg-elev); border: 1px solid var(--border);
    transition: all 0.15s; cursor: pointer;
  }
  .task:hover { background: var(--bg-hover); border-color: var(--border-strong); }
  .task.done { opacity: 0.55; }
  .task.running { border-color: var(--green); }
  .task.failed { border-color: var(--red); }
  .task .state-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
  .task .state-dot.todo { background: var(--accent); }
  .task .state-dot.in-progress { background: var(--yellow); }
  .task .state-dot.done { background: var(--green); }
  .task .state-dot.cancelled,
  .task .state-dot.wontfix { background: var(--text-faint); }
  .task .state-dot.running {
    background: var(--green); box-shadow: 0 0 0 0 var(--green);
    animation: pulse 2s infinite;
  }
  @keyframes pulse {
    0% { box-shadow: 0 0 0 0 rgba(63,185,80,0.4); }
    70% { box-shadow: 0 0 0 6px rgba(63,185,80,0); }
    100% { box-shadow: 0 0 0 0 rgba(63,185,80,0); }
  }
  .task-id {
    font-family: ui-monospace, monospace; font-size: 0.75rem; font-weight: 600;
    color: var(--text-dim); min-width: 90px; flex-shrink: 0;
  }
  .task-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .task-meta { font-size: 0.7rem; color: var(--text-faint); white-space: nowrap; }
  .priority-badge {
    font-family: ui-monospace, monospace; font-size: 0.65rem; font-weight: 700;
    padding: 1px 6px; border-radius: 4px; background: var(--bg); color: var(--text-dim);
    border: 1px solid var(--border);
  }
  .priority-badge.p1 { color: var(--red); border-color: var(--red); }
  .priority-badge.p2 { color: var(--yellow); border-color: var(--yellow); }
  .priority-badge.p3 { color: var(--accent); }
  .blockers-icon { color: var(--yellow); font-size: 0.7rem; }
  .task-actions { display: flex; gap: 4px; opacity: 0; transition: opacity 0.15s; }
  .task:hover .task-actions { opacity: 1; }
  .icon-btn {
    width: 24px; height: 24px; border-radius: 4px; display: inline-flex;
    align-items: center; justify-content: center; font-size: 12px;
    color: var(--text-dim); transition: all 0.15s;
  }
  .icon-btn:hover { background: var(--border); color: var(--text); }
  .icon-btn.danger:hover { background: var(--red); color: #fff; }

  /* Empty states */
  .empty {
    text-align: center; padding: 2rem 1rem; color: var(--text-faint);
    background: var(--bg-elev); border: 1px dashed var(--border); border-radius: 8px;
    font-size: 0.85rem;
  }
  .empty strong { color: var(--text-dim); display: block; margin-bottom: 0.25rem; }

  /* Modal */
  .modal-backdrop {
    position: fixed; inset: 0; background: rgba(0,0,0,0.6);
    display: flex; align-items: center; justify-content: center; padding: 2rem;
    z-index: 100; backdrop-filter: blur(4px);
  }
  .modal {
    background: var(--bg-elev); border: 1px solid var(--border-strong);
    border-radius: 12px; width: 100%; max-width: 720px; max-height: 90vh;
    display: flex; flex-direction: column; overflow: hidden;
  }
  .modal-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 1rem 1.25rem; border-bottom: 1px solid var(--border);
  }
  .modal-title { font-size: 1rem; font-weight: 600; }
  .modal-id { font-family: ui-monospace, monospace; font-size: 0.75rem; color: var(--text-dim); }
  .modal-body { padding: 1.25rem; overflow-y: auto; flex: 1; }
  .modal-section { margin-bottom: 1.25rem; }
  .modal-label { font-size: 0.7rem; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.4rem; }
  .modal-desc {
    white-space: pre-wrap; font-size: 0.85rem; line-height: 1.5;
    background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
    padding: 0.75rem 1rem; color: var(--text-dim);
    max-height: 300px; overflow-y: auto;
  }
  .modal-desc:empty::before { content: "No description"; color: var(--text-faint); font-style: italic; }
  .modal-foot {
    display: flex; gap: 0.5rem; justify-content: flex-end;
    padding: 1rem 1.25rem; border-top: 1px solid var(--border); background: var(--bg);
  }
  .btn {
    padding: 6px 14px; border-radius: 6px; font-size: 0.8rem; font-weight: 500;
    background: var(--bg-elev); border: 1px solid var(--border); color: var(--text);
  }
  .btn:hover { background: var(--border); }
  .btn.primary { background: #1f6feb; border-color: #1f6feb; color: #fff; }
  .btn.primary:hover { background: #388bfd; }
  .btn.danger { color: var(--red); border-color: var(--red); }
  .btn.danger:hover { background: var(--red); color: #fff; }

  /* Run history */
  .run-list { display: flex; flex-direction: column; gap: 4px; }
  .run-item {
    display: flex; align-items: center; gap: 0.75rem;
    padding: 0.5rem 0.75rem; border-radius: 6px;
    background: var(--bg); border: 1px solid var(--border);
    font-size: 0.75rem;
  }
  .run-item .status {
    font-weight: 600; padding: 1px 8px; border-radius: 10px;
    text-transform: capitalize;
  }
  .run-item .status.succeeded { background: rgba(63,185,80,0.15); color: var(--green); }
  .run-item .status.running { background: rgba(63,185,80,0.15); color: var(--green); }
  .run-item .status.failed { background: rgba(248,81,73,0.15); color: var(--red); }
  .run-item .status.timed_out { background: rgba(210,153,34,0.15); color: var(--yellow); }
  .run-item .status.canceled { background: rgba(139,148,158,0.15); color: var(--text-dim); }
  .run-meta { color: var(--text-faint); margin-left: auto; font-variant-numeric: tabular-nums; }
  .run-error {
    font-family: ui-monospace, monospace; font-size: 0.7rem; color: var(--red);
    margin-top: 4px; padding: 4px 8px; background: rgba(248,81,73,0.08); border-radius: 4px;
    white-space: pre-wrap; word-break: break-word;
  }

  /* Running/retry badges in section */
  .running-banner {
    background: var(--bg-elev); border: 1px solid var(--green); border-radius: 8px;
    padding: 0.75rem 1rem; margin-bottom: 1rem; display: flex; align-items: center; gap: 0.75rem;
  }
  .running-banner .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--green); animation: pulse 2s infinite; }
  .running-banner-label { font-size: 0.7rem; font-weight: 600; color: var(--green); text-transform: uppercase; letter-spacing: 0.05em; }
  .running-banner-items { display: flex; gap: 0.5rem; margin-top: 0.5rem; flex-wrap: wrap; }
  .running-banner-item {
    display: flex; align-items: center; gap: 0.5rem;
    padding: 4px 10px; background: var(--bg); border-radius: 12px;
    font-size: 0.75rem; border: 1px solid var(--border);
  }
  .running-banner-item .id { font-family: ui-monospace, monospace; font-weight: 600; color: var(--green); }

  /* Keyboard hint */
  kbd {
    background: var(--bg); border: 1px solid var(--border-strong);
    border-radius: 3px; padding: 1px 5px; font-family: ui-monospace, monospace;
    font-size: 0.7rem; color: var(--text-dim);
  }

  /* Utilities */
  .hidden { display: none !important; }
  [x-cloak] { display: none !important; }
</style>
</head><body>

<div x-data="app()" x-init="init()" x-cloak>

  <header>
    <h1>Cacophony <span class="tracker-badge" x-text="trackerKind || 'loading'"></span></h1>
    <div class="conn" :class="{live: connected, dead: !connected}">
      <span class="conn-dot"></span>
      <span x-text="connected ? 'live' : 'offline'"></span>
    </div>
  </header>

  <!-- Stats -->
  <div class="stats">
    <div class="stat">
      <div class="stat-label">Running</div>
      <div class="stat-value" style="color: var(--green)" x-text="running.length"></div>
    </div>
    <div class="stat">
      <div class="stat-label">Retrying</div>
      <div class="stat-value" style="color: var(--yellow)" x-text="retrying.length"></div>
    </div>
    <div class="stat">
      <div class="stat-label">Succeeded</div>
      <div class="stat-value" style="color: var(--accent)" x-text="succeededCount"></div>
    </div>
    <div class="stat">
      <div class="stat-label">Failed</div>
      <div class="stat-value" style="color: var(--red)" x-text="failedCount"></div>
    </div>
  </div>

  <!-- Running banner -->
  <div class="running-banner" x-show="running.length">
    <div>
      <div class="running-banner-label">
        <span class="dot" style="display:inline-block; vertical-align: middle; margin-right: 6px;"></span>
        <span x-text="running.length + ' agent(s) running'"></span>
      </div>
      <div class="running-banner-items">
        <template x-for="r in running" :key="r.issueId">
          <div class="running-banner-item">
            <span class="id" x-text="r.identifier"></span>
            <span x-text="r.title || ''"></span>
            <span style="color: var(--text-faint); font-variant-numeric: tabular-nums;" x-text="elapsed(r.startedAt)"></span>
            <button class="icon-btn danger" @click="stopRun(r.identifier)" title="Stop">✕</button>
          </div>
        </template>
      </div>
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
        <div class="modal-section">
          <div class="modal-label">A few clarifying questions</div>
          <template x-for="(q, i) in (brief?.questions || [])" :key="i">
            <div style="margin-bottom: 0.75rem;">
              <div style="font-size: 0.9rem; margin-bottom: 0.25rem;" x-text="q"></div>
              <textarea x-model="brief.answers[i]" rows="2" style="width:100%;" placeholder="Your answer..."></textarea>
            </div>
          </template>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn" @click="cancelBrief()">Cancel</button>
        <button class="btn" @click="skipBriefNow()">Skip, run as-is</button>
        <button class="btn primary" :disabled="runBusy" @click="continueBrief()" x-text="runBusy ? 'Refining…' : 'Continue'"></button>
      </div>
    </div>
  </div>

  <!-- Filter tabs -->
  <div class="filters">
    <button class="filter-btn" :class="{active: filter === 'active'}" @click="filter = 'active'">
      Active <span class="count" x-text="counts.active"></span>
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
        <div class="task-id" x-text="t.identifier"></div>
        <div class="task-title" x-text="t.title"></div>

        <span class="blockers-icon" x-show="(t.blockedBy?.length || 0) > 0" :title="'Blocked by: ' + t.blockedBy.map(b => b.identifier).join(', ')">
          ⛔
        </span>

        <div class="priority-badge" :class="'p' + t.priority" x-show="t.priority" x-text="'P' + t.priority"></div>

        <div class="task-meta" x-text="timeAgo(t.updatedAt || t.createdAt)"></div>

        <div class="task-actions" @click.stop>
          <template x-if="t.state === 'todo'">
            <button class="icon-btn" @click="setState(t, 'in-progress')" title="Start">▶</button>
          </template>
          <template x-if="t.state === 'in-progress'">
            <button class="icon-btn" @click="setState(t, 'done')" title="Mark done">✓</button>
          </template>
          <template x-if="!isDone(t)">
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
              <span class="priority-badge" x-text="b.identifier + ' (' + b.state + ')'"></span>
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
              </div>
            </template>
          </div>
        </div>
      </div>
      <div class="modal-foot" x-show="trackerKind === 'files' && selected">
        <template x-if="selected && !selected?._historical && selected?.state === 'todo'">
          <button class="btn primary" @click="setState(selected, 'in-progress'); selected = null">Start</button>
        </template>
        <template x-if="selected && !selected?._historical && selected?.state === 'in-progress'">
          <button class="btn primary" @click="setState(selected, 'done'); selected = null">Mark done</button>
        </template>
        <template x-if="selected && !selected?._historical && isDone(selected)">
          <button class="btn" @click="setState(selected, 'todo'); selected = null">Reopen</button>
        </template>
        <button class="btn danger" @click="deleteTask(selected); selected = null">Delete</button>
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
    filter: 'active',
    search: '',
    selected: null,
    newTask: { prompt: '', priority: '', skipBrief: false },
    brief: null,
    runBusy: false,
    _tick: 0,  // force re-render for elapsed time

    async init() {
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
          parent: null,
          url: null,
          startedAt: r.startedAt,
          updatedAt: r.finishedAt || r.startedAt,
          createdAt: r.startedAt,
          _historical: true,
        };
      });
    },
    get filteredTasks() {
      const term = this.search.toLowerCase().trim();
      let list;
      if (this.filter === 'done') {
        // Done tab pulls from run history, not task files (which are deleted on success).
        list = this.historicalDoneTasks;
      } else if (this.filter === 'active') {
        list = this.tasks.filter(t => this.activeStates.includes(t.state));
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
      const done = this.historicalDoneTasks.length;
      const activeIds = new Set(this.tasks.map(t => t.identifier));
      const historicalUnique = this.historicalDoneTasks.filter(t => !activeIds.has(t.identifier)).length;
      return {
        active,
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
      const runningIds = new Set(this.running.map(r => r.identifier));
      const succeeded = new Set(this.runs.filter(r => r.status === 'succeeded').map(r => r.issueIdentifier));
      const seen = new Set();
      let n = 0;
      for (const r of this.runs) {
        if ((r.status === 'failed' || r.status === 'timed_out')
            && !succeeded.has(r.issueIdentifier)
            && !runningIds.has(r.issueIdentifier)
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
    elapsed(iso) {
      this._tick; // reactivity
      if (!iso) return '';
      const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
      const m = Math.floor(s / 60);
      const sec = s % 60;
      if (m > 0) return m + 'm ' + sec + 's';
      return sec + 's';
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
      const priority = this.newTask.priority ? Number(this.newTask.priority) : null;

      // Skip brief: either the user checked the box, or brief is disabled in config.
      if (!this.briefEnabled || this.newTask.skipBrief) {
        await this.submitTask(prompt, priority);
        return;
      }

      // Kick off a brief round with just the user's prompt.
      this.runBusy = true;
      try {
        const result = await this.briefCall([{ role: 'user', content: prompt }]);
        await this.handleBriefResult(result, prompt, priority, [{ role: 'user', content: prompt }]);
      } finally {
        this.runBusy = false;
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

    async handleBriefResult(result, originalPrompt, priority, transcript) {
      if (result.status === 'ready') {
        this.brief = null;
        await this.submitTask(result.prompt || originalPrompt, priority);
        return;
      }
      // clarify: open / update the brief modal
      this.brief = {
        originalPrompt,
        priority,
        transcript,
        questions: result.questions || [],
        answers: new Array((result.questions || []).length).fill(''),
        round: result.round || 1,
      };
    },

    async continueBrief() {
      if (!this.brief || this.runBusy) return;
      this.runBusy = true;
      try {
        const answersText = this.brief.questions
          .map((q, i) => 'Q: ' + q + '\\nA: ' + (this.brief.answers[i] || '').trim())
          .join('\\n\\n');
        const nextTranscript = [
          ...this.brief.transcript,
          { role: 'assistant', content: JSON.stringify({ status: 'clarify', questions: this.brief.questions }) },
          { role: 'user', content: answersText },
        ];
        const result = await this.briefCall(nextTranscript);
        await this.handleBriefResult(result, this.brief.originalPrompt, this.brief.priority, nextTranscript);
      } finally {
        this.runBusy = false;
      }
    },

    async skipBriefNow() {
      if (!this.brief) return;
      const { originalPrompt, priority } = this.brief;
      this.brief = null;
      await this.submitTask(originalPrompt, priority);
    },

    cancelBrief() {
      this.brief = null;
    },

    async submitTask(prompt, priority) {
      const body = { prompt, priority };
      await this.fetch('/api/v1/tasks', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify(body),
      });
      this.newTask = { prompt: '', priority: '', skipBrief: false };
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
