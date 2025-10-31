/**
 * Storage Service - Chrome Storage API Wrapper
 * 
 * Provides a typed, promise-based interface for managing extension data:
 * - Notes: AI-generated summaries, explanations, translations
 * - Settings: User preferences (target language, UI state)
 * - Page Summaries: Cached full-page summaries (URL-keyed)
 * - Chat History: Multi-turn conversation history (URL-keyed)
 * 
 * All data is stored in chrome.storage.local for persistence across sessions.
 */

import type { Note } from '../utils/messaging'

// Storage keys
const NOTES_KEY = 'notes'
const SETTINGS_KEY = 'settings'
const PAGE_SUMMARIES_KEY = 'pageSummaries'
const PAGE_CHAT_HISTORY_KEY = 'pageChatHistory'

/**
 * Generate SHA-256 hash of text
 * Used for efficiently comparing page content changes without storing full text
 */
export async function hashText(text: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(text)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Promise wrapper for chrome.storage.local.get
 */
function getLocal<T = any>(key: string): Promise<T | undefined> {
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (res) => resolve(res[key] as T | undefined))
  })
}

/**
 * Promise wrapper for chrome.storage.local.set
 */
function setLocal(obj: Record<string, any>): Promise<void> {
  return new Promise((resolve) => chrome.storage.local.set(obj, () => resolve()))
}

// ============================================================================
// Notes API
// ============================================================================

/**
 * Add a new note to storage
 * Notes are prepended (newest first)
 */
export async function addNote(n: Note) {
  const list = (await getLocal<Note[]>(NOTES_KEY)) || []
  list.unshift(n)  // Add to beginning
  await setLocal({ [NOTES_KEY]: list })
}

/**
 * Get all notes, sorted by creation date (newest first)
 */
export async function listNotes(): Promise<Note[]> {
  const list = (await getLocal<Note[]>(NOTES_KEY)) || []
  return list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
}

/**
 * Delete all notes
 */
export async function clearNotes() {
  await setLocal({ [NOTES_KEY]: [] })
}

// ============================================================================
// Settings API
// ============================================================================

type Settings = Record<string, any>

/**
 * Save a setting value
 * Common settings: 'targetLang', 'showWelcomeBanner', 'floatPos', 'floatHidden'
 */
export async function setSetting(key: string, val: any) {
  const st = (await getLocal<Settings>(SETTINGS_KEY)) || {}
  st[key] = val
  await setLocal({ [SETTINGS_KEY]: st })
}

/**
 * Get a setting value
 */
export async function getSetting<T = any>(key: string): Promise<T | undefined> {
  const st = (await getLocal<Settings>(SETTINGS_KEY)) || {}
  return st[key] as T | undefined
}

// ============================================================================
// Page Summary Cache API
// ============================================================================

export type PageSummaryCache = {
  summary: string        // The generated summary
  text: string           // The original page text
  contentHash: string    // Hash of page content (for detecting changes)
  timestamp: number      // When the summary was created
  isSaved?: boolean      // Whether saved to notes
}

/**
 * Get cached page summary for a URL
 */
export async function getPageSummary(url: string): Promise<PageSummaryCache | undefined> {
  const cache = (await getLocal<Record<string, PageSummaryCache>>(PAGE_SUMMARIES_KEY)) || {}
  return cache[url]
}

/**
 * Cache a page summary
 * Automatically computes content hash for change detection
 */
export async function setPageSummary(url: string, summary: string, text: string) {
  const cache = (await getLocal<Record<string, PageSummaryCache>>(PAGE_SUMMARIES_KEY)) || {}
  const contentHash = await hashText(text)
  cache[url] = { summary, text, contentHash, timestamp: Date.now(), isSaved: false }
  await setLocal({ [PAGE_SUMMARIES_KEY]: cache })
}

/**
 * Update whether the page summary has been saved to notes
 */
export async function updatePageSummarySaveStatus(url: string, isSaved: boolean) {
  const cache = (await getLocal<Record<string, PageSummaryCache>>(PAGE_SUMMARIES_KEY)) || {}
  if (cache[url]) {
    cache[url].isSaved = isSaved
    await setLocal({ [PAGE_SUMMARIES_KEY]: cache })
  }
}

/**
 * Clear cached page summary for a URL
 */
export async function clearPageSummary(url: string) {
  const cache = (await getLocal<Record<string, PageSummaryCache>>(PAGE_SUMMARIES_KEY)) || {}
  delete cache[url]
  await setLocal({ [PAGE_SUMMARIES_KEY]: cache })
}

// ============================================================================
// Page Chat History API
// ============================================================================

export type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

export type PageChatHistory = {
  messages: ChatMessage[]    // Conversation history
  contentHash: string        // Hash of page content (for validation)
  pageSummary: string        // Initial page summary (context for chat)
  timestamp: number          // Last update time
}

/**
 * Get chat history for a URL
 * Returns undefined if no history exists or page content has changed
 */
export async function getPageChatHistory(url: string): Promise<PageChatHistory | undefined> {
  const cache = (await getLocal<Record<string, PageChatHistory>>(PAGE_CHAT_HISTORY_KEY)) || {}
  return cache[url]
}

/**
 * Save chat history for a URL
 * Should be called after each chat turn to persist conversation
 */
export async function setPageChatHistory(url: string, history: Omit<PageChatHistory, 'timestamp'>) {
  const cache = (await getLocal<Record<string, PageChatHistory>>(PAGE_CHAT_HISTORY_KEY)) || {}
  cache[url] = { ...history, timestamp: Date.now() }
  await setLocal({ [PAGE_CHAT_HISTORY_KEY]: cache })
}

/**
 * Clear chat history for a URL
 * Called when page content changes or user explicitly refreshes
 */
export async function clearPageChatHistory(url: string) {
  const cache = (await getLocal<Record<string, PageChatHistory>>(PAGE_CHAT_HISTORY_KEY)) || {}
  delete cache[url]
  await setLocal({ [PAGE_CHAT_HISTORY_KEY]: cache })
}
