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
  h1 { font-size: 1.1rem; font-weight: 700; color: var(--text); letter-spacing: 0.02em; text-transform: uppercase; display: flex; align-items: center; gap: 0.5rem; }
  h1 .logo-icon { width: 20px; height: 20px; color: var(--text); }
  .header-right { display: flex; align-items: center; gap: 0.5rem; }
  .theme-toggle {
    display: flex; align-items: center; justify-content: center;
    width: 32px; height: 32px; padding: 0; color: var(--text-dim);
    background: var(--bg-elev); border: 1px solid var(--border);
  }
  .theme-toggle:hover { color: var(--text); border-color: var(--border-strong); }
  .theme-toggle svg { width: 16px; height: 16px; }
  .conn {
    display: inline-flex; align-items: center;
    width: 32px; height: 32px; justify-content: center;
    background: var(--bg-elev); border: 1px solid var(--border);
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
  .merge-tag {
    font-size: 0.65rem; padding: 1px 6px; text-transform: uppercase;
    letter-spacing: 0.05em; border: 1px solid var(--amber, #d97706);
    color: var(--amber, #d97706);
  }
  .pending-tag { color: var(--text-dim); }
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
  .run-item .merge-status {
    font-weight: 700; padding: 1px 8px; font-size: 0.65rem;
    text-transform: uppercase; letter-spacing: 0.05em;
    border: 1px solid var(--amber, #d97706); color: var(--amber, #d97706);
  }
  .merge-note {
    font-size: 0.7rem; color: var(--text);
    margin-top: 4px; padding: 6px 10px;
    background: var(--bg); border: 1px solid var(--amber, #d97706); border-left-width: 3px;
    white-space: pre-wrap; word-break: break-word;
  }
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

  .brief-hint {
    font-size: 0.7rem; color: var(--text-faint);
    width: 100%; margin-bottom: 0.5rem;
  }

  /* Keyboard hint */
  kbd {
    background: var(--bg); border: 1px solid var(--border-strong);
    padding: 1px 5px; font-family: inherit;
    font-size: 0.7rem; color: var(--text-dim);
  }

  /* Utilities */
  .hidden { display: none !important; }
  [x-cloak] { display: none !important; }

  /* Toast notifications */
  .toasts {
    position: fixed; bottom: 1.5rem; right: 1.5rem; z-index: 1000;
    display: flex; flex-direction: column; gap: 0.5rem; max-width: 400px;
  }
  .toast {
    background: var(--bg-elev); border: 1px solid var(--border);
    padding: 0.6rem 1rem; font-size: 0.8rem; color: var(--text-dim);
    animation: toast-in 0.2s ease-out;
  }
  .toast-title { font-weight: 600; color: var(--text); margin-bottom: 2px; }
  @keyframes toast-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

  /* Settings modal */
  .settings-field { margin-bottom: 1rem; }
  .settings-field label {
    display: block; font-size: 0.65rem; font-weight: 600; color: var(--text-dim);
    text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.35rem;
  }
  .settings-field input[type="text"],
  .settings-field input[type="number"],
  .settings-field textarea {
    width: 100%; background: var(--bg); border: 1px solid var(--border);
    padding: 8px 12px; color: var(--text); font-family: inherit; font-size: 0.85rem;
  }
  .settings-field textarea { min-height: 50px; resize: vertical; }
  .settings-field input:focus, .settings-field textarea:focus { outline: none; border-color: var(--text); }
  .settings-field select {
    width: 100%; background: var(--bg); border: 1px solid var(--border);
    padding: 8px 10px; color: var(--text); font-family: inherit; font-size: 0.85rem;
  }
  .settings-field select:focus { outline: none; border-color: var(--text); }
  .settings-toggle {
    display: flex; align-items: center; gap: 0.5rem; cursor: pointer;
    font-size: 0.85rem; color: var(--text);
  }
  .settings-toggle input { accent-color: var(--text); }
  .settings-saved {
    font-size: 0.75rem; color: var(--green); margin-left: 0.5rem;
    transition: opacity 0.3s; opacity: 0;
  }
  .settings-saved.show { opacity: 1; }

  /* Setup screen */
  .setup {
    max-width: 500px; margin: 0 auto; padding-top: 2rem;
  }
  .setup h2 {
    font-size: 1.1rem; font-weight: 700; margin-bottom: 0.25rem;
    text-transform: uppercase; letter-spacing: 0.02em;
  }
  .setup .setup-sub {
    font-size: 0.8rem; color: var(--text-dim); margin-bottom: 1.5rem;
  }
  .setup-label {
    font-size: 0.7rem; font-weight: 600; color: var(--text-dim);
    text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem;
  }
  .setup-section { margin-bottom: 1.25rem; }
  .agent-grid {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem;
  }
  .agent-card {
    background: var(--bg-elev); border: 1px solid var(--border);
    padding: 0.75rem; cursor: pointer; text-align: center;
    transition: border-color 0.15s;
  }
  .agent-card:hover { border-color: var(--border-strong); }
  .agent-card.selected { border-color: var(--text); }
  .agent-card-name { font-size: 0.85rem; font-weight: 600; }
  .setup select {
    width: 100%; background: var(--bg); border: 1px solid var(--border);
    padding: 8px 10px; color: var(--text); font-family: inherit; font-size: 0.85rem;
  }
  .setup select:focus { outline: none; border-color: var(--text); }
  .setup input[type="number"], .setup input[type="text"] {
    width: 100%; background: var(--bg); border: 1px solid var(--border);
    padding: 8px 12px; color: var(--text); font-family: inherit; font-size: 0.85rem;
  }
  .setup input:focus { outline: none; border-color: var(--text); }
  .setup-actions { margin-top: 1.5rem; }
  .setup .btn.primary { width: 100%; }

  /* Scrollbars — match the flat/minimal vibe */
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border); }
  ::-webkit-scrollbar-thumb:hover { background: var(--border-strong); }
</style>
</head><body>

<div x-data="app()" x-init="init()" x-cloak>

  <!-- Setup screen (shown when no config exists) -->
  <template x-if="needsSetup">
    <div class="setup">
      <h2>Cacophony</h2>
      <div class="setup-sub">Pick your coding agent to get started.</div>

      <div class="setup-section">
        <div class="setup-label">Agent</div>
        <div class="agent-grid">
          <template x-for="p in setupPresets" :key="p.name">
            <div class="agent-card" :class="{selected: setup.agent === p.name}" @click="setup.agent = p.name; setup.model = (p.models && p.models[0]) || ''">
              <div class="agent-card-name" x-text="p.name"></div>
            </div>
          </template>
          <div class="agent-card" :class="{selected: setup.agent === 'Custom'}" @click="setup.agent = 'Custom'; setup.model = ''">
            <div class="agent-card-name">Custom</div>
          </div>
        </div>
      </div>

      <div class="setup-section" x-show="setupSelectedPreset?.models?.length > 0">
        <div class="setup-label">Model</div>
        <select x-model="setup.model">
          <template x-for="m in (setupSelectedPreset?.models || [])" :key="m">
            <option :value="m" x-text="m"></option>
          </template>
        </select>
      </div>

      <div class="setup-section" x-show="setup.agent === 'Custom'">
        <div class="setup-label">Command</div>
        <input type="text" x-model="setup.customCommand" placeholder="my-agent --prompt {{prompt_file}} --yes">
        <div style="font-size:0.7rem;color:var(--text-faint);margin-top:0.25rem;">
          Variables: {{prompt_file}}, {{workspace}}, {{identifier}}
        </div>
      </div>

      <div class="setup-section">
        <div class="setup-label">Max concurrent agents</div>
        <input type="number" x-model.number="setup.maxConcurrent" min="1" max="10">
      </div>

      <div class="setup-actions">
        <button class="btn primary" @click="submitSetup()" :disabled="setupBusy || (!setupSelectedPreset && setup.agent !== 'Custom') || (setup.agent === 'Custom' && !setup.customCommand.trim())">
          <span x-text="setupBusy ? 'Starting…' : 'Start'"></span>
        </button>
      </div>
      <div x-show="setupError" style="color:var(--red);font-size:0.8rem;margin-top:0.75rem;" x-text="setupError"></div>
    </div>
  </template>

  <!-- Main dashboard (hidden during setup) -->
  <template x-if="!needsSetup">
  <div>

  <header>
    <h1><svg class="logo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 13a2 2 0 0 0 2-2V7a2 2 0 0 1 4 0v13a2 2 0 0 0 4 0V4a2 2 0 0 1 4 0v13a2 2 0 0 0 4 0v-4a2 2 0 0 1 2-2"/></svg>Cacophony</h1>
    <div class="header-right">
      <button class="theme-toggle" @click="openSettings()" title="Settings">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/></svg>
      </button>
      <button class="theme-toggle" @click="toggleTheme()" :title="theme === 'dark' ? 'Switch to light' : 'Switch to dark'">
        <template x-if="theme === 'dark'"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg></template>
        <template x-if="theme === 'light'"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/></svg></template>
      </button>
      <div class="conn" :class="{live: connected, dead: !connected}" :title="connected ? 'Connected' : 'Offline'">
        <span class="conn-dot"></span>
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
        <span class="blocked-tag pending-tag" x-show="isPending(t)">pending</span>
        <span class="merge-tag" x-show="needsMerge(t)" title="Agent succeeded but auto-merge was skipped. Branch preserved for manual merge.">needs merge</span>

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
                  <span class="merge-status" x-show="hasMergeIssue(r)" x-text="'merge ' + r.mergeStatus"></span>
                  <span x-text="'attempt ' + r.attempt"></span>
                  <span class="run-meta" x-text="duration(r.durationMs) + ' · ' + timeAgo(r.startedAt)"></span>
                </div>
                <div class="run-error" x-show="r.error && r.status !== 'succeeded'" x-text="r.error"></div>
                <div class="merge-note" x-show="hasMergeIssue(r)">
                  <strong x-text="r.mergeStatus === 'conflict' ? 'Merge conflict — branch preserved' : 'Auto-merge skipped — branch preserved'"></strong>
                  <span x-show="r.mergeReason" x-text="': ' + r.mergeReason"></span>
                  <div style="margin-top:4px;color:var(--text-dim)">Land manually: <code x-text="'git merge --no-ff cacophony/' + r.issueIdentifier"></code></div>
                </div>
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

  <!-- Toast notifications -->
  <div class="toasts">
    <template x-for="(t, i) in toasts" :key="i">
      <div class="toast">
        <div class="toast-title" x-text="t.title"></div>
        <div x-text="t.message"></div>
      </div>
    </template>
  </div>

  <!-- Settings modal -->
  <div class="modal-backdrop" x-show="settingsOpen" @click="settingsOpen = false" @keydown.escape.window="settingsOpen = false">
    <div class="modal" @click.stop x-show="settingsOpen" x-transition style="max-width: 520px;">
      <div class="modal-head">
        <div>
          <div class="modal-title">Settings<span class="settings-saved" :class="{show: settingsSaved}">Saved</span></div>
        </div>
        <button class="icon-btn" @click="settingsOpen = false">&#10005;</button>
      </div>
      <div class="modal-body">
        <div class="modal-section">
          <div class="modal-label">Agent</div>
          <div class="settings-field">
            <div class="agent-grid" style="grid-template-columns: repeat(3, 1fr); margin-bottom: 0.75rem;">
              <template x-for="p in setupPresets" :key="p.name">
                <div class="agent-card" :class="{selected: settingsForm.agent.preset === p.name}" @click="settingsForm.agent.preset = p.name; settingsForm.agent.model = (p.models && p.models[0]) || ''">
                  <div class="agent-card-name" x-text="p.name"></div>
                </div>
              </template>
              <div class="agent-card" :class="{selected: settingsForm.agent.preset === 'Custom'}" @click="settingsForm.agent.preset = 'Custom'; settingsForm.agent.model = ''">
                <div class="agent-card-name">Custom</div>
              </div>
            </div>
          </div>
          <div class="settings-field" x-show="settingsSelectedPreset?.models?.length > 0">
            <label>Model</label>
            <select x-model="settingsForm.agent.model">
              <template x-for="m in (settingsSelectedPreset?.models || [])" :key="m">
                <option :value="m" x-text="m"></option>
              </template>
            </select>
          </div>
          <div class="settings-field" x-show="settingsForm.agent.preset === 'Custom'">
            <label>Command</label>
            <input type="text" x-model="settingsForm.agent.command" placeholder="my-agent --prompt {{prompt_file}} --yes">
          </div>
          <div class="settings-field">
            <label>Max concurrent</label>
            <input type="number" x-model.number="settingsForm.agent.max_concurrent" min="1" max="10">
          </div>
        </div>
        <div class="modal-section">
          <div class="modal-label">Hooks</div>
          <div class="settings-field">
            <label>after_run <span style="font-weight:400;text-transform:none;letter-spacing:0">(verification gate)</span></label>
            <textarea x-model="settingsForm.hooks.after_run" rows="2" placeholder="npm test && npm run lint"></textarea>
          </div>
          <div class="settings-field">
            <label>after_create <span style="font-weight:400;text-transform:none;letter-spacing:0">(worktree bootstrap)</span></label>
            <textarea x-model="settingsForm.hooks.after_create" rows="2" placeholder="npm install --prefer-offline"></textarea>
          </div>
        </div>
        <div class="modal-section">
          <div class="modal-label">Brief</div>
          <div class="settings-field">
            <label class="settings-toggle">
              <input type="checkbox" x-model="settingsForm.brief.enabled"> Enable pre-task brief
            </label>
          </div>
          <div class="settings-field" x-show="settingsForm.brief.enabled">
            <label>Max rounds</label>
            <input type="number" x-model.number="settingsForm.brief.max_rounds" min="1" max="5">
          </div>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn" @click="settingsOpen = false">Cancel</button>
        <button class="btn primary" @click="saveSettings()" :disabled="settingsBusy">
          <span x-text="settingsBusy ? 'Saving...' : 'Save'"></span>
        </button>
      </div>
    </div>
  </div>

  </div>
  </template>

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
    toasts: [],
    _tick: 0,  // force re-render for elapsed time

    // Settings modal state
    settingsOpen: false,
    settingsForm: { agent: { preset: '', model: '', command: '', max_concurrent: 3 }, hooks: { after_run: '', after_create: '' }, brief: { enabled: true, max_rounds: 2 } },
    settingsBusy: false,
    settingsSaved: false,

    get settingsSelectedPreset() {
      return this.setupPresets.find(p => p.name === this.settingsForm.agent.preset) || null;
    },

    // Setup screen state
    needsSetup: false,
    setupPresets: [],
    setup: { agent: 'Claude Code', model: '', maxConcurrent: 3, customCommand: '', customDelivery: 'file' },
    setupBusy: false,
    setupError: '',

    get setupSelectedPreset() {
      return this.setupPresets.find(p => p.name === this.setup.agent) || null;
    },

    _pollStarted: false,

    startPolling() {
      if (this._pollStarted) return;
      this._pollStarted = true;
      setInterval(() => this.refresh(), 3000);
      setInterval(() => this._tick++, 1000);
      window.addEventListener('keydown', (e) => {
        if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
          e.preventDefault();
          document.querySelector('.search')?.focus();
        }
      });
    },

    async init() {
      // Restore saved theme before first paint; default to dark.
      const saved = localStorage.getItem('caco.theme');
      this.theme = saved === 'light' ? 'light' : 'dark';
      document.documentElement.dataset.theme = this.theme;

      await this.refresh();

      // If setup mode, fetch available presets for the setup screen.
      if (this.needsSetup) {
        try {
          const data = await this.fetch('/api/v1/setup/presets');
          this.setupPresets = data.presets || [];
          if (this.setupPresets.length > 0) {
            this.setup.agent = this.setupPresets[0].name;
            this.setup.model = this.setupPresets[0].models?.[0] || '';
          }
        } catch { /* presets will be empty, user can still pick Custom */ }
        return;
      }

      this.startPolling();
    },

    toggleTheme() {
      this.theme = this.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = this.theme;
      localStorage.setItem('caco.theme', this.theme);
    },

    async refresh() {
      try {
        const status = await this.fetch('/api/v1/status');
        if (status.needsSetup) {
          this.needsSetup = true;
          this.connected = true;
          return;
        }
        this.needsSetup = false;
        const [tasks, runs] = await Promise.all([
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
    // Set of identifiers that have at least one unresolved failure (no subsequent
    // success) AND whose task is not currently in an active state (reopened tasks
    // are pending, not failed). Reused by the Failed tab filter and failedCount.
    get _failedIdentifiers() {
      const succeeded = new Set(this.runs.filter(r => r.status === 'succeeded').map(r => r.issueIdentifier));
      // Tasks that have been reopened (moved back to an active state like 'todo')
      // are no longer failed — they're pending retry.
      const reopened = new Set(
        this.tasks.filter(t => t.state === 'todo').map(t => t.identifier)
      );
      const failed = new Set();
      for (const r of this.runs) {
        if ((r.status === 'failed' || r.status === 'timed_out')
            && !succeeded.has(r.issueIdentifier)
            && !reopened.has(r.issueIdentifier)) {
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
      // A task reopened to 'todo' is pending, not failed.
      if (t.state === 'todo') return false;
      const latest = this.runs.find(r => r.issueIdentifier === t.identifier);
      return latest && (latest.status === 'failed' || latest.status === 'timed_out');
    },
    // The latest succeeded run could not auto-merge into main. The code is
    // on the cacophony/<id> branch; the user has to land it manually.
    needsMerge(t) {
      const latestSuccess = this.runs.find(r => r.issueIdentifier === t.identifier && r.status === 'succeeded');
      return !!latestSuccess && this.hasMergeIssue(latestSuccess);
    },
    hasMergeIssue(r) {
      return r.status === 'succeeded' && !!r.mergeStatus && r.mergeStatus !== 'merged';
    },
    // A task that was reopened from a failed state — has prior failures but
    // is now back in 'todo' waiting to be re-dispatched.
    isPending(t) {
      if (this.isDone(t) || this.isRunning(t) || t.state !== 'todo') return false;
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

    toast(title, message, durationMs = 4000) {
      const t = { title, message };
      this.toasts.push(t);
      setTimeout(() => { this.toasts = this.toasts.filter(x => x !== t); }, durationMs);
    },

    async handleBriefResult(result, originalPrompt, transcript) {
      if (result.status === 'ready') {
        this.brief = null;
        const prompt = result.prompt || originalPrompt;

        // Auto-install skill packs in the background (non-blocking).
        const frameworks = result.frameworks || [];
        for (const fw of frameworks) {
          const pack = this._skillPacks[fw];
          if (pack) {
            try {
              const check = await fetch('/api/v1/skills/status');
              const status = await check.json();
              if (!status.installed) {
                this.toast('Installing ' + pack.name, pack.description);
                fetch('/api/v1/skills/install', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ framework: fw }),
                }).catch(() => {});
              }
            } catch { /* skip */ }
          }
        }

        // Auto-apply suggested hooks in the background (non-blocking). Skip
        // if the current config already has the same after_run — the brief
        // re-suggests on every task, and we don't want to re-toast or
        // overwrite an identical value on each submission.
        const suggested = result.suggestedHooks?.after_run;
        if (suggested) {
          const current = await this.fetch('/api/v1/config').then(c => c?.hooks?.after_run || '').catch(() => '');
          if (current !== suggested) {
            this.toast('Verification hook added', suggested);
            fetch('/api/v1/config/hooks', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ after_run: suggested }),
            }).then(() => this.refresh()).catch(() => {});
          }
        }

        await this.submitTask(prompt);
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

    cancelBrief() {
      this.briefGen++;
      this.runBusy = false;
      this.brief = null;
    },

    async submitSetup() {
      this.setupBusy = true;
      this.setupError = '';
      try {
        const r = await fetch('/api/v1/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agent: this.setup.agent,
            model: this.setup.model,
            maxConcurrent: this.setup.maxConcurrent,
            customCommand: this.setup.customCommand,
            customDelivery: this.setup.customDelivery,
          }),
        });
        const data = await r.json();
        if (!r.ok) {
          this.setupError = data.error || 'Setup failed';
          return;
        }
        // Setup complete — transition to normal dashboard mode.
        this.needsSetup = false;
        await this.refresh();
        this.startPolling();
      } catch (e) {
        this.setupError = 'Connection failed';
      } finally {
        this.setupBusy = false;
      }
    },

    async openSettings() {
      try {
        // Load presets if not already loaded (they're fetched during setup but
        // skipped if the app launched in normal mode with an existing config).
        if (this.setupPresets.length === 0) {
          try {
            const data = await this.fetch('/api/v1/setup/presets');
            this.setupPresets = data.presets || [];
          } catch { /* presets will be empty */ }
        }
        const config = await this.fetch('/api/v1/config');
        this.settingsForm = {
          agent: {
            preset: config.agent?.preset || 'Custom',
            model: config.agent?.model || '',
            command: config.agent?.command || '',
            max_concurrent: config.agent?.max_concurrent || 3,
          },
          hooks: { after_run: config.hooks?.after_run || '', after_create: config.hooks?.after_create || '' },
          brief: { enabled: config.brief?.enabled ?? true, max_rounds: config.brief?.max_rounds || 2 },
        };
        this.settingsOpen = true;
        this.settingsSaved = false;
      } catch {
        // config endpoint not available
      }
    },

    async saveSettings() {
      this.settingsBusy = true;
      try {
        const payload = {
          agent: {
            preset: this.settingsForm.agent.preset,
            model: this.settingsForm.agent.model,
            command: this.settingsForm.agent.preset === 'Custom' ? this.settingsForm.agent.command : undefined,
            max_concurrent: this.settingsForm.agent.max_concurrent,
          },
          hooks: this.settingsForm.hooks,
          brief: this.settingsForm.brief,
        };
        await fetch('/api/v1/config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        this.settingsSaved = true;
        setTimeout(() => { this.settingsSaved = false; }, 2000);
        await this.refresh();
      } catch {
        // save failed
      } finally {
        this.settingsBusy = false;
      }
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
