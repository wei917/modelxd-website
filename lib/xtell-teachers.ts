// lib/xtell-teachers.ts — the teachers XTell offers, in the order and groups
// its picker shows them (owner, Sep 28: the model browser was "too messy
// and for professional developers"). Client-safe data: model names only.
//
// Three groups by what a visitor cares about (never "cheap": the price per
// question is shown on each row). A model that is disabled or missing from
// the catalog is simply not offered. Adding a teacher is a line here and a
// description in lib/i18n.tsx (xtell.tp.note.<model_name>). Codex's
// characters will later sit on top of these rows.

export type TeacherGroup = { key: 'fast' | 'balanced' | 'deep'; models: string[] }

export const TEACHER_GROUPS: TeacherGroup[] = [
  { key: 'fast', models: ['qwen3.8-flash', 'gpt-6-luna'] },
  { key: 'balanced', models: ['gemini-3.8-flash', 'gpt-6-sol', 'qwen3.8-max'] },
  { key: 'deep', models: ['claude-opus-5-5', 'gpt-6-astra'] },
]
