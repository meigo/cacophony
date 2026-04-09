---
tracker:
  kind: files
  dir: "./tasks"
  active_states: ["todo", "in-progress"]
  terminal_states: ["done", "cancelled"]

agent:
  command: "claude -p {{prompt_file}} --output-format stream-json"
  prompt_delivery: file
  timeout_ms: 3600000
  max_concurrent: 3


workspace:
  root: ./workspaces

polling:
  interval_ms: 30000
---

You are an autonomous coding agent working on issue **{{issue.identifier}}**.

## Task

**{{issue.title}}**

{{issue.description}}

## Instructions

1. Create a feature branch named `{{issue.identifier | downcase}}`
2. Implement the required changes
3. Write or update tests as needed
4. Ensure all tests pass
5. Open a pull request with a clear description

{% if attempt %}
This is retry attempt #{{attempt}}. Check the previous work in this workspace and continue from where it left off.
{% endif %}
