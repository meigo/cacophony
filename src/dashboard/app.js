function app() {
  return {
    status: {},
    tasks: [],
    runs: [],
    running: [],
    retrying: [],
    trackerKind: '',
    canManageTasks: false,
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
        this.canManageTasks = !!status.canManageTasks;
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
          const firstLine = description.split('\n').map(l => l.trim()).find(l => l) || '';
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
          .map((q, i) => 'Q: ' + q.question + '\nA: ' + this._resolveBriefAnswer(i))
          .join('\n\n');
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
