import { getSelectionText, extractReadableText } from '../services/domExtract'
import { summarize, explain, translate } from '../services/aiService'
import { addNote, getSetting, setSetting, getPageSummary, setPageSummary, clearPageSummary } from '../services/storage'
import type { Msg, Note } from '../utils/messaging'
import { nanoid } from 'nanoid'

/** ---------------- Tooltip（选区操作条） ---------------- */

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

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
      <button data-act="save">Save</button>
    `
    document.documentElement.appendChild(tip)

    tip.addEventListener('click', (e) => {
      const t = e.target as HTMLElement
      const act = t.getAttribute('data-act')
      if (act) handleAction(act as 'summ' | 'exp' | 'tr' | 'save')
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

function showResultBubble(
  markupOrText: string,
  opts?: { kind?: Note['kind']; snippet?: string }
) {
  hideResultBubble()
  const el = document.createElement('div')
  el.className = 'ai-result-bubble'
  
  // 内容区域
  const content = document.createElement('div')
  content.className = 'ai-bubble-content'
  content.innerHTML = escapeHtml(markupOrText).replace(/\n/g, '<br/>')
  el.appendChild(content)

  // 如果提供了保存选项，添加 Save 按钮
  if (opts?.kind && opts?.snippet) {
    const actions = document.createElement('div')
    actions.className = 'ai-bubble-actions'
    
    const saveBtn = document.createElement('button')
    saveBtn.className = 'ai-bubble-save'
    saveBtn.innerHTML = 'Save to Notes'
    saveBtn.addEventListener('click', async () => {
      await saveNoteToStore(opts.kind!, markupOrText, opts.snippet)
      saveBtn.innerHTML = '✓ Saved'
      saveBtn.disabled = true
    })
    
    actions.appendChild(saveBtn)
    el.appendChild(actions)
  }

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

async function handleAction(action: 'summ' | 'exp' | 'tr' | 'save') {
  const selected = getSelectionText()
  if (!selected) return

  // 如果是直接保存，不需要AI处理
  if (action === 'save') {
    try {
      await saveNoteToStore('note', selected)
      showResultBubble('✓ Saved')
      // 1秒后自动隐藏提示
      setTimeout(() => hideResultBubble(), 1000)
    } catch (e) {
      console.error('[Save error]', e)
      showResultBubble('⚠️ Failed to save.')
    }
    return
  }

  const targetLang = (await getSetting<string>('targetLang')) || 'zh'
  let result = ''
  let kind: Note['kind'] = 'summary'

  try {
    if (action === 'summ') {
      result = await summarize(selected, { maxWords: 120 })
      kind = 'summary'
    } else if (action === 'exp') {
      const ctx = window.getSelection()?.anchorNode?.parentElement?.textContent ?? selected
      result = await explain(selected, { context: ctx })
      kind = 'explain'
    } else if (action === 'tr') {
      result = await translate(selected, { targetLang })
      kind = 'translation'
    }
    showResultBubble(result, { kind, snippet: selected })
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
  
    // 内部图标层（负责旋转）
    const icon = document.createElement('div')
    icon.className = 'ai-float-icon'
    icon.style.backgroundImage = `url(${chrome.runtime.getURL('icon128.png')})`
    el.appendChild(icon)
  
    // 关闭小图标（左上角，仅悬停可见）
    const close = document.createElement('div')
    close.className = 'ai-float-close'
    close.textContent = '×'
    el.appendChild(close)
  
    close.addEventListener('click', async (e) => {
      e.stopPropagation()
      el.style.display = 'none'
      await setSetting('floatHidden', true)
    })
  
    document.documentElement.appendChild(el)
  
    // 读取上次位置 / 是否隐藏
    ;(async () => {
      const pos = await getSetting<{ left: number; top: number }>('floatPos')
      const hidden = await getSetting<boolean>('floatHidden')
      if (pos) {
        el.style.left = `${pos.left}px`
        el.style.top = `${pos.top}px`
      } else {
        // 默认左下角，使用 top 计算位置
        el.style.left = '24px'
        el.style.top = `${window.innerHeight - 64 - 24}px`
      }
      el.style.right = 'auto'
      el.style.bottom = 'auto'
      if (hidden) el.style.display = 'none'
    })()
  
    // —— 拖动支持 ——
    let dragging = false, startX = 0, startY = 0, startLeft = 0, startTop = 0
    let moved = false
    const DRAG_THRESHOLD = 4
  
    const onPointerDown = (clientX: number, clientY: number) => {
      dragging = true; moved = false; el.classList.add('dragging')
      const rect = el.getBoundingClientRect()
      startLeft = rect.left; startTop = rect.top
      startX = clientX; startY = clientY
    }
    const onPointerMove = (clientX: number, clientY: number) => {
      if (!dragging) return
      const dx = clientX - startX, dy = clientY - startY
      if (!moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
        moved = true
        // 只在真正开始拖动时才切换定位方式
        el.style.right = 'auto'
        el.style.bottom = 'auto'
      }
      if (moved) {
        const left = Math.min(Math.max(0, startLeft + dx), window.innerWidth - el.offsetWidth)
        const top  = Math.min(Math.max(0, startTop  + dy), window.innerHeight - el.offsetHeight)
        el.style.left = `${left}px`; el.style.top = `${top}px`
      }
    }
    const onPointerUp = async () => {
      if (!dragging) return
      dragging = false; el.classList.remove('dragging')
      if (moved) {
        const rect = el.getBoundingClientRect()
        await setSetting('floatPos', { left: rect.left, top: rect.top })
        return
      }
      if (sidePanelOpen) { hideSidePanel(); return }
      icon.classList.add('spinning')
      try {
        await openPanelAndSummarizePage(/* withDelay */ true)
      } finally {
        icon.classList.remove('spinning')
      }
    }
    el.addEventListener('mousedown', (e) => { e.preventDefault(); onPointerDown(e.clientX, e.clientY) })
    document.addEventListener('mousemove', (e) => onPointerMove(e.clientX, e.clientY))
    document.addEventListener('mouseup', onPointerUp)
    el.addEventListener('touchstart', (e) => { const t = e.touches[0]; onPointerDown(t.clientX, t.clientY) }, { passive: true })
    document.addEventListener('touchmove', (e) => { const t = e.touches[0]; onPointerMove(t.clientX, t.clientY) }, { passive: true })
    document.addEventListener('touchend', onPointerUp)
  
    floatBtnEl = el

    window.addEventListener('resize', () => {
        // if (floatBtnEl) clampFloatIntoView(floatBtnEl)
    })
    return el
}
  

async function openPanelAndSummarizePage(withDelay = false, forceRefresh = false) {
    ensureSidePanel()
    showSidePanel('Loading...')
    
    const currentUrl = location.href
    
    try {
      // 检查缓存（除非强制刷新）
      if (!forceRefresh) {
        const cached = await getPageSummary(currentUrl)
        if (cached) {
          // 显示缓存的结果
          renderPageSummary(cached.summary, cached.text, true)
          return
        }
      }
      
      // 生成新的摘要
      showSidePanel('Generating summary...')
      const text = extractReadableText(document)
      if (withDelay) await sleep(1000)
      const res = await summarize(text, { maxWords: 220 })
      
      // 保存到缓存
      await setPageSummary(currentUrl, res, text)
      
      // 显示结果
      renderPageSummary(res, text, false)
    } catch (e) {
      console.error(e)
      showSidePanel('⚠️ Failed to summarize this page.')
    }
}

function renderPageSummary(summary: string, text: string, isCached: boolean) {
  sidePanelContentEl!.innerHTML = `
    <div class="ai-panel-actions">
      <button id="__ai_save_page_note__" ${isCached ? 'disabled' : ''}>
        ${isCached ? 'Saved ✓' : 'Save to Notes'}
      </button>
      <button id="__ai_refresh_summary__">🔄 Refresh</button>
    </div>
    <div class="ai-panel-content">${escapeHtml(summary).replace(/\n/g, '<br/>')}</div>
  `
  
  const saveBtn = document.getElementById('__ai_save_page_note__') as HTMLButtonElement | null
  if (!isCached) {
    saveBtn?.addEventListener('click', async () => {
      await saveNoteToStore('summary', summary, text.slice(0, 300))
      if (saveBtn) {
        saveBtn.textContent = 'Saved ✓'
        saveBtn.disabled = true
      }
    })
  }
  
  const refreshBtn = document.getElementById('__ai_refresh_summary__') as HTMLButtonElement | null
  refreshBtn?.addEventListener('click', async () => {
    await clearPageSummary(location.href)
    await openPanelAndSummarizePage(false, true)
  })
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
  // if (floatBtnEl) clampFloatIntoView(floatBtnEl)
}

function hideSidePanel() {
  sidePanelEl?.classList.remove('open')
  sidePanelOpen = false
  // if (floatBtnEl) clampFloatIntoView(floatBtnEl)
}

ensureTooltip()
ensureFloatingButton()

/** ---------------- 背景消息（右键菜单触发） ---------------- */
chrome.runtime.onMessage.addListener((msg: Msg | any, _s, sendResponse) => {
  if (msg?.type === 'SHOW_FLOAT_AGAIN') {
    const node = ensureFloatingButton()
    node.style.display = 'block'
    // 重置到左下角，使用 top 定位保持一致
    node.style.left = '24px'
    node.style.top = `${window.innerHeight - 64 - 24}px`
    node.style.right = 'auto'
    node.style.bottom = 'auto'
    setSetting('floatHidden', false)
    sendResponse({ ok: true }); return true
  }
      
  if (msg?.type === 'SUMMARIZE_PAGE') {
    (async () => { await openPanelAndSummarizePage(); sendResponse({ ok: true }) })()
    return true
  }
  return false
})
