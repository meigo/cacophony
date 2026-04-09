export function dashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cacophony</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: system-ui, -apple-system, sans-serif;
    background: #0d1117; color: #c9d1d9;
    max-width: 960px; margin: 0 auto; padding: 1.5rem;
  }
  header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem; }
  h1 { font-size: 1.4rem; color: #58a6ff; }
  .pill {
    display: inline-block; padding: 2px 10px; border-radius: 12px;
    font-size: 0.75rem; font-weight: 600;
  }
  .pill-green { background: #238636; color: #fff; }
  .pill-yellow { background: #9e6a03; color: #fff; }
  .pill-gray { background: #30363d; color: #8b949e; }
  .pill-red { background: #da3633; color: #fff; }
  .pill-blue { background: #1f6feb; color: #fff; }

  .stats { display: flex; gap: 0.75rem; margin-bottom: 1.5rem; flex-wrap: wrap; }
  .stat {
    background: #161b22; border: 1px solid #30363d; border-radius: 8px;
    padding: 0.75rem 1rem; min-width: 120px; flex: 1;
  }
  .stat-label { font-size: 0.7rem; color: #8b949e; text-transform: uppercase; letter-spacing: 0.05em; }
  .stat-value { font-size: 1.5rem; font-weight: 700; margin-top: 2px; }

  .section { margin-bottom: 1.5rem; }
  .section-title {
    font-size: 0.85rem; font-weight: 600; color: #8b949e;
    text-transform: uppercase; letter-spacing: 0.05em;
    margin-bottom: 0.5rem; padding-bottom: 0.5rem;
    border-bottom: 1px solid #21262d;
  }

  .task-list { list-style: none; }
  .task-item {
    display: flex; align-items: center; gap: 0.75rem;
    padding: 0.6rem 0.75rem; border-radius: 6px;
    border: 1px solid #21262d; margin-bottom: 0.4rem;
    background: #161b22; transition: background 0.15s;
  }
  .task-item:hover { background: #1c2129; }
  .task-id { font-weight: 600; color: #58a6ff; min-width: 80px; font-size: 0.85rem; }
  .task-title { flex: 1; font-size: 0.85rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .task-meta { font-size: 0.7rem; color: #8b949e; white-space: nowrap; }
  .task-actions { display: flex; gap: 4px; }
  .btn {
    padding: 3px 8px; border-radius: 4px; border: 1px solid #30363d;
    background: #21262d; color: #c9d1d9; cursor: pointer; font-size: 0.7rem;
    transition: background 0.15s;
  }
  .btn:hover { background: #30363d; }
  .btn-danger { border-color: #da3633; color: #f85149; }
  .btn-danger:hover { background: #da3633; color: #fff; }
  .btn-primary { border-color: #1f6feb; color: #58a6ff; }
  .btn-primary:hover { background: #1f6feb; color: #fff; }

  .add-form {
    background: #161b22; border: 1px solid #30363d; border-radius: 8px;
    padding: 1rem; margin-bottom: 1.5rem;
  }
  .add-form summary {
    cursor: pointer; font-size: 0.85rem; font-weight: 600; color: #58a6ff;
  }
  .form-row { display: flex; gap: 0.5rem; margin-top: 0.75rem; flex-wrap: wrap; }
  .form-input {
    background: #0d1117; border: 1px solid #30363d; border-radius: 4px;
    padding: 6px 10px; color: #c9d1d9; font-size: 0.85rem; flex: 1; min-width: 140px;
  }
  .form-input:focus { outline: none; border-color: #58a6ff; }
  textarea.form-input { min-height: 80px; resize: vertical; font-family: inherit; }
  select.form-input { min-width: 100px; flex: 0; }

  .empty { color: #484f58; font-style: italic; font-size: 0.85rem; padding: 0.5rem 0; }
  .refresh-info { font-size: 0.7rem; color: #484f58; text-align: center; margin-top: 1rem; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; }
  .dot-green { background: #3fb950; }
  .dot-yellow { background: #d29922; }
  .dot-red { background: #f85149; }
  .dot-gray { background: #484f58; }
  .task-subtitle { font-size: 0.75rem; color: #8b949e; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .task-info { flex: 1; min-width: 0; }
  .task-link { color: #58a6ff; text-decoration: none; font-size: 0.7rem; }
  .task-link:hover { text-decoration: underline; }
  .elapsed { font-variant-numeric: tabular-nums; }
  .label-tag { display: inline-block; padding: 1px 6px; border-radius: 8px; font-size: 0.65rem; background: #30363d; color: #8b949e; margin-left: 4px; }
  .run-error { font-size: 0.7rem; color: #f85149; max-width: 400px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
</head><body>

<header>
  <h1>Cacophony</h1>
  <div id="conn" class="pill pill-gray">connecting...</div>
</header>

<div class="stats" id="stats"></div>

<details class="add-form" id="add-form">
  <summary>+ New task</summary>
  <form onsubmit="return createTask(event)">
    <div class="form-row">
      <input class="form-input" name="identifier" placeholder="task-id" required style="max-width:160px">
      <select class="form-input" name="priority">
        <option value="">Priority</option>
        <option value="1">1 (highest)</option>
        <option value="2">2</option>
        <option value="3">3</option>
        <option value="4">4 (lowest)</option>
      </select>
    </div>
    <div class="form-row">
      <textarea class="form-input" name="content" placeholder="# Task title&#10;&#10;Description of what needs to be done..." required></textarea>
    </div>
    <div class="form-row" style="justify-content:flex-end">
      <button type="submit" class="btn btn-primary" style="padding:6px 16px">Create</button>
    </div>
  </form>
</details>

<div class="section" id="running-section" style="display:none">
  <div class="section-title">Running</div>
  <ul class="task-list" id="running"></ul>
</div>

<div class="section" id="retrying-section" style="display:none">
  <div class="section-title">Retrying</div>
  <ul class="task-list" id="retrying"></ul>
</div>

<div class="section">
  <div class="section-title">Tasks</div>
  <ul class="task-list" id="tasks"></ul>
</div>

<div class="section" id="history-section">
  <div class="section-title">Recent Runs</div>
  <ul class="task-list" id="history"></ul>
</div>

<p class="refresh-info">Auto-refreshes every 3s</p>

<script>
const API = '';

async function fetchJSON(url, opts) {
  const r = await fetch(API + url, opts);
  return r.json();
}

function el(tag, attrs, ...children) {
  const e = document.createElement(tag);
  if (attrs) Object.entries(attrs).forEach(([k,v]) => {
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'className') e.className = v;
    else if (k === 'innerHTML') e.innerHTML = v;
    else e.setAttribute(k, v);
  });
  children.flat().forEach(c => {
    if (typeof c === 'string') e.appendChild(document.createTextNode(c));
    else if (c) e.appendChild(c);
  });
  return e;
}

function statePill(state) {
  const cls = {
    'todo': 'pill-blue', 'in-progress': 'pill-yellow',
    'done': 'pill-green', 'cancelled': 'pill-gray', 'wontfix': 'pill-gray',
    'running': 'pill-green', 'failed': 'pill-red',
  }[state] || 'pill-gray';
  return el('span', { className: 'pill ' + cls }, state);
}

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s/60) + 'm ago';
  if (s < 86400) return Math.floor(s/3600) + 'h ago';
  return Math.floor(s/86400) + 'd ago';
}

function elapsed(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m > 0) return m + 'm ' + sec + 's';
  return sec + 's';
}

function durationStr(ms) {
  if (ms == null) return '-';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m > 0) return m + 'm ' + sec + 's';
  return sec + 's';
}

function renderStats(status, tasks) {
  const s = document.getElementById('stats');
  const running = status.running?.length || 0;
  const retrying = status.retrying?.length || 0;
  const total = tasks.length;
  const active = tasks.filter(t => ['todo','in-progress'].includes(t.state)).length;
  const done = tasks.filter(t => ['done','cancelled','wontfix'].includes(t.state)).length;

  s.innerHTML = '';
  [{l:'Running', v:running, c:'#3fb950'}, {l:'Retrying', v:retrying, c:'#d29922'},
   {l:'Active', v:active, c:'#58a6ff'}, {l:'Done', v:done, c:'#484f58'},
   {l:'Total', v:total, c:'#c9d1d9'}].forEach(({l,v,c}) => {
    s.appendChild(el('div', {className:'stat'},
      el('div', {className:'stat-label'}, l),
      el('div', {className:'stat-value', style:'color:'+c}, String(v))
    ));
  });
}

function renderRunning(entries) {
  const sec = document.getElementById('running-section');
  const ul = document.getElementById('running');
  ul.innerHTML = '';
  sec.style.display = entries.length ? '' : 'none';
  entries.forEach(r => {
    const labels = (r.labels || []).map(l => el('span', {className:'label-tag'}, l));
    const titleRow = [el('span', {className:'task-title'}, r.title || 'Running')];
    if (r.url) titleRow.push(el('a', {className:'task-link', href:r.url, target:'_blank'}, 'view issue'));

    ul.appendChild(el('li', {className:'task-item'},
      el('span', {className:'dot dot-green'}),
      el('span', {className:'task-id'}, r.identifier),
      el('div', {className:'task-info'},
        el('div', null, ...titleRow, ...labels),
        el('div', {className:'task-subtitle'}, 'attempt ' + r.attempt + ' \u00B7 running for ' + elapsed(r.startedAt))
      ),
      el('div', {className:'task-actions'},
        el('button', {className:'btn btn-danger', onclick: () => stopTask(r.identifier)}, 'Stop')
      )
    ));
  });
}

function renderRetrying(entries) {
  const sec = document.getElementById('retrying-section');
  const ul = document.getElementById('retrying');
  ul.innerHTML = '';
  sec.style.display = entries.length ? '' : 'none';
  entries.forEach(r => {
    const due = Math.max(0, Math.round((r.dueAtMs - Date.now()) / 1000));
    ul.appendChild(el('li', {className:'task-item'},
      el('span', {className:'dot dot-yellow'}),
      el('span', {className:'task-id'}, r.identifier),
      el('span', {className:'task-title'}, (r.error || 'continuation') + ' — retry #' + r.attempt),
      el('span', {className:'task-meta'}, due + 's remaining')
    ));
  });
}

function renderTasks(tasks) {
  const ul = document.getElementById('tasks');
  ul.innerHTML = '';
  if (!tasks.length) {
    ul.appendChild(el('li', {className:'empty'}, 'No tasks. Create one above.'));
    return;
  }
  tasks.sort((a,b) => {
    const order = {'todo':0,'in-progress':1,'done':2,'cancelled':3,'wontfix':3};
    return (order[a.state]??2) - (order[b.state]??2);
  });
  tasks.forEach(t => {
    const isDone = ['done','cancelled','wontfix'].includes(t.state);
    const actions = [];
    if (t.state === 'todo') {
      actions.push(el('button', {className:'btn', onclick:()=>setState(t.identifier,'in-progress')}, 'Start'));
    }
    if (t.state === 'in-progress') {
      actions.push(el('button', {className:'btn btn-primary', onclick:()=>setState(t.identifier,'done')}, 'Done'));
    }
    if (!isDone) {
      actions.push(el('button', {className:'btn btn-danger', onclick:()=>deleteTask(t.identifier)}, 'Del'));
    }

    ul.appendChild(el('li', {className:'task-item', style: isDone ? 'opacity:0.5' : ''},
      statePill(t.state),
      el('span', {className:'task-id'}, t.identifier),
      el('span', {className:'task-title'}, t.title),
      t.priority ? el('span', {className:'task-meta'}, 'P'+t.priority) : null,
      el('div', {className:'task-actions'}, ...actions)
    ));
  });
}

function renderHistory(runs, runningIds) {
  const ul = document.getElementById('history');
  ul.innerHTML = '';
  // Only show completed runs, exclude currently running
  const activeStatuses = new Set(['running', 'preparing_workspace', 'building_prompt', 'launching_agent']);
  const completed = runs.filter(r => !activeStatuses.has(r.status) && !runningIds.has(r.issueIdentifier) && !runningIds.has(r.issueId)).slice(0, 10);
  if (!completed.length) {
    ul.appendChild(el('li', {className:'empty'}, 'No completed runs yet.'));
    return;
  }
  completed.forEach(r => {
    const dotClass = {
      'succeeded':'dot-green', 'failed':'dot-red', 'timed_out':'dot-yellow',
      'canceled':'dot-gray', 'running':'dot-green',
    }[r.status] || 'dot-gray';

    const details = [r.status];
    if (r.durationMs != null) details.push(durationStr(r.durationMs));
    if (r.attempt > 0) details.push('attempt ' + r.attempt);

    const children = [
      el('span', {className:'dot ' + dotClass}),
      el('span', {className:'task-id'}, r.issueIdentifier),
      el('span', {className:'task-meta'}, details.join(' \u00B7 ')),
      el('span', {className:'task-meta'}, r.startedAt ? timeAgo(r.startedAt) : ''),
    ];
    if (r.error && r.status !== 'succeeded') {
      children.push(el('span', {className:'run-error', title: r.error}, r.error));
    }

    ul.appendChild(el('li', {className:'task-item', style: r.status === 'succeeded' ? 'opacity:0.7' : ''}, ...children));
  });
}

async function refresh() {
  try {
    const [status, tasks, runs] = await Promise.all([
      fetchJSON('/api/v1/status'),
      fetchJSON('/api/v1/tasks').catch(() => []),
      fetchJSON('/api/v1/runs').catch(() => []),
    ]);
    document.getElementById('conn').className = 'pill pill-green';
    document.getElementById('conn').textContent = 'live';
    renderStats(status, tasks);
    renderRunning(status.running || []);
    renderRetrying(status.retrying || []);
    renderTasks(tasks);
    const runningIds = new Set((status.running || []).flatMap(r => [r.identifier, r.issueId]));
    renderHistory(runs, runningIds);
    document.getElementById('add-form').style.display = status.trackerKind === 'files' ? '' : 'none';
  } catch(e) {
    document.getElementById('conn').className = 'pill pill-red';
    document.getElementById('conn').textContent = 'disconnected';
  }
}

async function createTask(e) {
  e.preventDefault();
  const f = e.target;
  const body = {
    identifier: f.identifier.value.trim(),
    priority: f.priority.value ? Number(f.priority.value) : null,
    content: f.content.value.trim(),
  };
  await fetchJSON('/api/v1/tasks', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify(body),
  });
  f.reset();
  document.getElementById('add-form').removeAttribute('open');
  refresh();
}

async function setState(id, state) {
  await fetchJSON('/api/v1/tasks/' + encodeURIComponent(id) + '/state', {
    method: 'PUT', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ state }),
  });
  refresh();
}

async function deleteTask(id) {
  if (!confirm('Delete ' + id + '?')) return;
  await fetchJSON('/api/v1/tasks/' + encodeURIComponent(id), { method: 'DELETE' });
  refresh();
}

async function stopTask(id) {
  await fetchJSON('/api/v1/stop/' + encodeURIComponent(id), { method: 'POST' });
  refresh();
}

refresh();
setInterval(refresh, 3000);
</script>
</body></html>`;
}
