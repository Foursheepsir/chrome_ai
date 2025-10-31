import { getSelectionText, extractReadableText } from '../services/domExtract'
import { summarize, explain, translate, destroyResources, destroyExplainSession, abortSummarize, abortTranslate, ensureKeepaliveSession, createPageChatSession, askPageQuestion, destroyPageChatSession, hasPageChatSession } from '../services/aiService'
import { addNote, getSetting, setSetting, getPageSummary, setPageSummary, clearPageSummary, getPageChatHistory, setPageChatHistory, clearPageChatHistory, hashText, type ChatMessage } from '../services/storage'
import type { Msg, Note } from '../utils/messaging'
import { nanoid } from 'nanoid'
import { marked } from 'marked'

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

// 配置 marked
marked.setOptions({
  breaks: true, // 支持 GitHub 风格的换行（单个换行符转为 <br>）
  gfm: true, // 启用 GitHub Flavored Markdown
  pedantic: false, // 不使用严格模式，更宽松地解析
})

// 使用 marked 渲染 markdown（支持纯文本和 markdown 混合）
function renderMarkdown(text: string): string {
  if (!text) return ''
  
  try {
    // 使用 marked 渲染（会自动处理纯文本和 markdown）
    const html = marked.parse(text, { async: false }) as string
    
    // 为生成的 HTML 添加内联样式
    return html
      .replace(/<p>/g, '<p style="margin: 8px 0; line-height: 1.6;">')
      .replace(/<ul>/g, '<ul style="margin: 8px 0; padding-left: 24px;">')
      .replace(/<ol>/g, '<ol style="margin: 8px 0; padding-left: 24px;">')
      .replace(/<li>/g, '<li style="margin: 4px 0;">')
      .replace(/<h1>/g, '<h1 style="font-size: 1.8em; font-weight: bold; margin: 12px 0 8px 0;">')
      .replace(/<h2>/g, '<h2 style="font-size: 1.5em; font-weight: bold; margin: 12px 0 8px 0;">')
      .replace(/<h3>/g, '<h3 style="font-size: 1.3em; font-weight: bold; margin: 12px 0 8px 0;">')
      .replace(/<h4>/g, '<h4 style="font-size: 1.1em; font-weight: bold; margin: 10px 0 6px 0;">')
      .replace(/<h5>/g, '<h5 style="font-size: 1em; font-weight: bold; margin: 10px 0 6px 0;">')
      .replace(/<h6>/g, '<h6 style="font-size: 0.9em; font-weight: bold; margin: 10px 0 6px 0;">')
      .replace(/<code>/g, '<code style="background: #f5f5f5; padding: 2px 4px; border-radius: 3px; font-family: monospace; font-size: 0.9em;">')
      .replace(/<pre>/g, '<pre style="background: #f5f5f5; padding: 12px; border-radius: 6px; overflow-x: auto; margin: 12px 0;">')
      .replace(/<blockquote>/g, '<blockquote style="border-left: 4px solid #ddd; padding-left: 16px; margin: 12px 0; color: #666;">')
      .replace(/<a /g, '<a target="_blank" rel="noopener noreferrer" style="color: #1a73e8; text-decoration: none;" ')
      .replace(/<strong>/g, '<strong style="font-weight: 600;">')
      .replace(/<em>/g, '<em style="font-style: italic;">')
  } catch (e) {
    console.error('[Markdown render error]', e)
    // 降级：返回转义的纯文本，保留换行
    return '<p style="margin: 8px 0; line-height: 1.6;">' + escapeHtml(text).replace(/\n/g, '<br/>') + '</p>'
  }
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

// Page Chat 相关状态
let chatMessages: ChatMessage[] = []  // 当前对话历史
let currentPageText = ''  // 当前页面文本
let currentPageSummary = ''  // 当前页面摘要
let isChatMode = false  // 是否在聊天模式
let isGeneratingChat = false  // 是否正在生成聊天回复

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
  
    // Tooltip 提示（悬停时显示）
    const tooltip = document.createElement('div')
    tooltip.className = 'ai-float-tooltip'
    tooltip.innerHTML = 'Click to summarize the page & Ask any follow-up questions!'
    el.appendChild(tooltip)
  
    // Hover 显示/隐藏 tooltip
    el.addEventListener('mouseenter', () => {
      if (!dragging) {
        tooltip.classList.add('visible')
      }
    })
    el.addEventListener('mouseleave', () => {
      tooltip.classList.remove('visible')
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
      tooltip.classList.remove('visible')  // 拖动时隐藏 tooltip
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
          // 保存到全局状态（用于 chat）
          currentPageText = cached.text
          currentPageSummary = cached.summary
          
          // 尝试加载对话历史（使用哈希值比较，高效！）
          const chatHistory = await getPageChatHistory(currentUrl)
          if (chatHistory && chatHistory.contentHash === cached.contentHash) {
            // 页面内容没变，恢复对话历史
            console.log('[Content] ✅ Page unchanged after refresh/reload, restoring chat history')
            console.log('[Content] 📜 Restored', chatHistory.messages.length, 'messages from storage')
            chatMessages = chatHistory.messages
          } else {
            // 页面内容变了或没有历史，清空
            console.log('[Content] ❌ Page content changed or no history, clearing chat')
            chatMessages = []
            await clearPageChatHistory(currentUrl)
          }
          
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
      
      // 保存到全局状态（用于 chat）
      currentPageText = text
      currentPageSummary = res
      
      // 计算当前页面内容的哈希值
      const currentHash = await hashText(text)
      
      // 尝试加载对话历史（使用哈希值比较，高效！）
      const chatHistory = await getPageChatHistory(currentUrl)
      if (chatHistory && chatHistory.contentHash === currentHash) {
        // 页面内容没变，恢复对话历史
        console.log('[Content] ✅ Page content matches, restoring chat history')
        console.log('[Content] 📜 Restored', chatHistory.messages.length, 'messages from storage')
        chatMessages = chatHistory.messages
      } else {
        // 页面内容变了或没有历史，清空
        console.log('[Content] ❌ Page content changed or no history, clearing chat')
        chatMessages = []
        await clearPageChatHistory(currentUrl)
      }
      
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
  // 构建基础 HTML
  let html = `
    <div class="ai-panel-content-wrapper">
      <div class="ai-panel-text">${escapeHtml(summary).replace(/\n/g, '<br/>')}</div>
    </div>
    <div class="ai-panel-actions">
      <button id="__ai_save_page_note__">Save to Notes</button>
      <button id="__ai_refresh_summary__">🔄 Refresh</button>
      <button id="__ai_ask_followup__">💬 Ask Follow-up</button>
    </div>
  `
  
  // 如果有对话历史，渲染聊天界面
  if (chatMessages.length > 0 || isChatMode) {
    html += `<div id="__ai_chat_container__" class="ai-chat-container"></div>`
  }
  
  sidePanelContentEl!.innerHTML = html
  
  // Save button
  const saveBtn = document.getElementById('__ai_save_page_note__') as HTMLButtonElement | null
  saveBtn?.addEventListener('click', async () => {
    if (saveBtn.disabled) return
    saveBtn.disabled = true
    saveBtn.textContent = 'Saving...'
    try {
      await saveNoteToStore('summary', summary, text.slice(0, 300))
      saveBtn.textContent = 'Saved ✓'
    } catch (e) {
      console.error('[Save error]', e)
      saveBtn.disabled = false
      saveBtn.textContent = 'Save to Notes'
    }
  })
  
  // Refresh button - 清空一切，重新开始
  const refreshBtn = document.getElementById('__ai_refresh_summary__') as HTMLButtonElement | null
  refreshBtn?.addEventListener('click', async () => {
    if (isGeneratingPageSummary || isGeneratingChat) {
      console.log('[AI] Generation in progress, canceling and refreshing')
    }
    
    // 停止当前生成
    abortSummarize()
    destroyPageChatSession()
    
    // 清空状态
    isChatMode = false
    isGeneratingChat = false
    chatMessages = []
    currentPageText = ''
    currentPageSummary = ''
    
    // 清空缓存
    await clearPageSummary(location.href)
    await clearPageChatHistory(location.href)
    
    // 重新生成
    await openPanelAndSummarizePage(true)
  })
  
  // Ask Follow-up button
  const askBtn = document.getElementById('__ai_ask_followup__') as HTMLButtonElement | null
  askBtn?.addEventListener('click', async () => {
    if (!isChatMode) {
      // 第一次点击，进入聊天模式
      isChatMode = true
      
      // 创建 chat session（包含恢复的聊天历史）
      const targetLang = (await getSetting<string>('targetLang')) || 'en'
      console.log('[Content] Creating chat session with', chatMessages.length, 'restored messages')
      const success = await createPageChatSession({
        pageText: currentPageText,
        pageSummary: currentPageSummary,
        lang: targetLang,
        chatHistory: chatMessages.length > 0 ? chatMessages : undefined
      })
      
      if (!success) {
        isChatMode = false
        alert('Failed to initialize chat session. Please try again.')
        return
      }
      
      // 重新渲染整个面板以显示聊天界面
      renderPageSummary(currentPageSummary, currentPageText)
    }
  })
  
  // 如果已经在聊天模式或有历史，渲染聊天UI
  if (chatMessages.length > 0 || isChatMode) {
    renderChatUI()
  }
}

// 渲染聊天 UI
function renderChatUI() {
  const chatContainer = document.getElementById('__ai_chat_container__')
  if (!chatContainer) return
  
  // 构建聊天消息列表（无历史时不渲染消息容器，避免与按钮间出现空白）
  let messagesHTML = ''
  if (chatMessages.length > 0) {
    messagesHTML = '<div class="ai-chat-messages" id="__ai_chat_messages__">'
    chatMessages.forEach((msg, idx) => {
      const className = msg.role === 'user' ? 'ai-chat-message-user' : 'ai-chat-message-assistant'
      const contentHtml = msg.role === 'assistant'
        ? renderMarkdown(msg.content)
        : escapeHtml(msg.content).replace(/\n/g, '<br/>')
      const isLastAssistantStreaming = isGeneratingChat && idx === chatMessages.length - 1 && msg.role === 'assistant'
      messagesHTML += `
        <div class="${className}">
          <div class="ai-chat-message-content" ${isLastAssistantStreaming ? 'id="__ai_chat_last_msg__"' : ''}>${contentHtml}</div>
        </div>
      `
    })
    messagesHTML += '</div>'
  }
  
  // 输入区域
  const inputHTML = `
    <div class="ai-chat-input-container">
      <textarea 
        id="__ai_chat_input__" 
        class="ai-chat-input" 
        placeholder="Ask anything about this page..."
        ${isGeneratingChat ? 'disabled' : ''}
      ></textarea>
      <button 
        id="__ai_chat_submit__" 
        class="ai-chat-submit ${isGeneratingChat ? 'generating' : ''}"
        ${isGeneratingChat ? 'title="Stop generating"' : 'title="Send message"'}
      >
        ${isGeneratingChat ? '⬛' : '➤'}
      </button>
    </div>
  `
  
  chatContainer.innerHTML = messagesHTML + inputHTML
  
  // 滚动到底部
  const messagesContainer = document.getElementById('__ai_chat_messages__')
  if (messagesContainer) {
    messagesContainer.scrollTop = messagesContainer.scrollHeight
  }
  
  // 绑定事件
  const input = document.getElementById('__ai_chat_input__') as HTMLTextAreaElement | null
  const submitBtn = document.getElementById('__ai_chat_submit__') as HTMLButtonElement | null
  
  if (input && submitBtn) {
    // Enter 发送（Shift+Enter 换行）
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        if (!isGeneratingChat && input.value.trim()) {
          handleChatSubmit(input.value.trim())
        }
      }
    })
    
    // 提交按钮
    submitBtn.addEventListener('click', () => {
      if (isGeneratingChat) {
        // 停止生成
        destroyPageChatSession()
        isGeneratingChat = false
        // 切换按钮与输入框状态（避免整块重渲染导致跳动）
        submitBtn.classList.remove('generating')
        submitBtn.title = 'Send message'
        submitBtn.textContent = '➤'
        if (input) input.disabled = false
      } else if (input.value.trim()) {
        handleChatSubmit(input.value.trim())
      }
    })
  }
}

// 处理聊天提交
async function handleChatSubmit(question: string) {
  const input = document.getElementById('__ai_chat_input__') as HTMLTextAreaElement | null
  if (!input) return
  
  // 清空输入框
  input.value = ''
  
  // 添加用户消息
  const userMessage: ChatMessage = {
    role: 'user',
    content: question,
    timestamp: Date.now()
  }
  chatMessages.push(userMessage)
  
  // 设置生成标志
  isGeneratingChat = true
  // 切换按钮与输入框状态（避免整块重渲染导致跳动）
  const submitBtn = document.getElementById('__ai_chat_submit__') as HTMLButtonElement | null
  if (submitBtn) {
    submitBtn.classList.add('generating')
    submitBtn.title = 'Stop generating'
    submitBtn.textContent = '⬛'
  }
  input.disabled = true
  
  // 将用户消息增量插入到 DOM（避免整块重渲染）
  const messagesContainer = document.getElementById('__ai_chat_messages__') as HTMLDivElement | null
  if (messagesContainer) {
    const userHtml = `
      <div class="ai-chat-message-user">
        <div class="ai-chat-message-content">${escapeHtml(userMessage.content).replace(/\n/g, '<br/>')}</div>
      </div>
    `
    messagesContainer.insertAdjacentHTML('beforeend', userHtml)
    messagesContainer.scrollTop = messagesContainer.scrollHeight
  }
  
  try {
    // 确保 session 存在（包含当前的聊天历史作为上下文）
    if (!hasPageChatSession()) {
      const targetLang = (await getSetting<string>('targetLang')) || 'en'
      // 注意：此时 userMessage 已经添加到 chatMessages，所以要排除最后一条
      const historyForSession = chatMessages.slice(0, -1)
      console.log('[Content] Session destroyed, recreating with', historyForSession.length, 'history messages')
      if (historyForSession.length > 0) {
        console.log('[Content] Passing history to new session')
      }
      const success = await createPageChatSession({
        pageText: currentPageText,
        pageSummary: currentPageSummary,
        lang: targetLang,
        chatHistory: historyForSession.length > 0 ? historyForSession : undefined
      })
      
      if (!success) {
        throw new Error('Failed to create chat session')
      }
    }
    
    // 添加一个临时的 assistant 消息用于显示流式内容（增量插入，避免整块重渲染）
    const assistantMessage: ChatMessage = {
      role: 'assistant',
      content: '',
      timestamp: Date.now()
    }
    chatMessages.push(assistantMessage)
    const existingLast = document.getElementById('__ai_chat_last_msg__')
    if (existingLast) existingLast.removeAttribute('id')
    const messagesContainer2 = document.getElementById('__ai_chat_messages__') as HTMLDivElement | null
    if (messagesContainer2) {
      const assistantHtml = `
        <div class="ai-chat-message-assistant">
          <div class="ai-chat-message-content" id="__ai_chat_last_msg__"></div>
        </div>
      `
      messagesContainer2.insertAdjacentHTML('beforeend', assistantHtml)
      messagesContainer2.scrollTop = messagesContainer2.scrollHeight
    }
    
    // 获取目标语言
    const targetLang = (await getSetting<string>('targetLang')) || 'en'
    
    // 调用 AI
    const response = await askPageQuestion(question, {
      lang: targetLang,
      onChunk: (chunk) => {
        // 更新最后一条助手消息（只更新内容避免整块重渲染导致闪烁）
        if (chatMessages.length > 0) {
          chatMessages[chatMessages.length - 1].content = chunk
          const lastEl = document.getElementById('__ai_chat_last_msg__')
          if (lastEl) {
            lastEl.innerHTML = renderMarkdown(chunk)
            const messagesContainer = document.getElementById('__ai_chat_messages__')
            if (messagesContainer) {
              messagesContainer.scrollTop = messagesContainer.scrollHeight
            }
          } else {
            // 如果找不到元素（首次或结构变化），回退到重新渲染
            renderChatUI()
          }
        }
      }
    })
    
    // 如果响应为空（被中止），移除临时消息
    if (!response || !response.trim()) {
      chatMessages.pop()
    }
    
    // 保存对话历史（使用哈希值标识页面内容）
    const contentHash = await hashText(currentPageText)
    await setPageChatHistory(location.href, {
      messages: chatMessages,
      contentHash,
      pageSummary: currentPageSummary
    })
  } catch (e) {
    console.error('[Chat error]', e)
    // 移除临时的 assistant 消息
    if (chatMessages.length > 0 && chatMessages[chatMessages.length - 1].role === 'assistant') {
      chatMessages.pop()
    }
    // 添加错误消息
    const errorMsg: ChatMessage = {
      role: 'assistant',
      content: '⚠️ Failed to get response. Please try again.',
      timestamp: Date.now()
    }
    chatMessages.push(errorMsg)
    const messagesContainer3 = document.getElementById('__ai_chat_messages__') as HTMLDivElement | null
    if (messagesContainer3) {
      const errHtml = `
        <div class="ai-chat-message-assistant">
          <div class="ai-chat-message-content">${escapeHtml(errorMsg.content).replace(/\n/g, '<br/>')}</div>
        </div>
      `
      messagesContainer3.insertAdjacentHTML('beforeend', errHtml)
      messagesContainer3.scrollTop = messagesContainer3.scrollHeight
    }
  } finally {
    isGeneratingChat = false
    // 切回发送状态（避免整块重渲染）
    const submitBtn2 = document.getElementById('__ai_chat_submit__') as HTMLButtonElement | null
    const input2 = document.getElementById('__ai_chat_input__') as HTMLTextAreaElement | null
    if (submitBtn2) {
      submitBtn2.classList.remove('generating')
      submitBtn2.title = 'Send message'
      submitBtn2.textContent = '➤'
    }
    if (input2) input2.disabled = false
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
