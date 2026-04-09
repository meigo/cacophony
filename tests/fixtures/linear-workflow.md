---
tracker:
  kind: linear
  api_key: '$LINEAR_API_KEY'
  project_slug: 'test-project'
  active_states: ['Todo', 'In Progress']
  terminal_states: ['Done', 'Cancelled']

agent:
  command: 'codex --prompt {{prompt_file}}'
  prompt_delivery: file
  timeout_ms: 3600000
  max_concurrent: 10

workspace:
  root: ~/workspaces

polling:
  interval_ms: 30000
---

Work on {{issue.identifier}}: {{issue.title}}
