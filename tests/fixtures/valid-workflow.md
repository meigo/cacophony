---
tracker:
  kind: github
  repo: 'test-org/test-repo'
  active_labels: ['todo', 'in-progress']
  terminal_labels: ['done', 'wontfix']

agent:
  command: 'echo {{prompt_file}}'
  prompt_delivery: file
  timeout_ms: 5000
  max_concurrent: 3
  max_turns: 5

workspace:
  root: ./test-workspaces

hooks:
  after_create: 'echo workspace created'
  before_run: 'echo before run'

polling:
  interval_ms: 1000
---

You are working on: {{issue.title}}

{{issue.description}}

{% if attempt %}Retry #{{attempt}}{% endif %}
