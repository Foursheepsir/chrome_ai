import { getSelectionText, extractReadableText } from '../services/domExtract'
import { summarize, explain, translate } from '../services/aiService'
import { addNote, getSetting, setSetting } from '../services/storage'
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
    document.documentElement.appendChild(el)
  
    // 用背景图方式（已在 CSS 配好），也可以换成 <img> 方案
  
    // —— 读取上次位置（可选持久化） —— //
    ;(async () => {
      const pos = await getSetting<{ left: number; top: number }>('floatPos')
      if (pos) {
        el.style.left = `${pos.left}px`
        el.style.top = `${pos.top}px`
      } else {
        // 默认右下角
        el.style.right = '24px'
        el.style.bottom = '24px'
      }
    })()
  
    // —— 拖动支持（鼠标 + 触摸） —— //
    let dragging = false
    let startX = 0, startY = 0
    let startLeft = 0, startTop = 0
    let moved = false
    const DRAG_THRESHOLD = 4 // 像素，区分点击/拖动
  
    const onPointerDown = (clientX: number, clientY: number) => {
      dragging = true
      moved = false
      el.classList.add('dragging')
  
      // 将 right/bottom 切换为 left/top 以便拖动
      const rect = el.getBoundingClientRect()
      el.style.right = 'auto'
      el.style.bottom = 'auto'
      startLeft = rect.left
      startTop = rect.top
      startX = clientX
      startY = clientY
    }
  
    const onPointerMove = (clientX: number, clientY: number) => {
      if (!dragging) return
      const dx = clientX - startX
      const dy = clientY - startY
      if (!moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) moved = true
  
      // 计算并钳制到窗口内
      const left = Math.min(
        Math.max(0, startLeft + dx),
        window.innerWidth - el.offsetWidth
      )
      const top = Math.min(
        Math.max(0, startTop + dy),
        window.innerHeight - el.offsetHeight
      )
      el.style.left = `${left}px`
      el.style.top = `${top}px`
    }
  
    const onPointerUp = async () => {
      if (!dragging) return
      dragging = false
      el.classList.remove('dragging')
  
      // 持久化位置
      const rect = el.getBoundingClientRect()
      await setSetting('floatPos', { left: rect.left, top: rect.top })
  
      // 如果没有明显移动，当作点击
      if (!moved) {
        // 点击：开始旋转 → 生成整页 Summary → 停止旋转
        if (sidePanelOpen) {
          hideSidePanel()
          return
        }
        el.classList.add('spinning')
        try {
          await openPanelAndSummarizePage()
        } finally {
          el.classList.remove('spinning')
        }
      }
    }
  
    // 鼠标
    el.addEventListener('mousedown', (e) => {
      e.preventDefault()
      onPointerDown(e.clientX, e.clientY)
    })
    document.addEventListener('mousemove', (e) => onPointerMove(e.clientX, e.clientY))
    document.addEventListener('mouseup', () => onPointerUp())
  
    // 触摸
    el.addEventListener('touchstart', (e) => {
      const t = e.touches[0]
      onPointerDown(t.clientX, t.clientY)
    }, { passive: true })
    document.addEventListener('touchmove', (e) => {
      const t = e.touches[0]
      onPointerMove(t.clientX, t.clientY)
    }, { passive: true })
    document.addEventListener('touchend', () => onPointerUp())
  
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
