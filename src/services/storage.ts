// src/services/storage.ts
import type { Note } from '../utils/messaging'

const NOTES_KEY = 'notes'
const SETTINGS_KEY = 'settings'
const PAGE_SUMMARIES_KEY = 'pageSummaries'

// ------ 小工具：Promise 封装 ------
function getLocal<T = any>(key: string): Promise<T | undefined> {
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (res) => resolve(res[key] as T | undefined))
  })
}
function setLocal(obj: Record<string, any>): Promise<void> {
  return new Promise((resolve) => chrome.storage.local.set(obj, () => resolve()))
}

// ------ Notes API ------
export async function addNote(n: Note) {
  const list = (await getLocal<Note[]>(NOTES_KEY)) || []
  list.unshift(n) // 最新在前
  await setLocal({ [NOTES_KEY]: list })
}

export async function listNotes(): Promise<Note[]> {
  const list = (await getLocal<Note[]>(NOTES_KEY)) || []
  // 保险按时间排一下
  return list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
}

export async function clearNotes() {
  await setLocal({ [NOTES_KEY]: [] })
}

// ------ Settings API ------
type Settings = Record<string, any>

export async function setSetting(key: string, val: any) {
  const st = (await getLocal<Settings>(SETTINGS_KEY)) || {}
  st[key] = val
  await setLocal({ [SETTINGS_KEY]: st })
}

export async function getSetting<T = any>(key: string): Promise<T | undefined> {
  const st = (await getLocal<Settings>(SETTINGS_KEY)) || {}
  return st[key] as T | undefined
}

// ------ Page Summary Cache API ------
export type PageSummaryCache = {
  summary: string
  text: string
  timestamp: number
}

export async function getPageSummary(url: string): Promise<PageSummaryCache | undefined> {
  const cache = (await getLocal<Record<string, PageSummaryCache>>(PAGE_SUMMARIES_KEY)) || {}
  return cache[url]
}

export async function setPageSummary(url: string, summary: string, text: string) {
  const cache = (await getLocal<Record<string, PageSummaryCache>>(PAGE_SUMMARIES_KEY)) || {}
  cache[url] = { summary, text, timestamp: Date.now() }
  await setLocal({ [PAGE_SUMMARIES_KEY]: cache })
}

export async function clearPageSummary(url: string) {
  const cache = (await getLocal<Record<string, PageSummaryCache>>(PAGE_SUMMARIES_KEY)) || {}
  delete cache[url]
  await setLocal({ [PAGE_SUMMARIES_KEY]: cache })
}
