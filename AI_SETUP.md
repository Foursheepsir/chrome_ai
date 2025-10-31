# Chrome Built-in AI APIs Setup Guide

## Overview

This extension leverages Chrome's on-device AI capabilities powered by Gemini Nano to provide:

1. **Summarization** - Generate summaries in different styles (tldr, key-points, teaser, headline)
2. **Translation** - Translate text between languages with auto language detection
3. **Explanation** - Get concise explanations of terms and concepts
4. **Page Chat** - Have multi-turn conversations about page content

**Official Documentation**: [Chrome Built-in AI](https://developer.chrome.com/docs/ai/built-in)

## Prerequisites

### 1. Chrome Version Requirements

- **Recommended**: Chrome 138+ stable
- **Or**: Chrome Canary/Dev 128+

Check your version at: `chrome://version`

### 2. Enable Feature Flags

Visit `chrome://flags` and enable the following flags:

#### For Summarization API
- **Summarization API for Gemini Nano**
  - Flag: `#summarization-api-for-gemini-nano`
  - Set to: `Enabled Multilingual`

#### For Translation API
- **Translation API**
  - Flag: `#translation-api`
  - Set to: `Enabled without language pack limit`

#### For Language Model API (Explain & Page Chat)
- **Prompt API for Gemini Nano**
  - Flag: `#prompt-api-for-gemini-nano`
  - Set to: `Enabled Multilingual`

#### Required for All APIs
- **Optimization Guide On Device Model**
  - Flag: `#optimization-guide-on-device-model`
  - Set to: `Enabled BypassPerfRequirement`

**Important**: After enabling flags, **restart your browser**.

### 3. Download Gemini Nano Model

1. Visit: `chrome://components`
2. Find **Optimization Guide On Device Model** component
3. Click **Check for update** to download the model (~1.7GB)
4. Wait for download to complete

**Note**: The model can also auto-download on first API call, but manual download is recommended for better control.

## Testing API Availability

### Method 1: Automatic Diagnostics (Recommended)

The extension runs automatic diagnostics on page load. Open any webpage and press **F12** to view console output:

```
=== Chrome AI Diagnostic ===
User Agent: ...
Chrome Version: ...

1. Checking Summarizer API...
✅ Summarizer API found

2. Checking availability...
Status: available
✅ Summarizer is ready to use!

3. Testing instance creation...
✅ Successfully created Summarizer instance!
=== End Diagnostic ===
```

### Method 2: Manual Testing

Open browser console (F12) and test each API:

#### Test Summarizer API
```javascript
// Check if API exists
console.log('Summarizer API:', 'Summarizer' in self)

// Check availability
if ('Summarizer' in self) {
  const status = await Summarizer.availability()
  console.log('Status:', status)
  // Possible values: 'available', 'downloadable', 'downloading', 'unavailable'
}

// Test instance creation
const summarizer = await Summarizer.create({
  type: 'tldr',
  length: 'short',
  outputLanguage: 'en'
})
console.log('Summarizer created:', summarizer)
```

#### Test Translator API
```javascript
// Check if API exists
console.log('Translator API:', 'Translator' in self)

// Check availability for language pair
if ('Translator' in self) {
  const status = await Translator.availability({
    sourceLanguage: 'en',
    targetLanguage: 'es'
  })
  console.log('Status:', status)
}

// Test instance creation
const translator = await Translator.create({
  sourceLanguage: 'en',
  targetLanguage: 'es'
})
console.log('Translator created:', translator)
```

#### Test Language Model API
```javascript
// Check if API exists
console.log('LanguageModel API:', 'LanguageModel' in self)

// Check availability
if ('LanguageModel' in self) {
  const status = await LanguageModel.availability()
  console.log('Status:', status)
}

// Test instance creation
const session = await LanguageModel.create({
  systemPrompt: 'You are a helpful assistant.'
})
console.log('LanguageModel session created:', session)
```

#### Test Language Detector API
```javascript
// Check if API exists
console.log('LanguageDetector API:', 'LanguageDetector' in self)

// Check availability
if ('LanguageDetector' in self) {
  const status = await LanguageDetector.availability()
  console.log('Status:', status)
}

// Test detection
const detector = await LanguageDetector.create()
const results = await detector.detect('Hello world')
console.log('Detected language:', results[0].detectedLanguage)
```

## Using Extension Features

Once APIs are available, the extension automatically uses real AI features:

### 1. Text Selection Features

Select text on any webpage and use the tooltip buttons:

- **Summarize** - Generate key points or tldr summary
- **Explain** - Get concise explanations with context awareness
- **Translate** - Auto-detect source language and translate to your preferred language
- **Save** - Save the selected text as a note

### 2. Full Page Summary

- Click the floating button (bottom-left corner)
- View AI-generated page summary in the side panel
- Quality is significantly better than simple truncation

### 3. Explanation Feature

- Select terms or phrases (works best with 1-4 words)
- Click **Explain** button
- AI generates explanations based on surrounding context
- Supports English, Japanese, and Spanish output

### 4. Page Chat

- After generating page summary, click **Ask Follow-up**
- Have multi-turn conversations about the page content
- AI remembers conversation history (persisted across page refreshes)
- Token usage displayed in real-time

## Console Logging

The extension provides detailed logging for AI operations:

**Detection Phase**:
- `[AI] ✅ Summarizer API found` - API detected
- `[AI] Summarizer status: available` - Ready to use
- `[AI] Model download progress: 45%` - Download progress

**Usage Phase**:
- `[AI] Creating Summarizer instance...` - Creating instance
- `[AI] Using Chrome AI Summarizer API` - Using real AI
- `[AI] Reusing cached Summarizer (tldr:en:medium)` - Using cached instance
- `[AI] Using fallback summarization` - Falling back to simple truncation

**Cache Management**:
- `[AI] Cached Summarizer (tldr:en:medium)` - Instance cached
- `[AI] Destroyed Summarizer (type: tldr:en:medium)` - Instance cleaned up

## Troubleshooting

### Issue 1: API Not Found
**Symptoms**: `❌ Summarizer API not found in global scope`

**Solutions**:
1. Confirm Chrome version >= 138 stable (or Canary/Dev 128+)
2. Visit `chrome://flags` and enable required flags
3. Restart browser completely
4. Clear browser cache and try again
5. Try incognito mode to rule out extension conflicts

### Issue 2: Status Shows 'unavailable'
**Symptoms**: `Status: unavailable`

**Solutions**:
1. Check disk space (at least 22GB free)
2. Verify hardware requirements:
   - **GPU**: 4GB+ VRAM
   - **OR CPU**: 16GB+ RAM + 4+ cores
3. Visit `chrome://on-device-internals` for detailed info
4. Check if device supports on-device AI

### Issue 3: Model Download Fails
**Symptoms**: `Status: downloadable` but instance creation fails

**Solutions**:
1. Ensure network is not metered (don't use mobile hotspot)
2. Visit `chrome://components` and manually update model
3. Wait for download to complete (check progress)
4. Restart browser after download completes
5. Try downloading on a different network

### Issue 4: Language Not Supported
**Symptoms**: `NotSupportedError` or `Language not supported` message

**Solutions**:
1. Currently supported languages: **English**, **Japanese**, **Spanish**
2. More languages coming soon
3. Use one of the supported languages in extension popup settings
4. Check console for specific error details

### Issue 5: Still Using Fallback
**Symptoms**: `Using fallback summarization`

**Solutions**:
1. Open console and check full error messages
2. Run automatic diagnostics to check each step
3. Confirm model status is `available`
4. Try in a new incognito window
5. Check if user activation is required (model download)

### Issue 6: Translation API Issues
**Symptoms**: Translation not working

**Solutions**:
1. Ensure `#translation-api` flag is enabled
2. Check if language pair is supported
3. Some language pairs may require separate model downloads
4. Visit `chrome://on-device-translation-internals` for details

## Technical Details

### API Configurations

#### Summarizer Configuration
```javascript
const summarizer = await Summarizer.create({
  sharedContext: 'General purpose text summarization for web content',
  type: 'tldr',  // Types: tldr, key-points, teaser, headline
  length: 'medium',  // Lengths: short, medium, long (auto-determined by word count)
  format: 'plain-text',  // Formats: plain-text, markdown
  expectedInputLanguages: ['en', 'ja', 'es'],
  outputLanguage: 'en',
  monitor(m) {
    m.addEventListener('downloadprogress', (e) => {
      console.log(`Downloaded ${Math.round(e.loaded * 100)}%`)
    })
  }
})
```

**Word Count to Length Mapping**:
- `short`: < 200 words
- `medium`: 200-800 words  
- `long`: > 800 words

#### Summary Types

| Type | Description | Output Length (short/medium/long) |
|------|-------------|-----------------------------------|
| `tldr` | Brief overview | 1 sentence / 3 sentences / 5 sentences |
| `key-points` | Bullet point list | 3 points / 5 points / 7 points |
| `teaser` | Engaging summary | 1 sentence / 3 sentences / 5 sentences |
| `headline` | Title-style summary | 12 words / 17 words / 22 words |

#### Translator Configuration
```javascript
const translator = await Translator.create({
  sourceLanguage: 'en',  // Auto-detected by LanguageDetector
  targetLanguage: 'es',  // From user settings
  monitor(m) {
    m.addEventListener('downloadprogress', (e) => {
      console.log(`Downloading translation model: ${Math.round(e.loaded * 100)}%`)
    })
  }
})
```

#### Language Model Configuration
```javascript
const session = await LanguageModel.create({
  systemPrompt: 'You are a helpful assistant...',
  initialPrompts: [
    { role: 'system', content: 'System instructions...' },
    { role: 'user', content: 'Example question' },
    { role: 'assistant', content: 'Example answer' }
  ],
  topK: 3,  // Default from model params
  temperature: 0.8,  // Default from model params
  expectedInputs: [
    { type: 'text', languages: ['en', 'ja', 'es'] }
  ],
  expectedOutputs: [
    { type: 'text', languages: ['en'] }
  ]
})
```

### Instance Management

The extension implements smart instance management:

- ✅ **Instance Caching**: API instances are cached to avoid repeated creation
  - Summarizer: Cached per `(type, outputLanguage, length)` combination
  - Translator: Cached per language pair (e.g., "en-es")
  - Language Detector: Single instance cached globally
  
- ✅ **Automatic Cleanup**: All instances destroyed on page unload
- ✅ **Graceful Fallback**: Falls back to simple text processing if API unavailable
- ✅ **Download Monitoring**: Real-time progress display for model downloads
- ✅ **Keepalive Session**: Maintains empty session to keep model loaded in memory

### Streaming API Usage

All APIs support streaming for real-time updates:

```javascript
// Summarization streaming
const stream = summarizer.summarizeStreaming(text)
for await (const chunk of stream) {
  console.log(chunk)  // Incremental content
}

// Translation streaming
const stream = translator.translateStreaming(text)
for await (const chunk of stream) {
  console.log(chunk)  // Incremental translation
}

// Language Model streaming
const stream = session.promptStreaming('Your question')
for await (const chunk of stream) {
  console.log(chunk)  // Incremental response
}
```

### Token Management (Language Model)

The Language Model has context window limits:

```javascript
// Check token usage
const usage = session.inputUsage  // Current usage
const quota = session.inputQuota  // Maximum allowed
const percentage = (usage / quota) * 100

console.log(`Token usage: ${usage}/${quota} (${percentage}%)`)
```

**Extension Features**:
- Real-time token usage display in chat UI
- Color-coded indicators (green < 50%, yellow < 80%, red >= 80%)
- Automatic session management to stay within limits

## Supported Languages

Currently supported languages for **input** and **output**:

| Language | Code | Summarizer | Translator | Explain | Chat |
|----------|------|------------|------------|---------|------|
| English | `en` | ✅ | ✅ | ✅ | ✅ |
| Japanese | `ja` | ✅ | ✅ | ✅ | ✅ |
| Spanish | `es` | ✅ | ✅ | ✅ | ✅ |

**Note**: More languages are being added by the Chrome team. Check [Chrome AI updates](https://developer.chrome.com/docs/ai/built-in) for the latest language support.

## Reference Resources

### Official Documentation
- 📘 [Chrome Built-in AI Overview](https://developer.chrome.com/docs/ai/built-in)
- 📘 [Summarizer API](https://developer.chrome.com/docs/ai/summarizer-api)
- 📘 [Translator API](https://developer.chrome.com/docs/ai/translator-api)
- 📘 [Prompt API (Language Model)](https://developer.chrome.com/docs/ai/prompt-api)
- 📘 [Language Detector API](https://developer.chrome.com/docs/ai/language-detection)

### Tools & Playgrounds
- 🎮 [Summarizer API Playground](https://chrome.dev/web-ai-demos/summarization-api-playground/)
- 🎮 [Prompt API Playground](https://chrome.dev/web-ai-demos/prompt-api-playground/)
- 🔧 [On-Device AI Internals](chrome://on-device-internals)
- 🔧 [Translation Internals](chrome://on-device-translation-internals)

### Community & Updates
- 💬 [Chrome AI Developer Discord](https://discord.gg/chrome-dev)
- 📰 [Chrome Developers Blog](https://developer.chrome.com/blog)
- 🐛 [Report Issues](https://issues.chromium.org/issues/new?component=1671271)

## Important Notes

### ✅ Production Ready
- Chrome 138+ stable has full support
- APIs are relatively stable and production-ready
- Always implement fallback mechanisms for best UX

### ⚠️ Limitations
- **Desktop only**: Windows/macOS/Linux/ChromeOS
- **No mobile support**: Android/iOS not supported yet
- **Hardware requirements**: Minimum specs needed
- **Initial download**: ~1.7GB model download required
- **Language support**: Currently limited to 3 languages
- **Network**: Metered connections may block downloads

### 💡 Best Practices

#### Text Processing
- Clean HTML tags, use `innerText` for pure text extraction
- Provide `context` for better explanation quality
- Keep input text under 2000 characters for best performance
- Use appropriate summary types for different content

#### Performance
- Cache API instances to avoid repeated initialization
- Use streaming APIs for better user experience
- Implement keepalive sessions to keep models loaded
- Clean up resources on page unload

#### User Experience
- Always provide fallback mechanisms
- Show loading states during model downloads
- Display clear error messages with setup instructions
- Handle user activation requirements (downloads need user gesture)

#### Error Handling
```javascript
try {
  const result = await summarize(text, { lang: 'en' })
  console.log(result)
} catch (error) {
  if (error.name === 'AbortError') {
    console.log('User cancelled the operation')
  } else if (error.name === 'NotSupportedError') {
    console.log('Language or feature not supported')
  } else {
    console.log('Falling back to simple text processing')
  }
}
```

## Privacy & Security

### On-Device Processing
- ✅ All AI processing happens **locally on your device**
- ✅ **No data sent to external servers**
- ✅ **No internet required** after model download
- ✅ **Private by design** - your data stays with you

### Model Storage
- Models stored in Chrome's component directory
- Managed by Chrome's update system
- Can be removed via `chrome://components`
- Shared across all Chrome profiles on same device

### Data Retention
- Chat history stored in `chrome.storage.local`
- Can be cleared via extension popup (Clear All button)
- Automatically cleaned when browser storage is cleared
- Per-page basis - each URL has separate chat history

## Updates & Changelog

### Current Version (v1.0)
- ✅ Summarizer API integration with 4 summary types
- ✅ Translator API with auto language detection
- ✅ Explain feature using Language Model API
- ✅ Multi-turn Page Chat with history persistence
- ✅ Smart caching per (type, language, length)
- ✅ Streaming support for all APIs
- ✅ Token usage tracking and display
- ✅ Graceful fallbacks for all features

### Coming Soon
- 🔜 More language support as Chrome adds them
- 🔜 Custom prompt templates
- 🔜 Export chat history
- 🔜 Offline mode indicators
- 🔜 Advanced model parameter controls

---

**Need Help?** Check console logs (F12) for detailed diagnostic information, or visit the [Chrome AI documentation](https://developer.chrome.com/docs/ai/built-in) for more details.

