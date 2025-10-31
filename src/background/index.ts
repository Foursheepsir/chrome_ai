/**
 * Background Script - Chrome Extension Event Handlers
 * 
 * This script runs in the background and handles:
 * 1. Context menu creation and click events
 * 2. Keyboard command shortcuts
 * 3. Messages between background and content scripts
 * 
 * It acts as a coordinator between the user's actions (right-click, shortcuts)
 * and the content script's AI features.
 */

chrome.runtime.onInstalled.addListener(() => {
    try {
      chrome.contextMenus.create({
        id: 'summarize_page',
        title: 'AI: Summarize this page',
        contexts: ['page'],
      })
      chrome.contextMenus.create({
        id: 'summarize_selection',
        title: 'AI: Summarize selection',
        contexts: ['selection'],
      })
      chrome.contextMenus.create({
        id: 'explain_selection',
        title: 'AI: Explain selection',
        contexts: ['selection'],
      })
      chrome.contextMenus.create({
        id: 'translate_selection',
        title: 'AI: Translate selection',
        contexts: ['selection'],
      })
    } catch (e) {
      void 0
    }
  })
  
  function safeSendMessage(tabId: number, msg: any) {
    try {
      chrome.tabs.sendMessage(tabId, msg, () => {
        void chrome.runtime.lastError
      })
    } catch {
    }
  }
  
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    const tabId = tab?.id
    if (!tabId) return
  
    switch (info.menuItemId) {
      case 'summarize_page':
        safeSendMessage(tabId, { type: 'SUMMARIZE_PAGE' })
        break
      case 'summarize_selection':
        safeSendMessage(tabId, { type: 'SUMMARIZE_SELECTION' })
        break
      case 'explain_selection':
        safeSendMessage(tabId, { type: 'EXPLAIN_SELECTION' })
        break
      case 'translate_selection':
        safeSendMessage(tabId, { type: 'TRANSLATE_SELECTION', targetLang: 'en' })
        break
    }
  })
  
  chrome.commands.onCommand.addListener(async (command) => {
    if (command !== 'toggle-panel') return
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab?.id) safeSendMessage(tab.id, { type: 'TOGGLE_PANEL' })
    } catch {
      // ignore
    }
  })
  