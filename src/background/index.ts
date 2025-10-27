// src/background/index.ts

// 右键菜单
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
      // 重装时重复创建可能会抛错，忽略即可
      void 0
    }
  })
  
  // 安全发送消息：忽略没有内容脚本的页面造成的报错
  function safeSendMessage(tabId: number, msg: any) {
    try {
      chrome.tabs.sendMessage(tabId, msg, () => {
        // 如果该页没有注入 content script，会走到 lastError；这里忽略即可
        void chrome.runtime.lastError
      })
    } catch {
      // 在某些极端场景（tab 已关闭）这里也可能抛错，直接忽略
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
        // 这里默认 zh，你也可以从 storage 读取 targetLang 再发
        safeSendMessage(tabId, { type: 'TRANSLATE_SELECTION', targetLang: 'zh' })
        break
    }
  })
  
  // 键盘命令（见 manifest "commands"）
  chrome.commands.onCommand.addListener(async (command) => {
    if (command !== 'toggle-panel') return
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab?.id) safeSendMessage(tab.id, { type: 'TOGGLE_PANEL' })
    } catch {
      // ignore
    }
  })
  