# STEPS: Your personal Chrome AI Companion

<p align="center">
  <img src="public/icon128.png" alt="STEPS: Your personal Chrome AI Companion" width="96" height="96" />
</p>
<h3 align="center"><b>Private, on‑device AI only for you</b></h3>
<h4 align="center">Summarize • Translate • Explain • Page Chat • Save Notes</h4>
<h4 align="center">— all locally with Chrome Built‑in AI —</h4>


Instructions to install, run and evaluate this Chrome Extension from a clean environment.

This project demonstrates on-device AI features using Chrome's built-in AI APIs (Gemini Nano), including:

- Summarization (Summarizer API)
- Translation (Translator API)
- Explanations and Page Chat (Prompt API)
- Language detection (LanguageDetector)

All AI runs locally on device — no network calls to external AI services, no fees at all!

---

## 1) What this Chrome extension does

- **✨ Summarize anything** — Generate concise, high‑quality summaries for selected text or the entire page.
- **🌐 Translate effortlessly** — Auto-detects the source language and translates into your preferred language.
- **🧠 Explain in context** — Highlight tricky terms and get clear, concise explanations grounded in surrounding content.
- **💬 Page Chat** — Ask follow‑ups about the page with multi‑turn memory and real‑time token usage indicators.
- **📝 Save Notes** — Capture and organize useful snippets, insights, or quotes for later reference.

APIs used: Summarizer API, Translator API, Prompt API, LanguageDetector. See implementation notes and diagnostics in `AI_SETUP.md`.

---

## 2) Quick Start

If you only want to try the extension, you do NOT need Node.js.

1. Complete Chrome built‑in AI setup: see [AI Setup Guide](./AI_SETUP.md)
2. Load the prebuilt extension bundle:
   - Open `chrome://extensions`
   - Enable "Developer mode"
   - Click "Load unpacked" and choose the `dist/` folder from this repository
3. Start using it on any webpage (see “How to Use and Test” below)


## 3) Build From Source (Optional)

The following steps assume a machine without Node, Git, or any packages installed.

### A. Prerequisites: Install Chrome and enable Built‑in AI

1. Install Google Chrome (version 138+ recommended)
2. Enable the required feature flags and download the on-device model
3. Verify API availability

For concise, step-by-step instructions (with console diagnostics), follow:

- See: [AI Setup Guide](./AI_SETUP.md)

This guide covers:
- Required Chrome version and flags (Summarizer / Prompt / Translation / Optimization Guide)
- Model download via `chrome://components`
- Diagnostics snippets to verify availability and instance creation

### B. Install Tools

Choose your OS and install Git and Node.js (LTS 18+ or 20+). Any of the options below are fine.

#### macOS

Option 1 — Homebrew:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install git node
```

Option 2 — Node Version Manager (nvm):

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc || source ~/.zshrc
nvm install --lts
```

#### Windows

Option 1 — winget:

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
```

Option 2 — Chocolatey:

```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force; iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
choco install -y git nodejs-lts
```

#### Linux (Debian/Ubuntu)

```bash
sudo apt update
sudo apt install -y git curl build-essential
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt install -y nodejs
```

### C. Verify Toolchain

```bash
node --version   # Expect: v18.x or v20.x (recommended LTS ≥ 20)
npm -v           # Expect: ≥ 9
git --version
```

If these commands fail or versions are lower than required, please reinstall/update using the steps above.

---

## 4) Get the Code and Install Dependencies

```bash
git clone https://github.com/your-org-or-user/chrome_ai.git
cd chrome_ai
npm ci || npm install
```

Notes:
- `npm ci` is preferred in CI/clean environments; fall back to `npm install` if needed.

Dependencies are already declared in `package.json`; no need to install individually:
- Runtime: `idb`, `nanoid`, `marked`, `react`, `react-dom`
- Dev: `@crxjs/vite-plugin` (CRX bundling), `typescript`, `@types/chrome`, ESLint toolchain

---

## 5) Build the Extension (Production)

```bash
npm run build
```

This produces the extension bundle in `dist/` with source maps. Icons and the built `manifest.json` are included in `dist/`.

---

## 6) Load the Extension in Chrome

1. Open `chrome://extensions`
2. Enable "Developer mode" (top-right)
3. Click "Load unpacked"
4. Select the `dist/` folder in this repository

The extension should now appear in your toolbar. The popup UI is `index.html`. The content script and background service worker are loaded automatically on matching pages.

Keyboard shortcut: `Alt+Shift+P` toggles the AI side panel (see `manifest.json` → `commands.toggle-panel`).

---

## 7) Optional: Development Workflow

For local iteration, you can use the development server or watch mode.

```bash
# Dev server (CRX plugin):
npm run dev

# or Rebuild on changes:
npm run build -- --watch
```

Reload the extension in `chrome://extensions` when using watch builds. The dev server supports faster feedback for popup/options pages; some extension contexts may still require manual reload.

---

## 8) How to Use and Test

After completing AI setup in [AI_SETUP.md](./AI_SETUP.md):

1) Text Selection Actions
- Select text on any webpage
- A tooltip toolbar appears with: Summarize / Explain / Translate / Save
- Try "Summarize" to avoid reading long paragraphs
- Try "Translate" (auto-detect source language)
- Try "Save" to save whatever you find interesting or useful

2) Full Page Summary
- Click the floating button (bottom-left)
- Verify an AI-generated page summary in the side panel

3) Explain Feature
- Select a short phrase/term (1–4 words)
- Click "Explain"
- Check that output reflects page context

4) Page Chat
- After generating a summary, click "Ask Follow-up"
- Ask multi-turn questions about the page
- Observe token usage indicators and retained context

5) Diagnostics & Logs
- Open DevTools Console on the page
- Look for `[AI] ...` logs indicating API availability, downloads, caching, and fallbacks

Expected behavior:
- If built-in APIs are available, logs include “Using Chrome AI ...” and model instances are created and cached
- If unavailable, the extension falls back to simple heuristics with clear console messages

---

## 9) Troubleshooting

Most issues (API unavailable, model not downloaded, language not supported, etc.) have ready-made diagnostics and fixes in:

- [AI Setup & Troubleshooting](./AI_SETUP.md)

Additional quick checks:
- Confirm Chrome ≥ 138 and the required flags are enabled
- Verify the model is downloaded in `chrome://components`
- Try an Incognito window (to avoid extension conflicts)
- Ensure you have sufficient disk/RAM for on-device models

---

## 10) Tech Stack

- React + TypeScript + Vite
- `@crxjs/vite-plugin` for Chrome Extension bundling (Manifest V3)
- On-device Chrome AI APIs: Summarizer, Translator, LanguageModel (Prompt API), LanguageDetector
- Storage via `chrome.storage.local`; IDB used for local data (`idb`)

Key files:
- `manifest.json` — extension configuration (actions, permissions, content scripts)
- `src/content/index.ts` — content script (UI overlays, page processing)
- `src/background/index.ts` — service worker (messaging, lifecycle)
- `src/services/aiService.ts` — AI capability detection, instance caching, fallbacks
- `AI_SETUP.md` — Chrome AI setup, diagnostics, and troubleshooting

---

## 11) Security & Privacy

- All AI runs locally on-device (Gemini Nano via Chrome built-in APIs)
- No user text or page content is sent to remote AI services
- Model caching and lifecycle managed by Chrome; user data persists only in local browser storage

---

## 12) Scripts

```bash
npm run dev     # start dev server
npm run build   # type-check and build to dist/
npm run preview # preview built assets (for web pages, not extension contexts)
npm run lint    # run ESLint
```

---

## 13) Contact & Support

If you encounter any issues, have questions and feedbacks, or want to request features, feel free to reach out:

📧 **Email**: [danieldd@umich.edu](mailto:danieldd@umich.edu)

For setup and troubleshooting, please start with [AI_SETUP.md](./AI_SETUP.md) — it includes exact console commands, availability checks, and common fixes.

