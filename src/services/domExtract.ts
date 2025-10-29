export function getSelectionText(): string {
  const sel = window.getSelection()
  return sel ? sel.toString().trim() : ''
}

export function extractReadableText(doc: Document = document): string {
  // 优先尝试从主要内容区域提取（使用原始文档的 innerText）
  const mainContentSelectors = [
    'main',
    '[role="main"]',
    'article',
    '.content',
    '#content',
    '.main-content',
    '#main-content',
    '[class*="post-content"]',
    '[class*="article-content"]'
  ]
  
  for (const sel of mainContentSelectors) {
    const mainEl = doc.querySelector(sel) as HTMLElement
    if (mainEl && mainEl.innerText) {
      const text = mainEl.innerText.trim()
      if (text.length > 200 && !looksLikeJSON(text)) {
        return cleanText(text)
      }
    }
  }
  
  // 如果没找到主要内容，克隆 body 并清理
  const cloned = doc.body.cloneNode(true) as HTMLElement
  
  // 移除不需要的元素
  const selectorsToRemove = [
    'nav', 'header', 'footer', 'aside',
    'script', 'style', 'noscript',
    '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
    '[aria-hidden="true"]',
    'iframe', 'video', 'audio',
    '.ad', '.ads', '[class*="advertisement"]',
    '[data-nosnippet]',
    'button', 'svg', 'form'
  ]
  
  for (const sel of selectorsToRemove) {
    cloned.querySelectorAll(sel).forEach(e => e.remove())
  }
  
  return cleanText(cloned.textContent || '')
}

// 检测文本是否看起来像 JSON
function looksLikeJSON(text: string): boolean {
  // 如果文本中有大量 JSON 特征字符，认为是 JSON 数据
  const jsonChars = text.match(/[{}\[\]":,]/g) || []
  const totalChars = text.length
  const jsonRatio = jsonChars.length / totalChars
  
  // 如果 JSON 字符占比超过 20%，可能是 JSON 数据
  return jsonRatio > 0.2
}

function cleanText(text: string): string {
  return text
    .replace(/\s+/g, ' ')  // 将多个空白字符替换为单个空格
    .replace(/\n{3,}/g, '\n\n')  // 将多个换行替换为最多两个
    .trim()
}
  