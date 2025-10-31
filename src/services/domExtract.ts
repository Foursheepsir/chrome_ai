/**
 * DOM Extraction Utilities
 * 
 * Provides utilities for extracting text content from web pages
 * and user selections for AI processing.
 */

/**
 * Get the currently selected text
 * @returns The trimmed selected text, or empty string if nothing is selected
 */
export function getSelectionText(): string {
  const sel = window.getSelection()
  return sel ? sel.toString().trim() : ''
}

/**
 * Extract readable text content from a document
 * 
 * This function attempts to extract only the main content of a page,
 * filtering out navigation, ads, scripts, and other noise. It uses:
 * 1. Common semantic selectors (main, article, etc.)
 * 2. Fallback to full body with cleanup
 * 3. JSON detection to avoid processing data dumps
 * 
 * @param doc - The document to extract from (defaults to current document)
 * @returns Cleaned, readable text content
 */
export function extractReadableText(doc: Document = document): string {
  // Try to find main content area using common selectors
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
  
  // Try each selector until we find substantial non-JSON content
  for (const sel of mainContentSelectors) {
    const mainEl = doc.querySelector(sel) as HTMLElement
    if (mainEl && mainEl.innerText) {
      const text = mainEl.innerText.trim()
      if (text.length > 200 && !looksLikeJSON(text)) {
        return cleanText(text)
      }
    }
  }
  
  // Fallback: clone body and remove unwanted elements
  const cloned = doc.body.cloneNode(true) as HTMLElement
  
  // Remove navigation, ads, scripts, and other non-content elements
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

/**
 * Detect if text looks like JSON data
 * Uses character ratio heuristic to identify JSON-heavy content
 * 
 * @param text - Text to check
 * @returns true if text appears to be JSON data
 */
function looksLikeJSON(text: string): boolean {
  const jsonChars = text.match(/[{}\[\]":,]/g) || []
  const totalChars = text.length
  const jsonRatio = jsonChars.length / totalChars
  
  // If >20% of characters are JSON syntax, assume it's JSON
  return jsonRatio > 0.2
}

/**
 * Clean extracted text
 * - Normalize whitespace (multiple spaces → single space)
 * - Limit consecutive newlines (max 2)
 * - Trim leading/trailing whitespace
 * 
 * @param text - Text to clean
 * @returns Cleaned text
 */
function cleanText(text: string): string {
  return text
    .replace(/\s+/g, ' ')           // Normalize whitespace
    .replace(/\n{3,}/g, '\n\n')     // Max 2 consecutive newlines
    .trim()
}
  