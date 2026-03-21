# Frontend / Extension Implementation (ui-extension)

## Goal
Drive workflow per selected API.

---

## Core UI behavior

### Entry
User selects API → becomes active context

---

## Show

- API name
- workflow_state
- next action

---

## Actions by state

CONFIGURED:
- Generate UI Preview

UI_GENERATED:
- Generate Full Code
- Regenerate Preview
- Refine Prompt

CODE_GENERATED:
- Review Source
- Download ZIP
- Mark Ready to Deploy

READY_TO_DEPLOY:
- Deploy

---

## Preview Panel

Must:
- render UI (webview)
- no raw JSON

Actions:
- Generate Full Code
- Regenerate
- Refine
- Discard

---

## Full Source Panel

Must:
- show file tree
- show file content

Actions:
- Download ZIP
- Apply All
- Mark Ready to Deploy

---

## Rules

- Block invalid actions
- Do not show whole project
- Always work per API
- Keep UI simple
