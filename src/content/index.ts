import { getSelectionText, extractReadableText } from '../services/domExtract'
import { summarize, explain, translate } from '../services/aiService'
import { addNote, getSetting } from '../services/storage'
import type { Msg, Note } from '../utils/messaging'
import { nanoid } from 'nanoid'

/** ---------------- Tooltip（选区操作条） ---------------- */

let lastSelectionRect: DOMRect | null = null
let resultBubbleEl: HTMLDivElement | null = null

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

    tip.addEventListener('click', (e) => {
      const t = e.target as HTMLElement
      const act = t.getAttribute('data-act')
      if (act) handleAction(act as 'summ' | 'exp' | 'tr')
    })
  }
  return tip
}

function positionTooltip(tip: HTMLDivElement) {
  const sel = document.getSelection()
  if (!sel || sel.rangeCount === 0) return
  const rect = sel.getRangeAt(0).getBoundingClientRect()
  lastSelectionRect = rect
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

/** ---------------- 结果气泡（常驻，直到点击外部或按 Esc） ---------------- */

function hideResultBubble() {
  resultBubbleEl?.remove()
  resultBubbleEl = null
}

function showResultBubble(markupOrText: string) {
  hideResultBubble()
  const el = document.createElement('div')
  el.className = 'ai-result-bubble'
  el.innerHTML = escapeHtml(markupOrText).replace(/\n/g, '<br/>')
  document.documentElement.appendChild(el)

  const base = lastSelectionRect
  const top = base ? window.scrollY + base.bottom + 8 : window.scrollY + 80
  const left = base ? window.scrollX + base.left : window.scrollX + 80
  el.style.top = `${top}px`
  el.style.left = `${left}px`

  resultBubbleEl = el
}

document.addEventListener('mousedown', (e) => {
  const target = e.target as Node
  const tip = document.getElementById('__ai_companion_tip__')
  if (resultBubbleEl && !resultBubbleEl.contains(target) && (!tip || !tip.contains(target))) {
    hideResultBubble()
  }
})

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideResultBubble()
})

function escapeHtml(str: string) {
  const div = document.createElement('div')
  div.innerText = str
  return div.innerHTML
}

/** ---------------- 选区按钮行为 ---------------- */

async function handleAction(action: 'summ' | 'exp' | 'tr') {
  const selected = getSelectionText()
  if (!selected) return

  const targetLang = (await getSetting<string>('targetLang')) || 'zh'
  let result = ''

  try {
    if (action === 'summ') {
      result = await summarize(selected, { maxWords: 120 })
    } else if (action === 'exp') {
      const ctx = window.getSelection()?.anchorNode?.parentElement?.textContent ?? selected
      result = await explain(selected, { context: ctx })
    } else if (action === 'tr') {
      result = await translate(selected, { targetLang })
    }
    showResultBubble(result)
  } catch (e) {
    console.error('[AI action error]', e)
    showResultBubble('⚠️ Failed. Please try again.')
  }
}

/** ---------------- 保存笔记 ---------------- */

async function saveNoteToStore(kind: Note['kind'], text: string, snippet?: string) {
  const note: Note = {
    id: nanoid(),
    sourceUrl: location.href,
    pageTitle: document.title,
    kind,
    text,
    snippet,
    createdAt: Date.now(),
    lang: 'auto',
  }
  await addNote(note)
}

/** ---------------- 悬浮球 + 侧边栏（整页 Summary） ---------------- */

let floatBtnEl: HTMLDivElement | null = null
let sidePanelEl: HTMLDivElement | null = null
let sidePanelContentEl: HTMLDivElement | null = null
let sidePanelOpen = false

function ensureFloatingButton() {
  if (floatBtnEl) return floatBtnEl
  const el = document.createElement('div')
  el.id = '__ai_float_btn__'
  el.className = 'ai-float-btn'
  el.title = 'Summarize this page'

  const img = document.createElement('img')
  img.src = chrome.runtime.getURL('icon128.png')
  img.alt = 'AI'
  img.style.width = '100%'
  img.style.height = '100%'
  img.style.objectFit = 'contain'
  img.style.borderRadius = '50%'
  img.style.pointerEvents = 'none'
  el.appendChild(img)
  

  document.documentElement.appendChild(el)

  el.addEventListener('click', async () => {
    if (sidePanelOpen) {
      hideSidePanel()
      return
    }
    await openPanelAndSummarizePage()
  })

  floatBtnEl = el
  return el
}

async function openPanelAndSummarizePage() {
  ensureSidePanel()
  showSidePanel('Generating summary...')
  try {
    const text = extractReadableText(document)
    const res = await summarize(text, { maxWords: 220 })
    sidePanelContentEl!.innerHTML = `
      <div class="ai-panel-actions">
        <button id="__ai_save_page_note__">Save to Notes</button>
      </div>
      <div class="ai-panel-content">${escapeHtml(res).replace(/\n/g, '<br/>')}</div>
    `
    const saveBtn = document.getElementById('__ai_save_page_note__') as HTMLButtonElement | null
    saveBtn?.addEventListener('click', async () => {
      await saveNoteToStore('summary', res, text.slice(0, 300))
      if (saveBtn) saveBtn.textContent = 'Saved ✓'
    })
  } catch (e) {
    console.error(e)
    showSidePanel('⚠️ Failed to summarize this page.')
  }
}

function ensureSidePanel() {
  if (sidePanelEl) return sidePanelEl
  const wrap = document.createElement('div')
  wrap.id = '__ai_side_panel__'
  wrap.className = 'ai-sidepanel'
  wrap.innerHTML = `
    <div class="ai-sidepanel-header">
      <div class="ai-sidepanel-title">Page Summary</div>
      <button class="ai-sidepanel-close" title="Close">x</button>
    </div>
    <div class="ai-sidepanel-body">
      <div class="ai-sidepanel-scroll">
        <div class="ai-sidepanel-content" id="__ai_side_content__"></div>
      </div>
    </div>
  `
  document.documentElement.appendChild(wrap)
  sidePanelEl = wrap
  sidePanelContentEl = wrap.querySelector('#__ai_side_content__') as HTMLDivElement

  wrap.querySelector('.ai-sidepanel-close')!.addEventListener('click', () => hideSidePanel())
  return wrap
}

function showSidePanel(initialText?: string) {
  ensureSidePanel()
  sidePanelEl!.classList.add('open')
  sidePanelOpen = true
  if (typeof initialText === 'string') {
    sidePanelContentEl!.innerText = initialText
  }
}

function hideSidePanel() {
  sidePanelEl?.classList.remove('open')
  sidePanelOpen = false
}

ensureTooltip()
ensureFloatingButton()

/** ---------------- 背景消息（右键菜单触发） ---------------- */
chrome.runtime.onMessage.addListener((msg: Msg, _sender, sendResponse) => {
  if (msg?.type === 'SUMMARIZE_PAGE') {
    (async () => {
      await openPanelAndSummarizePage()
      sendResponse({ ok: true })
    })()
    return true
  }
  return false
})
