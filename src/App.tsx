import { useEffect, useMemo, useState } from 'react'
import { listNotes, clearNotes, getSetting, setSetting } from './services/storage'
import type { Note } from './utils/messaging'
import './App.css'

export default function App() {
  const [notes, setNotes] = useState<Note[]>([])
  const [q, setQ] = useState('')
  const [lang, setLang] = useState('zh')

  // 初始化：加载笔记 & 读取语言；并通知当前页显示悬浮球
  useEffect(() => {
    (async () => {
      setNotes(await listNotes())
      const saved = await getSetting<string>('targetLang')
      if (saved) {
        setLang(saved)
        console.log('[Popup] Loaded target language from storage:', saved)
      } else {
        // 如果没有保存过，使用默认值 'en' 并保存到 storage
        const defaultLang = 'en'
        await setSetting('targetLang', defaultLang)
        setLang(defaultLang)
        console.log('[Popup] No saved language, using default:', defaultLang)
      }
    })()

    // 打开 popup 时，让 content 端把悬浮球重新显示到右下角
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const id = tabs[0]?.id
      if (id) {
        try {
          chrome.tabs.sendMessage(id, { type: 'SHOW_FLOAT_AGAIN' }, () => {
            // 忽略无监听端的错误
            void chrome.runtime.lastError
          })
        } catch { /* no-op */ }
      }
    })

    // 监听存储变化（notes 实时刷新）
    function onChanged(changes: Record<string, chrome.storage.StorageChange>, area: string) {
      if (area === 'local' && changes.notes) {
        const v = (changes.notes.newValue || []) as Note[]
        // 按时间排序，最新在前
        setNotes(v.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)))
      }
    }
    chrome.storage.onChanged.addListener(onChanged)
    return () => chrome.storage.onChanged.removeListener(onChanged)
  }, [])

  const filtered = useMemo(
    () =>
      notes.filter((n) =>
        (n.text + (n.snippet || '') + n.pageTitle)
          .toLowerCase()
          .includes(q.toLowerCase())
      ),
    [notes, q]
  )

  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(notes, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ai-notes-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  // 渲染 markdown 列表为 HTML
  const renderMarkdown = (text: string) => {
    // 检测是否是 markdown 列表
    const lines = text.split('\n')
    const isMarkdownList = lines.some(line => /^[-*]\s/.test(line.trim()))
    
    if (isMarkdownList) {
      // 转换为 HTML 列表
      const listItems = lines
        .filter(line => line.trim())
        .map(line => {
          const trimmed = line.trim()
          if (/^[-*]\s/.test(trimmed)) {
            return <li key={trimmed}>{trimmed.replace(/^[-*]\s/, '')}</li>
          }
          return <li key={trimmed}>{trimmed}</li>
        })
      return <ul style={{ margin: 0, paddingLeft: '20px' }}>{listItems}</ul>
    }
    
    // 不是列表，使用普通文本
    return text
  }

  return (
    <div className="popup-root">
      <h3>AI Notes</h3>

      <div className="row">
        <input
          placeholder="Search notes…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          value={lang}
          onChange={async (e) => {
            const v = e.target.value
            setLang(v)
            await setSetting('targetLang', v)
            console.log('[Popup] Target language changed to:', v)
          }}
        >
          <option value="zh">中文</option>
          <option value="en">English</option>
          <option value="ja">日本語</option>
          <option value="es">Español</option>
        </select>
      </div>

      {filtered.length > 0 ? (
        <div className="note-list">
          {filtered.map((n) => (
            <div key={n.id} className="note-card">
              <div className="meta">
                <a href={n.sourceUrl} target="_blank" rel="noreferrer">
                  {n.pageTitle}
                </a>
                <span> · {new Date(n.createdAt).toLocaleString()}</span>
              </div>
              <div className="kind">{n.kind}</div>
              <div className="text">{renderMarkdown(n.text)}</div>
              {n.snippet && (
                <details className="snippet">
                  <summary>Original snippet</summary>
                  <pre>{n.snippet}...</pre>
                </details>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="empty">No notes yet. Select text on any page → use the tooltip.</div>
      )}

      <div className="row">
        <button onClick={exportJSON}>Export JSON</button>
        <button
          onClick={async () => {
            await clearNotes()
            setNotes([])
          }}
        >
          Clear All
        </button>
      </div>
    </div>
  )
}
