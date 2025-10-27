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
      if (saved) setLang(saved)
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
          }}
        >
          <option value="zh">中文</option>
          <option value="en">English</option>
          <option value="ja">日本語</option>
          <option value="es">Español</option>
        </select>
      </div>

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
            <div className="text">{n.text}</div>
            {n.snippet && (
              <details className="snippet">
                <summary>Original snippet</summary>
                <pre>{n.snippet}</pre>
              </details>
            )}
          </div>
        ))}
        {!filtered.length && (
          <div className="empty">
            No notes yet. Select text on any page → use the tooltip.
          </div>
        )}
      </div>

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
