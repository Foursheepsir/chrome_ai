import { getSelectionText, extractReadableText } from '../services/domExtract'
import { summarize, explain, translate, destroyResources, destroyExplainSession, abortSummarize, abortTranslate, ensureKeepaliveSession } from '../services/aiService'
import { addNote, getSetting, setSetting, getPageSummary, setPageSummary, clearPageSummary } from '../services/storage'
import type { Msg, Note } from '../utils/messaging'
import { nanoid } from 'nanoid'

/** ---------------- Tooltip（选区操作条） ---------------- */

// 提取选区的上下文（用于 explain）
// 注意：此函数只在选中内容≤4个词时被调用
function getContextForExplain(selectedText: string): string {
  try {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return selectedText
    
    const range = selection.getRangeAt(0)
    const container = range.commonAncestorContainer
    
    // 获取包含选区的文本节点的父元素
    const parentElement = container.nodeType === Node.TEXT_NODE 
      ? container.parentElement 
      : container as Element
    
    if (!parentElement) return selectedText
    
    // 获取父元素的完整文本
    const fullText = parentElement.textContent || ''
    
    // 找到选中文本在完整文本中的位置
    const selectionStart = fullText.indexOf(selectedText)
    if (selectionStart === -1) return selectedText
    
    // 提取前后文本
    const beforeText = fullText.substring(0, selectionStart)
    const afterText = fullText.substring(selectionStart + selectedText.length)
    
    // 提取前一句话（找最后一个句号、问号、感叹号或换行）
    const sentenceEndRegex = /[.!?\n]/
    const beforeSentences = beforeText.split(sentenceEndRegex)
    const prevSentence = beforeSentences.length > 0 
      ? beforeSentences[beforeSentences.length - 1].trim() 
      : ''
    
    // 提取后一句话（找第一个句号、问号、感叹号或换行）
    const nextSentenceMatch = afterText.match(/^[^.!?\n]+[.!?\n]?/)
    const nextSentence = nextSentenceMatch ? nextSentenceMatch[0].trim() : ''
    
    // 组合：前一句 + 选中内容 + 后一句
    const context = [
      prevSentence,
      selectedText,
      nextSentence
    ].filter(s => s.length > 0).join(' ')
    
    return context
  } catch (e) {
    console.warn('[Context extraction error]', e)
    return selectedText
  }
}

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
  // 中止所有正在进行的 AI 操作
  abortSummarize()
  abortTranslate()
  destroyExplainSession()
  
  resultBubbleEl?.remove()
  resultBubbleEl = null
}

function showResultBubble(
  markupOrText: string,
  opts?: { kind?: Note['kind']; snippet?: string; updateOnly?: boolean; showActions?: boolean }
) {
  // 如果是更新模式且气泡已存在，只更新内容
  if (opts?.updateOnly && resultBubbleEl) {
    const content = resultBubbleEl.querySelector('.ai-bubble-content')
    if (content) {
      content.innerHTML = renderMarkdown(markupOrText)
      // 更新存储的文本内容（用于保存）
      resultBubbleEl.setAttribute('data-full-text', markupOrText)
      return
    }
  }
  
  // 否则重新创建
  hideResultBubble()
  const el = document.createElement('div')
  el.className = 'ai-result-bubble'
  // 存储完整文本内容（用于保存）
  el.setAttribute('data-full-text', markupOrText)
  
  // 内容区域
  const content = document.createElement('div')
  content.className = 'ai-bubble-content'
  content.innerHTML = renderMarkdown(markupOrText)
  el.appendChild(content)

  // 如果提供了保存选项且 showActions 为 true，添加 Save 按钮
  if (opts?.kind && opts?.snippet && opts?.showActions) {
    const actions = document.createElement('div')
    actions.className = 'ai-bubble-actions'
    
    const saveBtn = document.createElement('button')
    saveBtn.className = 'ai-bubble-save'
    saveBtn.innerHTML = 'Save to Notes'
    saveBtn.addEventListener('click', async () => {
      // 从元素中读取最新的完整文本
      const currentText = el.getAttribute('data-full-text') || markupOrText
      await saveNoteToStore(opts.kind!, currentText, opts.snippet)
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

// 添加保存按钮到已存在的气泡
function addSaveButtonToBubble(kind: Note['kind'], snippet: string) {
  if (!resultBubbleEl) return
  
  // 检查是否已有 actions 区域
  let actions = resultBubbleEl.querySelector('.ai-bubble-actions') as HTMLDivElement | null
  if (!actions) {
    actions = document.createElement('div')
    actions.className = 'ai-bubble-actions'
    resultBubbleEl.appendChild(actions)
  }
  
  const saveBtn = document.createElement('button')
  saveBtn.className = 'ai-bubble-save'
  saveBtn.innerHTML = 'Save to Notes'
  saveBtn.addEventListener('click', async () => {
    // 从元素中读取最新的完整文本
    const currentText = resultBubbleEl!.getAttribute('data-full-text') || ''
    await saveNoteToStore(kind, currentText, snippet)
    saveBtn.innerHTML = '✓ Saved'
    saveBtn.disabled = true
  })
  
  actions.appendChild(saveBtn)
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

// 简单的 markdown 渲染（支持列表）
function renderMarkdown(text: string): string {
  // 先去除首尾空白，避免多余的空行
  const trimmedText = text.trim()
  
  // 检测是否是 markdown 列表格式
  const lines = trimmedText.split('\n')
  const isMarkdownList = lines.some(line => /^[-*]\s/.test(line.trim()))
  
  if (isMarkdownList) {
    // 将 markdown 列表转换为 HTML 列表
    let html = '<ul style="margin: 0; padding-left: 20px;">'
    lines.forEach(line => {
      const trimmed = line.trim()
      if (/^[-*]\s/.test(trimmed)) {
        // 列表项
        const content = trimmed.replace(/^[-*]\s/, '')
        html += `<li>${escapeHtml(content)}</li>`
      } else if (trimmed) {
        // 非列表项的文本
        html += `<li>${escapeHtml(trimmed)}</li>`
      }
    })
    html += '</ul>'
    return html
  }
  
  // 不是列表，使用普通格式
  return escapeHtml(trimmedText).replace(/\n/g, '<br/>')
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

  // 禁用 tooltip 的所有按钮
  const tip = document.getElementById('__ai_companion_tip__')
  const buttons = tip?.querySelectorAll('button') as NodeListOf<HTMLButtonElement>
  buttons?.forEach(btn => btn.disabled = true)

  const targetLang = (await getSetting<string>('targetLang')) || 'en'  // 默认英语
  console.log('[Content] Target language from storage:', targetLang)

  try {
    if (action === 'summ') {
      // 先显示加载提示
      showResultBubble('Generating summary...', { showActions: false })
      
      // 使用流式更新 - 选中文本用 key-points（要点列表）
      const result = await summarize(selected, {
        type: 'key-points',
        lang: targetLang,
        onChunk: (chunk) => {
          // 直接更新内容
          showResultBubble(chunk, { kind: 'summary', snippet: selected, updateOnly: true })
        }
      })
      
      // 生成完成后，只在非警告消息时添加保存按钮
      // 警告消息以 ⚠️ 开头
      if (result && !result.startsWith('⚠️')) {
        addSaveButtonToBubble('summary', selected)
      }
    } else if (action === 'exp') {
      // 先显示加载提示
      showResultBubble('Generating explanation...', { showActions: false })
      
      try {
        // 检查词数，只有 ≤4 个词时才提取上下文
        const wordCount = selected.trim().split(/\s+/).length
        console.log('[Content] Selected text word count:', wordCount)
        
        let context: string | undefined
        if (wordCount <= 4) {
          // 短语：提取前后各一句话作为上下文
          context = getContextForExplain(selected)
          console.log('[Content] Short phrase detected - extracting context:', context)
        } else {
          // 长文本：不需要额外上下文
          console.log('[Content] Long text detected - no additional context needed')
        }
        
        // 使用流式更新
        const result = await explain(selected, {
          context,
          lang: targetLang,
          onChunk: (chunk) => {
            // 直接更新内容
            showResultBubble(chunk, { kind: 'explain', snippet: selected, updateOnly: true })
          }
        })
        
        // 如果结果是空的（可能被中止），不添加保存按钮
        if (result && result.trim()) {
          // 生成完成后，添加保存按钮
          addSaveButtonToBubble('explain', selected)
        }
      } catch (explainError) {
        console.error('[Content] Explain error:', explainError)
        showResultBubble('⚠️ Failed to generate explanation. Please refresh the page and try again later.')
      }
    } else if (action === 'tr') {
      // 先显示加载提示
      showResultBubble('Translating...', { showActions: false })
      
      // 使用流式更新翻译
      await translate(selected, { 
        targetLang,
        onChunk: (chunk) => {
          // 直接更新内容
          showResultBubble(chunk, { kind: 'translation', snippet: selected, updateOnly: true })
        }
      })
      
      // 生成完成后，添加保存按钮
      addSaveButtonToBubble('translation', selected)
    }
  } catch (e) {
    console.error('[AI action error]', e)
    showResultBubble('⚠️ Failed to generate result. Please refresh the page and try again later.')
  } finally {
    // 重新启用 tooltip 的所有按钮
    buttons?.forEach(btn => btn.disabled = false)
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
let isGeneratingPageSummary = false  // 防止重复生成页面摘要

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
    let isProcessing = false
    const onPointerUp = async () => {
      if (!dragging) return
      dragging = false; el.classList.remove('dragging')
      if (moved) {
        const rect = el.getBoundingClientRect()
        await setSetting('floatPos', { left: rect.left, top: rect.top })
        return
      }
      
      // 如果侧边栏打开，关闭它
      if (sidePanelOpen) { 
        hideSidePanel()
        return 
      }
      
      // 侧边栏关闭的情况下
      // 如果正在生成，打开侧边栏显示进度（不重新生成）
      if (isGeneratingPageSummary) {
        console.log('[Float Button] Opening panel to show generation progress')
        ensureSidePanel()
        sidePanelEl?.classList.add('open')
        sidePanelOpen = true
        return
      }
      
      // 没有在生成，防止重复点击启动新的生成
      if (isProcessing) return
      isProcessing = true
      
      icon.classList.add('spinning')
      try {
        await openPanelAndSummarizePage()
      } finally {
        icon.classList.remove('spinning')
        isProcessing = false
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
  

async function openPanelAndSummarizePage(forceRefresh = false) {
    // 如果正在生成，只打开侧边栏显示进度，不重新生成
    if (isGeneratingPageSummary) {
      console.log('[AI] Already generating, opening panel to show progress')
      ensureSidePanel()
      if (!sidePanelOpen) {
        sidePanelEl?.classList.add('open')
        sidePanelOpen = true
      }
      return
    }
    
    ensureSidePanel()
    showSidePanel('Loading...')
    
    const currentUrl = location.href
    
    try {
      // 检查缓存（除非强制刷新）
      if (!forceRefresh) {
        const cached = await getPageSummary(currentUrl)
        if (cached) {
          // 显示缓存的结果
          renderPageSummary(cached.summary, cached.text)
          return
        }
      }
      
      // 设置生成标志
      isGeneratingPageSummary = true
      
      // 禁用现有按钮（如果有）
      const existingSaveBtn = document.getElementById('__ai_save_page_note__') as HTMLButtonElement | null
      const existingRefreshBtn = document.getElementById('__ai_refresh_summary__') as HTMLButtonElement | null
      if (existingSaveBtn) existingSaveBtn.disabled = true
      if (existingRefreshBtn) existingRefreshBtn.disabled = true
      
      // 生成新的摘要
      showSidePanel('Generating summary...')
      const text = extractReadableText(document)
      
      let isFirstChunk = true
      
      // 使用流式更新 - 整页用 tldr（简短概述）
      const targetLang = (await getSetting<string>('targetLang')) || 'en'
      const res = await summarize(text, {
        type: 'tldr',
        lang: targetLang,
        onChunk: (chunk) => {
          if (isFirstChunk) {
            // 第一次创建完整结构（不显示按钮）
            sidePanelContentEl!.innerHTML = `
              <div class="ai-panel-content-wrapper">
                <div class="ai-panel-text">${escapeHtml(chunk).replace(/\n/g, '<br/>')}</div>
              </div>
            `
            isFirstChunk = false
          } else {
            // 后续只更新文本内容（chunk 是累积的完整结果）
            const textEl = sidePanelContentEl!.querySelector('.ai-panel-text')
            if (textEl) {
              textEl.innerHTML = escapeHtml(chunk).replace(/\n/g, '<br/>')
            }
          }
        }
      })
      
      // 保存到缓存
      await setPageSummary(currentUrl, res, text)
      
      // 显示最终结果和按钮（启用状态）
      renderPageSummary(res, text)
    } catch (e) {
      console.error(e)
      showSidePanel('⚠️ Failed to summarize this page.')
    } finally {
      // 重置生成标志
      isGeneratingPageSummary = false
    }
}

function renderPageSummary(summary: string, text: string) {
  sidePanelContentEl!.innerHTML = `
    <div class="ai-panel-content-wrapper">
      <div class="ai-panel-text">${escapeHtml(summary).replace(/\n/g, '<br/>')}</div>
    </div>
    <div class="ai-panel-actions">
      <button id="__ai_save_page_note__">Save to Notes</button>
      <button id="__ai_refresh_summary__">🔄 Refresh</button>
    </div>
  `
  
  const saveBtn = document.getElementById('__ai_save_page_note__') as HTMLButtonElement | null
  saveBtn?.addEventListener('click', async () => {
    // 防止重复保存
    if (saveBtn.disabled) return
    
    // 禁用按钮并显示保存状态
    saveBtn.disabled = true
    saveBtn.textContent = 'Saving...'
    
    try {
      await saveNoteToStore('summary', summary, text.slice(0, 300))
      saveBtn.textContent = 'Saved ✓'
    } catch (e) {
      console.error('[Save error]', e)
      // 保存失败，恢复按钮状态
      saveBtn.disabled = false
      saveBtn.textContent = 'Save to Notes'
    }
  })
  
  const refreshBtn = document.getElementById('__ai_refresh_summary__') as HTMLButtonElement | null
  refreshBtn?.addEventListener('click', async () => {
    // 防止重复生成
    if (isGeneratingPageSummary) {
      console.log('[AI] Already generating, ignoring refresh request')
      return
    }
    
    // 禁用按钮直到生成完成
    if (refreshBtn) refreshBtn.disabled = true
    
    try {
      await clearPageSummary(location.href)
      await openPanelAndSummarizePage(true)
    } finally {
      // 重新启用按钮
      if (refreshBtn) refreshBtn.disabled = false
    }
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
    sidePanelContentEl!.innerHTML = `
      <div class="ai-panel-content-wrapper">
        <div class="ai-panel-text">${escapeHtml(initialText)}</div>
      </div>
    `
  }
}

function hideSidePanel() {
  sidePanelEl?.classList.remove('open')
  sidePanelOpen = false
  // if (floatBtnEl) clampFloatIntoView(floatBtnEl)
}

ensureTooltip()

// 只在顶层框架创建悬浮球和侧边栏（避免 iframe 中重复创建）
if (window.self === window.top) {
  ensureFloatingButton()
  
  // 预加载 keepalive session 以保持 LanguageModel ready
  // 延迟 2 秒避免影响页面初始加载性能
  setTimeout(() => {
    ensureKeepaliveSession().catch(err => {
      console.log('[AI] Background keepalive session creation skipped:', err.message)
    })
  }, 2000)
}

/* 诊断 Chrome AI API 状态
;(async () => {
  await __diagnoseAI()
})()
*/

/** ---------------- 背景消息（右键菜单触发） ---------------- */
chrome.runtime.onMessage.addListener((msg: Msg | any, _s, sendResponse) => {
  // 悬浮球和页面摘要相关消息只在顶层框架处理
  if (window.self !== window.top) {
    return false
  }
  
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

// 页面卸载时清理 AI 资源
window.addEventListener('beforeunload', () => {
  destroyResources()
})
