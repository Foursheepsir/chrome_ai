export type NoteKind = 'summary' | 'explain' | 'translation' | 'note'

export type Note = {
  id: string
  sourceUrl: string
  pageTitle: string
  kind: NoteKind
  text: string         // AI 结果
  snippet?: string     // 原文片段
  createdAt: number
  lang?: string
}

export type Msg =
  | { type: 'PING' }
  | { type: 'SUMMARIZE_PAGE' }
  | { type: 'SUMMARIZE_SELECTION' }
  | { type: 'EXPLAIN_SELECTION' }
  | { type: 'TRANSLATE_SELECTION'; targetLang: string }
  | { type: 'TOGGLE_PANEL' }
