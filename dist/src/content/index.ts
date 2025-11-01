/**
 * Content Script - Main Entry Point
 * 
 * This script is injected into every web page and provides:
 * 1. Selection Tooltip - Quick actions for selected text (Summarize, Explain, Translate, Save)
 * 2. Result Bubble - Displays AI-generated results in a floating bubble
 * 3. Floating Button - Always-accessible button for page-level actions
 * 4. Side Panel - Full-page summary and AI chat interface
 * 5. Page Chat - Multi-turn conversation about the current page
 */

import { getSelectionText, extractReadableText } from '../services/domExtract'
import { summarize, explain, translate, destroyResources, destroyExplainSession, abortSummarize, abortTranslate, ensureKeepaliveSession, createPageChatSession, askPageQuestion, destroyPageChatSession, hasPageChatSession, getPageChatTokenUsage, abortPageChatGeneration } from '../services/aiService'
import { addNote, getSetting, setSetting, getPageSummary, setPageSummary, clearPageSummary, updatePageSummarySaveStatus, getPageChatHistory, setPageChatHistory, clearPageChatHistory, hashText, type ChatMessage } from '../services/storage'
import type { Msg, Note } from '../utils/messaging'
import { nanoid } from 'nanoid'
import { marked } from 'marked'

/**
 * Extract surrounding context for better explanation
 * 
 * For short phrases (<=4 words), we extract one sentence before and after
 * to give the AI model more context for generating accurate explanations.
 * 
 * @param selectedText - The text selected by the user
 * @returns The selected text with surrounding context, or just the selected text if extraction fails
 */
function getContextForExplain(selectedText: string): string {
  try {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return selectedText
    
    const range = selection.getRangeAt(0)
    const container = range.commonAncestorContainer
    
    const parentElement = container.nodeType === Node.TEXT_NODE 
      ? container.parentElement 
      : container as Element
    
    if (!parentElement) return selectedText
    
    const fullText = parentElement.textContent || ''
    
    const selectionStart = fullText.indexOf(selectedText)
    if (selectionStart === -1) return selectedText
    
    const beforeText = fullText.substring(0, selectionStart)
    const afterText = fullText.substring(selectionStart + selectedText.length)
    
    const sentenceEndRegex = /[.!?\n]/
    const beforeSentences = beforeText.split(sentenceEndRegex)
    const prevSentence = beforeSentences.length > 0 
      ? beforeSentences[beforeSentences.length - 1].trim() 
      : ''
    
    const nextSentenceMatch = afterText.match(/^[^.!?\n]+[.!?\n]?/)
    const nextSentence = nextSentenceMatch ? nextSentenceMatch[0].trim() : ''
    
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

// ============================================================================
// Selection Tooltip - Quick actions for selected text
// ============================================================================

let lastSelectionRect: DOMRect | null = null  // Store selection position for result bubble placement
let resultBubbleEl: HTMLDivElement | null = null  // Result bubble DOM element

/**
 * Create or retrieve the selection tooltip element
 * The tooltip contains action buttons that appear when text is selected
 */
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

/**
 * Position the tooltip below the selected text
 */
function positionTooltip(tip: HTMLDivElement) {
  const sel = document.getSelection()
  if (!sel || sel.rangeCount === 0) return
  const rect = sel.getRangeAt(0).getBoundingClientRect()
  lastSelectionRect = rect  // Store for result bubble positioning
  tip.style.top = `${window.scrollY + rect.bottom + 6}px`
  tip.style.left = `${window.scrollX + rect.left}px`
  tip.style.display = 'flex'
}

// Show/hide tooltip on text selection
document.addEventListener('mouseup', () => {
  const txt = getSelectionText()
  const tip = ensureTooltip()
  tip.style.display = txt ? 'flex' : 'none'
  if (txt) positionTooltip(tip)
})

// ============================================================================
// Result Bubble - Displays AI-generated results
// ============================================================================

/**
 * Hide the result bubble and abort any ongoing AI operations
 */
function hideResultBubble() {
  abortSummarize()
  abortTranslate()
  destroyExplainSession()
  
  resultBubbleEl?.remove()
  resultBubbleEl = null
}

/**
 * Show or update the result bubble with AI-generated content
 * 
 * The result bubble displays AI responses (summary, explanation, translation) near
 * the selected text. It supports streaming updates for real-time content display.
 * 
 * @param markupOrText - The content to display (can include markdown)
 * @param opts - Options for displaying the bubble
 *   - kind: Type of note (summary, explain, translation, note)
 *   - snippet: Original text snippet
 *   - updateOnly: If true, only update existing bubble content (for streaming)
 *   - showActions: Whether to show the save button
 */
function showResultBubble(
  markupOrText: string,
  opts?: { kind?: Note['kind']; snippet?: string; updateOnly?: boolean; showActions?: boolean }
) {
  // For streaming updates, just update the content without recreating the entire bubble
  if (opts?.updateOnly && resultBubbleEl) {
    const content = resultBubbleEl.querySelector('.ai-bubble-content')
    if (content) {
      content.innerHTML = renderMarkdown(markupOrText)
      resultBubbleEl.setAttribute('data-full-text', markupOrText)
      return
    }
  }
  
  // Create new bubble
  hideResultBubble()
  const el = document.createElement('div')
  el.className = 'ai-result-bubble'
  el.setAttribute('data-full-text', markupOrText)  // Store full text for saving
  
  // Content area
  const content = document.createElement('div')
  content.className = 'ai-bubble-content'
  content.innerHTML = renderMarkdown(markupOrText)
  el.appendChild(content)

  // Add save button if options are provided
  if (opts?.kind && opts?.snippet && opts?.showActions) {
    const actions = document.createElement('div')
    actions.className = 'ai-bubble-actions'
    
    const saveBtn = document.createElement('button')
    saveBtn.className = 'ai-bubble-save'
    saveBtn.innerHTML = 'Save to Notes'
    saveBtn.addEventListener('click', async () => {
      const currentText = el.getAttribute('data-full-text') || markupOrText
      await saveNoteToStore(opts.kind!, currentText, opts.snippet)
      saveBtn.innerHTML = '✓ Saved'
      saveBtn.disabled = true
    })
    
    actions.appendChild(saveBtn)
    el.appendChild(actions)
  }

  document.documentElement.appendChild(el)

  // Position near the selected text
  const base = lastSelectionRect
  const top = base ? window.scrollY + base.bottom + 8 : window.scrollY + 80
  const left = base ? window.scrollX + base.left : window.scrollX + 80
  el.style.top = `${top}px`
  el.style.left = `${left}px`

  resultBubbleEl = el
}

/**
 * Add a save button to an existing result bubble
 * Used after AI generation completes to allow saving the result
 */
function addSaveButtonToBubble(kind: Note['kind'], snippet: string) {
  if (!resultBubbleEl) return
  
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
    const currentText = resultBubbleEl!.getAttribute('data-full-text') || ''
    await saveNoteToStore(kind, currentText, snippet)
    saveBtn.innerHTML = '✓ Saved'
    saveBtn.disabled = true
  })
  
  actions.appendChild(saveBtn)
}

// Hide result bubble when clicking outside
document.addEventListener('mousedown', (e) => {
  const target = e.target as Node
  const tip = document.getElementById('__ai_companion_tip__')
  if (resultBubbleEl && !resultBubbleEl.contains(target) && (!tip || !tip.contains(target))) {
    hideResultBubble()
  }
})

// Hide result bubble on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideResultBubble()
})

/**
 * Escape HTML special characters to prevent XSS
 */
function escapeHtml(str: string) {
  const div = document.createElement('div')
  div.innerText = str
  return div.innerHTML
}

// Configure marked for better markdown rendering
marked.setOptions({
  breaks: true,      // Convert \n to <br>
  gfm: true,         // GitHub Flavored Markdown
  pedantic: false,   // More lenient parsing
})

/**
 * Render markdown text to styled HTML
 * 
 * Converts markdown to HTML with inline styles for consistent display
 * across different web pages (no reliance on external CSS).
 */
function renderMarkdown(text: string): string {
  if (!text) return ''
  
  try {
    const html = marked.parse(text, { async: false }) as string
    
    // Add inline styles to all elements for consistent display
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
    return '<p style="margin: 8px 0; line-height: 1.6;">' + escapeHtml(text).replace(/\n/g, '<br/>') + '</p>'
  }
}

/**
 * Handle tooltip button actions (Summarize, Explain, Translate, Save)
 * 
 * This function processes the selected text using Chrome's Built-in AI APIs
 * and displays the results in a bubble. It supports streaming updates for
 * real-time feedback.
 * 
 * @param action - The action to perform
 */
async function handleAction(action: 'summ' | 'exp' | 'tr' | 'save') {
  const selected = getSelectionText()
  if (!selected) return

  if (action === 'save') {
    try {
      await saveNoteToStore('note', selected)
      showResultBubble('✓ Saved')
      setTimeout(() => hideResultBubble(), 1000)
    } catch (e) {
      console.error('[Save error]', e)
      showResultBubble('⚠️ Failed to save.')
    }
    return
  }

  const tip = document.getElementById('__ai_companion_tip__')
  const buttons = tip?.querySelectorAll('button') as NodeListOf<HTMLButtonElement>
  buttons?.forEach(btn => btn.disabled = true)

  const targetLang = (await getSetting<string>('targetLang')) || 'en'
  console.log('[Content] Target language from storage:', targetLang)

  try {
    if (action === 'summ') {
      showResultBubble('Generating summary... It may take a while for Chrome to download the required models for the first time. Thanks for your patience!', { showActions: false })
      
      const result = await summarize(selected, {
        type: 'key-points',
        lang: targetLang,
        onChunk: (chunk) => {
          showResultBubble(chunk, { kind: 'summary', snippet: selected, updateOnly: true })
        }
      })
      
      if (result && !result.startsWith('⚠️')) {
        addSaveButtonToBubble('summary', selected)
      }
    } else if (action === 'exp') {
      showResultBubble('Generating explanation... It may take a while for Chrome to download the required models for the first time. Thanks for your patience!', { showActions: false })
      
      try {
        const wordCount = selected.trim().split(/\s+/).length
        console.log('[Content] Selected text word count:', wordCount)
        
        let context: string | undefined
        if (wordCount <= 4) {
          context = getContextForExplain(selected)
          console.log('[Content] Short phrase detected - extracting context:', context)
        } else {
          console.log('[Content] Long text detected - no additional context needed')
        }
        
        const result = await explain(selected, {
          context,
          lang: targetLang,
          onChunk: (chunk) => {
            showResultBubble(chunk, { kind: 'explain', snippet: selected, updateOnly: true })
          }
        })
        
        if (result && result.trim()) {
          addSaveButtonToBubble('explain', selected)
        }
      } catch (explainError) {
        console.error('[Content] Explain error:', explainError)
        showResultBubble('⚠️ Failed to generate explanation. Please refresh the page and try again later.')
      }
    } else if (action === 'tr') {
      showResultBubble('Translating... It may take a while for Chrome to download the required models for the first time. Thanks for your patience!', { showActions: false })
      
      await translate(selected, { 
        targetLang,
        onChunk: (chunk) => {
          showResultBubble(chunk, { kind: 'translation', snippet: selected, updateOnly: true })
        }
      })
      
      addSaveButtonToBubble('translation', selected)
    }
  } catch (e) {
    console.error('[AI action error]', e)
    showResultBubble('⚠️ Failed to generate result. Please refresh the page and try again later.')
  } finally {
    buttons?.forEach(btn => btn.disabled = false)
  }
}

/**
 * Save a note to chrome.storage.local
 * 
 * @param kind - Type of note (summary, explain, translation, note)
 * @param text - The main content
 * @param snippet - Optional original text snippet
 */
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

// ============================================================================
// Floating Button + Side Panel - Full page summary and chat
// ============================================================================

// UI Element references
let floatBtnEl: HTMLDivElement | null = null
let sidePanelEl: HTMLDivElement | null = null
let sidePanelContentEl: HTMLDivElement | null = null
let sidePanelOpen = false

// Page summary state
let isGeneratingPageSummary = false  // Prevent duplicate summary generation
let isPageSummarySaved = false       // Track if current summary is saved

// Page chat state
let chatMessages: ChatMessage[] = []  // Conversation history
let currentPageText = ''              // Current page text content
let currentPageSummary = ''           // Current page summary
let isChatMode = false                // Whether chat interface is active
let isGeneratingChat = false          // Whether AI is generating response

/**
 * Create or retrieve the floating button
 * 
 * The floating button is always visible in the bottom-left corner and provides
 * quick access to page-level AI features (summary + chat). It can be dragged
 * to any position and hidden via the close button.
 */
function ensureFloatingButton() {
    if (floatBtnEl) return floatBtnEl
  
    const el = document.createElement('div')
    el.id = '__ai_float_btn__'
    el.className = 'ai-float-btn'
    el.title = 'Summarize this page'
  
    const icon = document.createElement('div')
    icon.className = 'ai-float-icon'
    icon.style.backgroundImage = `url(${chrome.runtime.getURL('icon128.png')})`
    el.appendChild(icon)
  
    const close = document.createElement('div')
    close.className = 'ai-float-close'
    close.textContent = '×'
    el.appendChild(close)
  
    close.addEventListener('click', async (e) => {
      e.stopPropagation()
      el.style.display = 'none'
      await setSetting('floatHidden', true)
    })
  
    const tooltip = document.createElement('div')
    tooltip.className = 'ai-float-tooltip'
    tooltip.innerHTML = 'Click to summarize the page & ask any follow-up questions!'
    el.appendChild(tooltip)
    el.addEventListener('mouseenter', () => {
      if (!dragging) {
        tooltip.classList.add('visible')
      }
    })
    el.addEventListener('mouseleave', () => {
      tooltip.classList.remove('visible')
    })
  
    document.documentElement.appendChild(el)
  
    ;(async () => {
      const pos = await getSetting<{ left: number; top: number }>('floatPos')
      const hidden = await getSetting<boolean>('floatHidden')
      if (pos) {
        el.style.left = `${pos.left}px`
        el.style.top = `${pos.top}px`
      } else {
        el.style.left = '24px'
        el.style.top = `${window.innerHeight - 64 - 24}px`
      }
      el.style.right = 'auto'
      el.style.bottom = 'auto'
      if (hidden) el.style.display = 'none'
    })()
  
    let dragging = false, startX = 0, startY = 0, startLeft = 0, startTop = 0
    let moved = false
    const DRAG_THRESHOLD = 4
  
    const onPointerDown = (clientX: number, clientY: number) => {
      dragging = true; moved = false; el.classList.add('dragging')
      tooltip.classList.remove('visible')
      const rect = el.getBoundingClientRect()
      startLeft = rect.left; startTop = rect.top
      startX = clientX; startY = clientY
    }
    const onPointerMove = (clientX: number, clientY: number) => {
      if (!dragging) return
      const dx = clientX - startX, dy = clientY - startY
      if (!moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
        moved = true
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
      
      if (sidePanelOpen) { 
        hideSidePanel()
        return 
      }
      
      if (isGeneratingPageSummary) {
        console.log('[Float Button] Opening panel to show generation progress')
        ensureSidePanel()
        sidePanelEl?.classList.add('open')
        sidePanelOpen = true
        return
      }
      
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
    if (isGeneratingPageSummary) {
      console.log('[AI] Already generating, opening panel to show progress')
      ensureSidePanel()
      if (!sidePanelOpen) {
        sidePanelEl?.classList.add('open')
        sidePanelOpen = true
      }
      return
    }
    
    if (forceRefresh) {
      isPageSummarySaved = false
    }
    
    ensureSidePanel()
    showSidePanel('Loading...')
    
    const currentUrl = location.href
    
    try {
      if (!forceRefresh) {
        const cached = await getPageSummary(currentUrl)
        if (cached) {
          currentPageText = cached.text
          currentPageSummary = cached.summary
          isPageSummarySaved = cached.isSaved || false
          
          const chatHistory = await getPageChatHistory(currentUrl)
          if (chatHistory && chatHistory.contentHash === cached.contentHash) {
            console.log('[Content] ✅ Page unchanged after refresh/reload, restoring chat history')
            console.log('[Content] 📜 Restored', chatHistory.messages.length, 'messages from storage')
            chatMessages = chatHistory.messages
            
            if (chatMessages.length > 0) {
              isChatMode = true
              console.log('[Content] Setting isChatMode = true (chat history exists)')
            }
          } else {
            console.log('[Content] ❌ Page content changed or no history, clearing chat')
            chatMessages = []
            isChatMode = false
            await clearPageChatHistory(currentUrl)
          }
          
          renderPageSummary(cached.summary, cached.text)
          return
        }
      }
      
      isGeneratingPageSummary = true
      isPageSummarySaved = false
      
      const existingSaveBtn = document.getElementById('__ai_save_page_note__') as HTMLButtonElement | null
      const existingRefreshBtn = document.getElementById('__ai_refresh_summary__') as HTMLButtonElement | null
      if (existingSaveBtn) existingSaveBtn.disabled = true
      if (existingRefreshBtn) existingRefreshBtn.disabled = true
      
      showSidePanel('Generating summary... It may take a while for Chrome to download the required models for the first time. Thanks for your patience!')
      const text = extractReadableText(document)
      
      let isFirstChunk = true
      
      const targetLang = (await getSetting<string>('targetLang')) || 'en'
      const res = await summarize(text, {
        type: 'tldr',
        lang: targetLang,
        onChunk: (chunk) => {
          if (isFirstChunk) {
            sidePanelContentEl!.innerHTML = `
              <div class="ai-panel-content-wrapper">
                <div class="ai-panel-text">${escapeHtml(chunk).replace(/\n/g, '<br/>')}</div>
              </div>
            `
            isFirstChunk = false
          } else {
            const textEl = sidePanelContentEl!.querySelector('.ai-panel-text')
            if (textEl) {
              textEl.innerHTML = escapeHtml(chunk).replace(/\n/g, '<br/>')
            }
          }
        }
      })
      
      await setPageSummary(currentUrl, res, text)
      
      currentPageText = text
      currentPageSummary = res
      
      const currentHash = await hashText(text)
      
      const chatHistory = await getPageChatHistory(currentUrl)
      if (chatHistory && chatHistory.contentHash === currentHash) {
        console.log('[Content] ✅ Page content matches, restoring chat history')
        console.log('[Content] 📜 Restored', chatHistory.messages.length, 'messages from storage')
        chatMessages = chatHistory.messages
        // 如果有聊天历史，设置为聊天模式
        if (chatMessages.length > 0) {
          isChatMode = true
          console.log('[Content] Setting isChatMode = true (chat history exists)')
        }
      } else {
        console.log('[Content] ❌ Page content changed or no history, clearing chat')
        chatMessages = []
        isChatMode = false
        await clearPageChatHistory(currentUrl)
      }
      
      renderPageSummary(res, text)
    } catch (e) {
      console.error(e)
      showSidePanel('⚠️ Failed to summarize this page.')
    } finally {
      isGeneratingPageSummary = false
    }
}

function renderPageSummary(summary: string, text: string) {
  const saveButtonText = isPageSummarySaved ? 'Saved ✓' : 'Save to Notes'
  const saveButtonDisabled = isPageSummarySaved ? 'disabled' : ''
  
  // Determine Ask Follow-up button state
  const followupButtonText = isChatMode ? '🗑️ Clear Session' : '💬 Ask Follow-up'
  const followupButtonClass = isChatMode ? 'clear-mode' : ''
  
  let html = `
    <div class="ai-panel-content-wrapper">
      <div class="ai-panel-text">${escapeHtml(summary).replace(/\n/g, '<br/>')}</div>
    </div>
    <div class="ai-panel-actions">
      <button id="__ai_save_page_note__" ${saveButtonDisabled}>${saveButtonText}</button>
      <button id="__ai_refresh_summary__">🔄 Refresh</button>
      <button id="__ai_ask_followup__" class="${followupButtonClass}">${followupButtonText}</button>
    </div>
  `
  
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
      isPageSummarySaved = true
      await updatePageSummarySaveStatus(location.href, true)
    } catch (e) {
      console.error('[Save error]', e)
      saveBtn.disabled = false
      saveBtn.textContent = 'Save to Notes'
    }
  })
  
  const refreshBtn = document.getElementById('__ai_refresh_summary__') as HTMLButtonElement | null
  refreshBtn?.addEventListener('click', async () => {
    if (isGeneratingPageSummary || isGeneratingChat) {
      console.log('[AI] Generation in progress, canceling and refreshing')
    }
    
    abortSummarize()
    destroyPageChatSession()
    
    isChatMode = false
    isGeneratingChat = false
    chatMessages = []
    currentPageText = ''
    currentPageSummary = ''
    isPageSummarySaved = false
    
    await clearPageSummary(location.href)
    await clearPageChatHistory(location.href)
    
    await openPanelAndSummarizePage(true)
  })
  
  // Ask Follow-up / Clear Session button
  const askBtn = document.getElementById('__ai_ask_followup__') as HTMLButtonElement | null
  askBtn?.addEventListener('click', async () => {
    if (isChatMode) {
      // Clear session mode - destroy everything and reset
      console.log('[Content] Clearing chat session...')
      
      // Stop any ongoing generation
      if (isGeneratingChat) {
        abortPageChatGeneration()
        isGeneratingChat = false
      }
      
      // Destroy session and clear state
      destroyPageChatSession()
      isChatMode = false
      chatMessages = []
      
      // Clear chat history from storage
      await clearPageChatHistory(location.href)
      
      console.log('[Content] ✅ Chat session cleared')
      
      // Re-render to show "Ask Follow-up" button again
      renderPageSummary(currentPageSummary, currentPageText)
    } else {
      // Ask Follow-up mode - create session
      isChatMode = true
      
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
        alert(`Chat unavailable - AI model not ready or language not supported.\n\nPlease refresh the page and try again later, and also check your console for more details.\n\nWe currently only support English, Japanese, and Spanish. More languages are on the way.\n\nQuick Setup Guide:\n1. Use Chrome 138+ or Chrome Canary/Dev (chrome://version)\n2. Enable flags in chrome://flags:\n   • #prompt-api-for-gemini-nano → Enabled Multilingual\n   • #optimization-guide-on-device-model → Enabled BypassPerfRequirement\n3. Restart browser\n4. Download model at chrome://components (Optimization Guide On Device Model)\n5. Requirements: 22GB disk space, 4GB+ GPU or 16GB+ RAM\n\nLearn more: https://developer.chrome.com/docs/ai/built-in-apis`)
        return
      }
      
      renderPageSummary(currentPageSummary, currentPageText)
      
      setTimeout(() => updateTokenStatus(), 0)
    }
  })
  
  if (chatMessages.length > 0 || isChatMode) {
    renderChatUI()
    
    if (chatMessages.length > 0 && !hasPageChatSession()) {
      ;(async () => {
        const targetLang = (await getSetting<string>('targetLang')) || 'en'
        console.log('[Content] Auto-creating chat session for restored history')
        const success = await createPageChatSession({
          pageText: currentPageText,
          pageSummary: currentPageSummary,
          lang: targetLang,
          chatHistory: chatMessages
        })
        
        if (success) {
          console.log('[Content] Session created, re-rendering chat UI to show token status')
          renderChatUI()
        }
      })()
    }
  }
}

function updateTokenStatus() {
  const tokenStatus = document.querySelector('.ai-chat-token-status')
  if (!tokenStatus) return
  
  const tokenUsage = getPageChatTokenUsage()
  if (!tokenUsage) {
    tokenStatus.remove()
    return
  }
  
  const colorClass = tokenUsage.percentage < 50 ? 'low' : tokenUsage.percentage < 80 ? 'medium' : 'high'
  tokenStatus.className = `ai-chat-token-status ${colorClass}`
  tokenStatus.setAttribute('title', `Context window usage: ${tokenUsage.usage} / ${tokenUsage.quota} tokens`)
  
  const valueEl = tokenStatus.querySelector('.ai-chat-token-value')
  if (valueEl) {
    valueEl.textContent = `${tokenUsage.percentage}%`
  }
}

function renderChatUI() {
  const chatContainer = document.getElementById('__ai_chat_container__')
  if (!chatContainer) return
  
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
  
  const tokenUsage = getPageChatTokenUsage()
  let tokenStatusHTML = ''
  if (tokenUsage) {
    const colorClass = tokenUsage.percentage < 50 ? 'low' : tokenUsage.percentage < 80 ? 'medium' : 'high'
    tokenStatusHTML = `
      <div class="ai-chat-token-status ${colorClass}" title="Context window usage: ${tokenUsage.usage} / ${tokenUsage.quota} tokens">
        <span class="ai-chat-token-label">Context:</span>
        <span class="ai-chat-token-value">${tokenUsage.percentage}%</span>
      </div>
    `
  }
  
  const inputHTML = `
    ${tokenStatusHTML}
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
  
  const messagesContainer = document.getElementById('__ai_chat_messages__')
  if (messagesContainer) {
    messagesContainer.scrollTop = messagesContainer.scrollHeight
  }
  
  const input = document.getElementById('__ai_chat_input__') as HTMLTextAreaElement | null
  const submitBtn = document.getElementById('__ai_chat_submit__') as HTMLButtonElement | null
  
  if (input && submitBtn) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        if (!isGeneratingChat && input.value.trim()) {
          handleChatSubmit(input.value.trim())
        }
      }
    })
    
    submitBtn.addEventListener('click', () => {
      if (isGeneratingChat) {
        abortPageChatGeneration()
        isGeneratingChat = false
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

async function handleChatSubmit(question: string) {
  const input = document.getElementById('__ai_chat_input__') as HTMLTextAreaElement | null
  if (!input) return
  
  input.value = ''
  
  const userMessage: ChatMessage = {
    role: 'user',
    content: question,
    timestamp: Date.now()
  }
  chatMessages.push(userMessage)
  
  isGeneratingChat = true
  const submitBtn = document.getElementById('__ai_chat_submit__') as HTMLButtonElement | null
  if (submitBtn) {
    submitBtn.classList.add('generating')
    submitBtn.title = 'Stop generating'
    submitBtn.textContent = '⬛'
  }
  input.disabled = true
  
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
    if (!hasPageChatSession()) {
      const targetLang = (await getSetting<string>('targetLang')) || 'en'
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
    
    const targetLang = (await getSetting<string>('targetLang')) || 'en'
    
    const response = await askPageQuestion(question, {
      lang: targetLang,
      onChunk: (chunk) => {
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
            renderChatUI()
          }
        }
      }
    })
    
    if (!response || !response.trim()) {
      const lastMsg = chatMessages[chatMessages.length - 1]
      const hasContent = lastMsg && lastMsg.role === 'assistant' && lastMsg.content && lastMsg.content.trim().length > 0
      if (!hasContent) {
        chatMessages.pop()
      }
    }
    
    updateTokenStatus()
    
    const contentHash = await hashText(currentPageText)
    await setPageChatHistory(location.href, {
      messages: chatMessages,
      contentHash,
      pageSummary: currentPageSummary
    })
  } catch (e: any) {
    console.error('[Chat error]', e)
    const isAbort = e?.name === 'AbortError' || e?.message?.includes('aborted') || e?.message?.includes('Session destroyed')
    const lastMsg = chatMessages[chatMessages.length - 1]
    const hasContent = lastMsg && lastMsg.role === 'assistant' && lastMsg.content && lastMsg.content.trim().length > 0
    if (!(isAbort && hasContent)) {
      if (chatMessages.length > 0 && chatMessages[chatMessages.length - 1].role === 'assistant') {
        chatMessages.pop()
      }
      const errorMsg: ChatMessage = {
        role: 'assistant',
        content: '⚠️ Language not supported or model not ready. Please check your console for more details and try again.',
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
    }
  } finally {
    isGeneratingChat = false
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

if (window.self === window.top) {
  ensureFloatingButton()
  
  setTimeout(() => {
    ensureKeepaliveSession().catch(err => {
      console.log('[AI] Background keepalive session creation skipped:', err.message)
    })
  }, 2000)
}

chrome.runtime.onMessage.addListener((msg: Msg | any, _s, sendResponse) => {
  if (window.self !== window.top) {
    return false
  }
  
  if (msg?.type === 'SHOW_FLOAT_AGAIN') {
    const node = ensureFloatingButton()
    node.style.display = 'block'
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

window.addEventListener('beforeunload', () => {
  destroyResources()
})
