import { useEffect, useMemo, useState } from 'react'
import { listNotes, clearNotes, getSetting, setSetting } from './services/storage'
import type { Note } from './utils/messaging'
import './App.css'

/**
 * Main Popup Component
 * 
 * This is the popup UI that appears when clicking the extension icon.
 * It displays saved notes, allows searching/filtering, and provides controls
 * for language selection, export, and clearing notes.
 */
export default function App() {
  // State management
  const [notes, setNotes] = useState<Note[]>([])           // All saved notes
  const [q, setQ] = useState('')                            // Search query
  const [lang, setLang] = useState('en')                    // Target language for AI operations
  const [showWelcome, setShowWelcome] = useState<boolean | null>(null)  // Welcome banner visibility

  // Initialize popup on mount
  useEffect(() => {
    (async () => {
      // Load all saved notes
      setNotes(await listNotes())
      
      // Load or initialize target language setting
      const saved = await getSetting<string>('targetLang')
      if (saved) {
        setLang(saved)
        console.log('[Popup] Loaded target language from storage:', saved)
      } else {
        const defaultLang = 'en'
        await setSetting('targetLang', defaultLang)
        setLang(defaultLang)
        console.log('[Popup] No saved language, using default:', defaultLang)
      }
      
      // Load or initialize welcome banner visibility
      const welcomeVisible = await getSetting<boolean>('showWelcomeBanner')
      if (welcomeVisible !== undefined) {
        setShowWelcome(welcomeVisible)
        console.log('[Popup] Loaded welcome banner state:', welcomeVisible)
      } else {
        await setSetting('showWelcomeBanner', true)
        setShowWelcome(true)
      }
    })()

    // Tell content script to show the floating button again (if it was hidden)
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const id = tabs[0]?.id
      if (id) {
        try {
          chrome.tabs.sendMessage(id, { type: 'SHOW_FLOAT_AGAIN' }, () => {
            void chrome.runtime.lastError
          })
        } catch { /* no-op */ }
      }
    })

    // Listen for storage changes to sync notes in real-time
    function onChanged(changes: Record<string, chrome.storage.StorageChange>, area: string) {
      if (area === 'local' && changes.notes) {
        const v = (changes.notes.newValue || []) as Note[]
        setNotes(v.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)))
      }
    }
    chrome.storage.onChanged.addListener(onChanged)
    return () => chrome.storage.onChanged.removeListener(onChanged)
  }, [])

  // Filter notes based on search query (searches in text, snippet, and page title)
  const filtered = useMemo(
    () =>
      notes.filter((n) =>
        (n.text + (n.snippet || '') + n.pageTitle)
          .toLowerCase()
          .includes(q.toLowerCase())
      ),
    [notes, q]
  )

  /**
   * Toggle welcome banner visibility and persist the setting
   */
  const toggleWelcome = async (show: boolean) => {
    setShowWelcome(show)
    await setSetting('showWelcomeBanner', show)
    console.log('[Popup] Welcome banner state changed to:', show)
  }

  /**
   * Export all notes as a JSON file
   */
  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(notes, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ai-notes-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  /**
   * Simple markdown renderer for list items
   * Converts markdown lists (- or *) to HTML <ul>/<li> elements
   */
  const renderMarkdown = (text: string) => {
    const lines = text.split('\n')
    const isMarkdownList = lines.some(line => /^[-*]\s/.test(line.trim()))
    
    if (isMarkdownList) {
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
    
    return text
  }

  return (
    <div className="popup-root">
      {/* Welcome Banner */}
      {showWelcome === null ? null : showWelcome ? (
        <div className="welcome-banner">
          <button 
            className="close-banner-btn"
            onClick={() => toggleWelcome(false)}
            aria-label="Close welcome banner"
          >
            ✕
          </button>
          <div className="welcome-header">
            <span className="welcome-icon">✨</span>
            <span className="welcome-title">Welcome to your AI Companion!</span>
          </div>
          <p className="welcome-description">
            Your intelligent assistant for web content. Summarize pages, explain terms, 
            translate text, ask follow-up questions, and save insights any time you want—all powered by Chrome's on-device AI.
          </p>
          <div className="welcome-footer">
            <a 
              href="https://github.com/Foursheepsir/chrome_ai" 
              target="_blank" 
              rel="noopener noreferrer"
              className="learn-more-link"
            >
              Learn more →
            </a>
            <span className="gemini-badge">⚡ Powered by Gemini Nano</span>
          </div>
        </div>
      ) : (
        <div className="show-welcome-hint">
          <button 
            className="show-welcome-btn"
            onClick={() => toggleWelcome(true)}
          >
            ✨ Show Welcome
          </button>
        </div>
      )}

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
        <button 
          onClick={exportJSON}
          disabled={notes.length === 0}
        >
          Export JSON
        </button>
        <button
          onClick={async () => {
            if (window.confirm(`Are you sure you want to delete all ${notes.length} note(s)? This action cannot be undone.`)) {
              await clearNotes()
              setNotes([])
            }
          }}
          disabled={notes.length === 0}
        >
          Clear All
        </button>
      </div>
    </div>
  )
}
