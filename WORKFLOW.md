---
tracker:
  kind: github
  repo: "meigo/caco-web"
  active_labels: ["todo", "in-progress"]
  terminal_labels: ["done", "wontfix"]

agent:
  command: "claude -p {{prompt_file}} --output-format stream-json --verbose --model sonnet --dangerously-skip-permissions"
  prompt_delivery: file
  timeout_ms: 3600000
  max_concurrent: 5
  max_turns: 50

hooks:
  after_create: |
    git clone https://github.com/meigo/caco-web.git .
    if [ -d "../_node_modules_cache" ]; then
      cp -r "../_node_modules_cache" node_modules
    fi
  before_run: |
    git checkout main && git pull origin main
    if [ -f "package.json" ] && [ -f "package-lock.json" ]; then
      npm ci --prefer-offline 2>/dev/null || npm install --prefer-offline 2>/dev/null || true
    fi
  after_run: |
    if [ -d "node_modules" ] && [ ! -d "../_node_modules_cache" ]; then
      cp -r node_modules "../_node_modules_cache"
    fi

workspace:
  root: ./workspaces

polling:
  interval_ms: 30000
---

{% if issue.labels contains "plan" %}
You are an autonomous planning agent decomposing issue **{{issue.identifier}}** into actionable sub-issues.

## Task to Decompose

**{{issue.title}}**

{{issue.description}}

## Instructions

You are a PLANNER, not a coder. Your job is to break this task into small, atomic sub-issues that a coding agent can complete in a single run.

For each sub-issue, create a GitHub issue:
```
gh issue create --repo {{config.tracker.repo}} --title "Sub-issue title" --body "Description..." --label todo
```

Rules:
1. Create dependency-free issues FIRST so you have their numbers for `Blocked by` references
2. If a sub-issue depends on another, include `Blocked by #N` in its body (where N is the dependency's issue number)
3. EVERY sub-issue MUST include `Blocked by #{{issue.id}}` — this prevents them from starting before planning is complete
4. Keep each sub-issue small enough for one agent run (~10-20 tool calls)
5. Include clear acceptance criteria in each issue body
6. Create no more than 15 sub-issues

After creating all sub-issues, mark this planning issue as done:
```
gh issue edit {{issue.id}} --repo {{config.tracker.repo}} --add-label done --remove-label plan --remove-label todo
```

Do NOT write any code. Your only output is `gh issue create` and `gh issue edit` commands.
{% else %}
You are an autonomous coding agent working on issue **{{issue.identifier}}**.

## Task

**{{issue.title}}**

{{issue.description}}

## Instructions

1. Create a feature branch named `{{issue.identifier | downcase}}`
2. Implement the required changes
3. Inspect the project stack and choose appropriate testing tools (unit tests, linting, type checking, etc.). If no testing infrastructure exists yet, set it up.
4. Write tests for the changes you made
5. Run all tests and fix any failures — do not move on until everything passes
6. Commit, push the branch, and open a pull request with a clear description
7. Merge the pull request: `gh pr merge --squash --delete-branch`
8. Mark this issue as done: `gh issue edit {{issue.id}} --repo {{config.tracker.repo}} --add-label done --remove-label todo`

{% if attempt %}
This is retry attempt #{{attempt}}. Check the previous work in this workspace and continue from where it left off.
{% endif %}
{% endif %}
