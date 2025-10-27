chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({ id: 'summarize_page', title: 'AI: Summarize this page', contexts: ['page'] })
    chrome.contextMenus.create({ id: 'summarize_selection', title: 'AI: Summarize selection', contexts: ['selection'] })
    chrome.contextMenus.create({ id: 'explain_selection', title: 'AI: Explain selection', contexts: ['selection'] })
    chrome.contextMenus.create({ id: 'translate_selection', title: 'AI: Translate selection', contexts: ['selection'] })
  })
  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (!tab?.id) return
    const send = (msg: any) => chrome.tabs.sendMessage(tab.id!, msg)
    if (info.menuItemId === 'summarize_page')         send({ type: 'SUMMARIZE_PAGE' })
    if (info.menuItemId === 'summarize_selection')    send({ type: 'SUMMARIZE_SELECTION' })
    if (info.menuItemId === 'explain_selection')      send({ type: 'EXPLAIN_SELECTION' })
    if (info.menuItemId === 'translate_selection')    send({ type: 'TRANSLATE_SELECTION', targetLang: 'zh' })
  })
  chrome.commands.onCommand.addListener(async (command) => {
    if (command === 'toggle-panel') {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_PANEL' })
    }
  })
  