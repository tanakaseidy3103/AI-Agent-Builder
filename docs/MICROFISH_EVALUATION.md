# Microfish Skill — evaluation

Date: 2026-11-05 · Evaluator: automated QA session · **Status: NOT EXECUTED — Skill not found**

## 1. Locating the Skill

The evaluation protocol requires running the current version of "Microfish" unchanged. It could not be located.

| Where searched | Result |
|---|---|
| This repository (`git grep -i "microfish\|mirofish"`) | only references to **MiroFish** in planning text, no Skill |
| AI Agent Builder database (`skills` table) | `react-performance-analyzer`, `find-todo-*` — no Microfish |
| `~/.claude/skills/` (incl. synced bucket) | only docx/pptx/xlsx/pdf skills |
| `~/.claude/plugins/` (cache, marketplaces) | no match for `fish` in any SKILL.md |
| `~/.codex/skills/` | empty |
| `~/.cursor/` | does not exist |
| Home directory, depth 7, name `*fish*` | only shell integration files (`fish` shell), Java `glassfish` |

The closest name in the project history is **MiroFish**, an external multi-agent simulation project mentioned in the
original product brief as inspiration for the Evaluation Lab. The brief explicitly said not to integrate it before
checking license, APIs and compatibility. It was never installed or integrated here.

## 2. Why no scores are given

Scoring a Skill that was not executed would mean inventing results. The five scenarios, inputs, outputs, evidence and
the 0–10 scores are therefore **not produced**.

## 3. What is needed to run this evaluation

One of:
1. The path or repository of the Microfish Skill (a directory with `SKILL.md`, or a plugin), or
2. Confirmation that "Microfish" means the external **MiroFish** project, plus permission to clone it and the
   API keys/models it requires — then it can be evaluated as an external tool, not as a Skill.

## Verdict

**NOT EVALUATED** — none of APROVADA / APROVADA COM RESSALVAS / REPROVADA can be given without execution.
