import { getSelectionText, extractReadableText } from '../services/domExtract'
import { summarize, explain, translate } from '../services/aiService'
import { addNote, getSetting } from '../services/storage'
import type { Note } from '../utils/messaging'
import { nanoid } from 'nanoid'

// tooltip
function ensureTooltip() {
  let tip = document.getElementById('__ai_companion_tip__') as HTMLDivElement | null
  if (!tip) {
    tip = document.createElement('div')
    tip.id = '__ai_companion_tip__'
    tip.className = 'ai-tip'
    tip.innerHTML = `
      <button data-act="summ">Summarize</button>
      <button data-act="exp">Explain</button>
      <button data-act="tr">Translate</button>
    `
    document.documentElement.appendChild(tip)
  }
  return tip
}
function positionTooltip(tip: HTMLDivElement) {
  const sel = document.getSelection()
  if (!sel || sel.rangeCount === 0) return
  const rect = sel.getRangeAt(0).getBoundingClientRect()
  tip.style.top = `${window.scrollY + rect.bottom + 6}px`
  tip.style.left = `${window.scrollX + rect.left}px`
  tip.style.display = 'flex'
}
document.addEventListener('mouseup', () => {
  const txt = getSelectionText()
  const tip = ensureTooltip()
  tip.style.display = txt ? 'flex' : 'none'
  if (txt) positionTooltip(tip)
})
ensureTooltip().addEventListener('click', (e) => {
  const t = e.target as HTMLElement
  const act = t.getAttribute('data-act')
  if (act) handleAction(act as 'summ'|'exp'|'tr'|'save')
})

async function handleAction(action: 'summ'|'exp'|'tr'|'save') {
  const selected = getSelectionText()
  if (!selected && action !== 'save') return

  const targetLang = (await getSetting<string>('targetLang')) || 'zh'
  let result = ''

  if (action === 'summ') {
    result = await summarize(selected, { maxWords: 120 })
    await saveNote('summary', result, selected)
  } else if (action === 'exp') {
    const ctx = window.getSelection()?.anchorNode?.parentElement?.textContent ?? selected
    result = await explain(selected, { context: ctx })
    await saveNote('explain', result, selected)
  } else if (action === 'tr') {
    result = await translate(selected, { targetLang })
    await saveNote('translation', result, selected)
  } else if (action === 'save') {
    const text = extractReadableText(document)
    const pageSum = await summarize(text, { maxWords: 180 })
    await saveNote('summary', pageSum, text.slice(0, 300))
    showBubble('Page summary saved')
    return
  }

  if (result) showBubble('Added to Notes')
}
async function saveNote(kind: Note['kind'], text: string, snippet?: string) {
  const note: Note = {
    id: nanoid(),
    sourceUrl: location.href,
    pageTitle: document.title,
    kind, text, snippet,
    createdAt: Date.now(), lang: 'auto'
  }
  await addNote(note)
}
function showBubble(text: string) {
  const el = document.createElement('div')
  el.className = 'ai-bubble'
  el.textContent = text
  document.documentElement.appendChild(el)
  setTimeout(() => el.remove(), 1200)
}

// 背景消息
chrome.runtime.onMessage.addListener((msg: any, _sender, sendResponse) => {
  const handle = async () => {
    try {
      if (msg.type === 'SUMMARIZE_PAGE') {
        const text = extractReadableText(document)
        const result = await summarize(text, { maxWords: 180 })
        await saveNote('summary', result, text.slice(0, 300))
        showBubble('Page summary saved')
        sendResponse({ ok: true })
        return
      }

      if (msg.type === 'SUMMARIZE_SELECTION') {
        const sel = getSelectionText()
        if (!sel) { sendResponse({ ok: false, reason: 'no selection' }); return }
        const result = await summarize(sel, { maxWords: 120 })
        await saveNote('summary', result, sel)
        showBubble('Summary saved')
        sendResponse({ ok: true })
        return
      }

      if (msg.type === 'EXPLAIN_SELECTION') {
        const sel = getSelectionText()
        if (!sel) { sendResponse({ ok: false, reason: 'no selection' }); return }
        const ctx = window.getSelection()?.anchorNode?.parentElement?.textContent ?? sel
        const result = await explain(sel, { context: ctx })
        await saveNote('explain', result, sel)
        showBubble('Explanation saved')
        sendResponse({ ok: true })
        return
      }

      if (msg.type === 'TRANSLATE_SELECTION') {
        const sel = getSelectionText()
        if (!sel) { sendResponse({ ok: false, reason: 'no selection' }); return }
        const result = await translate(sel, { targetLang: msg.targetLang || 'zh' })
        await saveNote('translation', result, sel)
        showBubble('Translation saved')
        sendResponse({ ok: true })
        return
      }

      // 未处理的消息：不要返回 true，也不要 sendResponse
      // 这样就不会出现“承诺异步响应但没发”的错误
    } catch (e) {
      console.error(e)
      try { sendResponse({ ok: false, error: String(e) }) } catch {}
    }
  }

  // 只有在我们会异步 sendResponse 的时候才返回 true
  const willHandle =
    msg?.type === 'SUMMARIZE_PAGE' ||
    msg?.type === 'SUMMARIZE_SELECTION' ||
    msg?.type === 'EXPLAIN_SELECTION' ||
    msg?.type === 'TRANSLATE_SELECTION'

  if (willHandle) { handle(); return true }
  return false
})
