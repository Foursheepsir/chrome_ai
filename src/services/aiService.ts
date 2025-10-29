type SummOpts = { 
  lang?: string
  type?: 'tldr' | 'key-points' | 'teaser' | 'headline'  // 摘要类型
  onChunk?: (chunk: string) => void  // 流式更新回调
}
type ExplainOpts = { context?: string; lang?: string }
type TransOpts = { 
  targetLang: string
  onChunk?: (chunk: string) => void  // 流式更新回调
}

// 类型声明 - Chrome Summarizer API (最新版本)
declare global {
  // 全局 Summarizer 类
  const Summarizer: {
    availability(): Promise<'unavailable' | 'downloadable' | 'downloading' | 'available'>
    create(options?: SummarizerCreateOptions): Promise<Summarizer>
  }

  interface SummarizerCreateOptions {
    sharedContext?: string
    type?: 'tldr' | 'key-points' | 'teaser' | 'headline'
    length?: 'short' | 'medium' | 'long'
    format?: 'plain-text' | 'markdown'
    expectedInputLanguages?: string[]
    outputLanguage?: string
    monitor?: (m: AIDownloadProgressMonitor) => void
  }

  interface AIDownloadProgressMonitor {
    addEventListener(type: 'downloadprogress', listener: (e: DownloadProgressEvent) => void): void
  }

  interface DownloadProgressEvent {
    loaded: number
    total: number
  }

  interface Summarizer {
    summarize(text: string, options?: { context?: string }): Promise<string>
    summarizeStreaming(text: string, options?: { context?: string }): AsyncIterable<string>
    destroy(): void
  }

  // 全局 Translator 类
  const Translator: {
    availability(options: { sourceLanguage: string; targetLanguage: string }): Promise<'unavailable' | 'downloadable' | 'downloading' | 'available'>
    create(options: TranslatorCreateOptions): Promise<Translator>
  }

  interface TranslatorCreateOptions {
    sourceLanguage: string
    targetLanguage: string
    monitor?: (m: AIDownloadProgressMonitor) => void
  }

  interface Translator {
    translate(text: string): Promise<string>
    translateStreaming(text: string): AsyncIterable<string>
    destroy(): void
  }

  // 全局 LanguageDetector 类
  const LanguageDetector: {
    availability(): Promise<'unavailable' | 'downloadable' | 'downloading' | 'available'>
    create(options?: LanguageDetectorCreateOptions): Promise<LanguageDetector>
  }

  interface LanguageDetectorCreateOptions {
    monitor?: (m: AIDownloadProgressMonitor) => void
  }

  interface LanguageDetector {
    detect(text: string): Promise<LanguageDetectionResult[]>
    destroy(): void
  }

  interface LanguageDetectionResult {
    detectedLanguage: string
    confidence: number
  }
}

// Summarizer 实例缓存（按 type 分别缓存）
const summarizerCache: Map<string, Summarizer> = new Map()

// LanguageDetector 实例缓存
let languageDetectorInstance: LanguageDetector | null = null

// Translator 实例缓存（按语言对缓存）
const translatorCache: Map<string, Translator> = new Map()

// 检查 Summarizer API 是否可用
async function checkSummarizerAvailability(): Promise<'available' | 'needs-download' | 'unavailable'> {
  try {
    // 检查 API 是否存在
    console.log('[AI] Checking Summarizer API...')
    
    if (!('Summarizer' in self)) {
      console.log('[AI] ❌ Summarizer API not found')
      console.log('[AI] 💡 Make sure you have:')
      console.log('[AI]    1. Chrome 138+ stable (or Chrome Canary/Dev 128+)')
      console.log('[AI]    2. Enabled flags in chrome://flags:')
      console.log('[AI]       - #summarization-api-for-gemini-nano')
      console.log('[AI]       - #optimization-guide-on-device-model')
      return 'unavailable'
    }
    
    console.log('[AI] ✅ Summarizer API found')
    
    // 检查可用性
    const status = await Summarizer.availability()
    console.log('[AI] Summarizer status:', status)
    
    if (status === 'unavailable') {
      console.log('[AI] ❌ Summarizer unavailable (device not supported)')
      return 'unavailable'
    }
    
    if (status === 'downloadable') {
      console.log('[AI] ⏳ Model needs download (will auto-download on create())')
      return 'needs-download'
    }
    
    if (status === 'downloading') {
      console.log('[AI] ⏳ Model is downloading...')
      return 'needs-download'
    }
    
    console.log('[AI] ✅ Summarizer ready!')
    return 'available'
  } catch (e) {
    console.warn('[AI] ❌ Error checking availability:', e)
    return 'unavailable'
  }
}

// 根据文本长度自动选择摘要长度
function determineLength(text: string): 'short' | 'medium' | 'long' {
  const wordCount = text.split(/\s+/).length
  
  if (wordCount < 200) return 'short'      // 短文本: <200词 -> 1句摘要
  if (wordCount < 800) return 'medium'     // 中等文本: 200-800词 -> 3句摘要
  return 'long'                            // 长文本: >800词 -> 5句摘要
}

// 获取或创建 Summarizer 实例
async function getSummarizer(text: string, opts: SummOpts = {}): Promise<Summarizer | null> {
  try {
    const requestedLang = opts.lang || 'en'
    const type = opts.type || 'tldr'

    // 仅允许 Summarizer 支持的输出语言，其他一律回退到 en
    const supportedOutputLangs = ['en', 'es', 'ja'] as const
    const outputLanguage = (supportedOutputLangs as readonly string[]).includes(requestedLang) ? requestedLang : 'en'

    // 缓存键需要包含输出语言，避免复用到不同语言配置的实例
    const cacheKey = `${type}:${outputLanguage}`
    
    // 如果已有该类型的实例，直接返回
    if (summarizerCache.has(cacheKey)) {
      console.log(`[AI] Reusing cached Summarizer (type: ${type})`)
      return summarizerCache.get(cacheKey)!
    }

    // 检查可用性
    const availability = await checkSummarizerAvailability()
    if (availability === 'unavailable') {
      return null
    }

    // 检查用户激活（首次下载模型时需要）
    if (availability === 'needs-download' && !navigator.userActivation.isActive) {
      console.log('[AI] ⚠️ Model download requires user activation')
      return null
    }
    
    // 创建配置
    const summaryType = opts.type || 'tldr'
    const createOptions: SummarizerCreateOptions = {
      sharedContext: 'General purpose user-friendly text summarization for web content',
      type: summaryType,
      length: determineLength(text),
      format: summaryType === 'key-points' ? 'markdown' : 'plain-text',
      outputLanguage : outputLanguage,
      expectedInputLanguages: ['en', 'ja', 'es']
    }
    
    // 只有需要下载时才添加 monitor
    if (availability === 'needs-download') {
      console.log('[AI] Model needs download - adding progress monitor')
      createOptions.monitor = (m) => {
        m.addEventListener('downloadprogress', (e) => {
          const percent = Math.round(e.loaded * 100)
          console.log(`[AI] Downloading model: ${percent}%`)
        })
      }
    } else {
      console.log('[AI] Model already available - no download needed')
    }

    console.log('[AI] Creating Summarizer instance...')
    console.log('[AI] Config:', {
      type: createOptions.type,
      length: createOptions.length,
      format: createOptions.format,
      wordCount: text.split(/\s+/).length,
      outputLanguage: createOptions.outputLanguage
    })
    
    const summarizer = await Summarizer.create(createOptions)
    console.log('[AI] ✅ Summarizer created successfully')
    
    // 缓存该实例
    summarizerCache.set(cacheKey, summarizer)
    console.log(`[AI] Cached Summarizer (type: ${type})`)

    return summarizer
  } catch (e) {
    console.error('[AI] ❌ Failed to create Summarizer:', e)
    return null
  }
}

// 降级方案：简单文本摘要
function fallbackSummarize(text: string): string {
  const MAX_WORDS = 150
  const words = text.split(/\s+/)
  const truncated = words.slice(0, MAX_WORDS).join(' ')
  return truncated + (words.length > MAX_WORDS ? '...' : '')
}

export async function summarize(text: string, opts: SummOpts = {}): Promise<string> {
  // 确保语言和类型参数有默认值
  const optsWithDefaults: SummOpts = {
    lang: 'en',
    type: 'tldr',  // 默认 tldr
    ...opts  // 调用时传递的 opts 会覆盖默认值
  }
  
  try {
    // 尝试使用 Chrome AI Summarizer API
    const summarizer = await getSummarizer(text, optsWithDefaults)
    
    if (summarizer) {
      console.log('[AI] Using Chrome AI Summarizer API (streaming)')
      
      try {
        // 使用流式 API - 官方推荐的 for await of 语法
        const stream = summarizer.summarizeStreaming(text)
        let result = ''
        
        for await (const chunk of stream) {
          
          // 每个 chunk 是增量内容（新增的 token），需要累积
          result += chunk
          
          // 如果有回调，实时更新累积结果
          if (optsWithDefaults.onChunk) {
            optsWithDefaults.onChunk(result)
          }
        }
        
        console.log(`[AI] ✅ Streaming completed`)
        return result
      } catch (streamError) {
        console.error('[AI] Streaming error, trying non-streaming approach:', streamError)
        // 如果流式失败，尝试批量模式
        const result = await summarizer.summarize(text)
        optsWithDefaults.onChunk?.(result)
        return result
      }
    }
    
    // 降级到简单摘要
    console.log('[AI] Using fallback summarization')
    const fallback = fallbackSummarize(text)
    optsWithDefaults.onChunk?.(fallback)
    return fallback
  } catch (e) {
    console.error('[AI] Summarization error:', e)
    const fallback = fallbackSummarize(text)
    optsWithDefaults.onChunk?.(fallback)
    return fallback
  }
}

export async function explain(term: string, opts: ExplainOpts = {}): Promise<string> {
  try {
    // TODO: 使用专门的 Explain API (未来实现)
    // 目前使用降级方案
    console.log('[AI] Explain feature - using fallback (dedicated API coming soon)')
    const ctx = opts.context?.slice(0, 300) ?? ''
    return `"${term}" - ${ctx ? `Context: ${ctx}...` : 'No additional context'}`
  } catch (e) {
    console.error('[AI] Explain error:', e)
  const ctx = opts.context?.slice(0, 300) ?? ''
    return `"${term}" - ${ctx ? `Context: ${ctx}...` : 'No context available'}`
  }
}

// 获取或创建 LanguageDetector 实例
async function getLanguageDetector(): Promise<LanguageDetector | null> {
  try {
    // 如果已有实例，直接返回
    if (languageDetectorInstance) {
      console.log('[AI] Reusing cached LanguageDetector')
      return languageDetectorInstance
    }

    // 检查 API 是否存在
    if (!('LanguageDetector' in self)) {
      console.log('[AI] ❌ LanguageDetector API not found')
      return null
    }

    // 检查可用性
    const availability = await LanguageDetector.availability()
    console.log('[AI] LanguageDetector status:', availability)

    if (availability === 'unavailable') {
      console.log('[AI] ❌ LanguageDetector unavailable')
      return null
    }

    // 检查用户激活
    if (availability === 'downloadable' && !navigator.userActivation.isActive) {
      console.log('[AI] ⚠️ LanguageDetector download requires user activation')
      return null
    }

    console.log('[AI] Creating LanguageDetector instance...')
    const detector = await LanguageDetector.create()
    console.log('[AI] ✅ LanguageDetector created successfully')

    // 缓存实例
    languageDetectorInstance = detector
    return detector
  } catch (e) {
    console.error('[AI] ❌ Failed to create LanguageDetector:', e)
    return null
  }
}

// 检测文本语言
async function detectLanguage(text: string): Promise<string> {
  try {
    const detector = await getLanguageDetector()
    if (!detector) {
      console.log('[AI] Using fallback language detection (en)')
      return 'en'
    }

    const results = await detector.detect(text)
    if (results && results.length > 0) {
      const topResult = results[0]
      console.log('[AI] Detected language:', topResult.detectedLanguage, 'confidence:', topResult.confidence)
      return topResult.detectedLanguage
    }

    console.log('[AI] No detection result, using fallback (en)')
    return 'en'
  } catch (e) {
    console.error('[AI] Language detection error:', e)
    return 'en'
  }
}

// 获取或创建 Translator 实例
async function getTranslator(sourceLanguage: string, targetLanguage: string): Promise<Translator | null> {
  try {
    // 使用语言对作为缓存键
    const cacheKey = `${sourceLanguage}-${targetLanguage}`

    // 如果已有该语言对的实例，直接返回
    if (translatorCache.has(cacheKey)) {
      console.log(`[AI] Reusing cached Translator (${cacheKey})`)
      return translatorCache.get(cacheKey)!
    }

    // 检查 API 是否存在
    if (!('Translator' in self)) {
      console.log('[AI] ❌ Translator API not found')
      return null
    }

    // 检查语言对可用性
    const availability = await Translator.availability({
      sourceLanguage,
      targetLanguage
    })
    console.log(`[AI] Translator status (${cacheKey}):`, availability)

    if (availability === 'unavailable') {
      console.log(`[AI] ❌ Translator unavailable for ${cacheKey}`)
      return null
    }

    // 检查用户激活
    if (availability === 'downloadable' && !navigator.userActivation.isActive) {
      console.log('[AI] ⚠️ Translator download requires user activation')
      return null
    }

    console.log(`[AI] Creating Translator instance (${cacheKey})...`)
    
    const createOptions: TranslatorCreateOptions = {
      sourceLanguage,
      targetLanguage
    }

    // 只有需要下载时才添加 monitor
    if (availability === 'downloadable') {
      console.log('[AI] Model needs download - adding progress monitor')
      createOptions.monitor = (m) => {
        m.addEventListener('downloadprogress', (e) => {
          const percent = Math.round(e.loaded * 100)
          console.log(`[AI] Downloading translation model (${cacheKey}): ${percent}%`)
        })
      }
    }

    const translator = await Translator.create(createOptions)
    console.log(`[AI] ✅ Translator created successfully (${cacheKey})`)

    // 缓存实例
    translatorCache.set(cacheKey, translator)
    return translator
  } catch (e) {
    console.error('[AI] ❌ Failed to create Translator:', e)
    return null
  }
}

// 降级方案：简单标记
function fallbackTranslate(text: string, targetLang: string): string {
  return `[${targetLang}] ${text}`
}

export async function translate(text: string, opts: TransOpts): Promise<string> {
  try {
    console.log('[AI] ===== Translation Request =====')
    console.log('[AI] Target language from settings:', opts.targetLang)

    // 1. 检测源语言
    console.log('[AI] Detecting source language...')
    const sourceLanguage = await detectLanguage(text)
    console.log(`[AI] Detected source language: ${sourceLanguage}`)

    // 2. 如果源语言和目标语言相同，直接返回
    if (sourceLanguage === opts.targetLang) {
      console.log('[AI] Source and target languages are the same, returning original text')
      opts.onChunk?.(text)
      return text
    }

    // 3. 获取翻译器
    console.log(`[AI] Requesting translator for: ${sourceLanguage} -> ${opts.targetLang}`)
    const translator = await getTranslator(sourceLanguage, opts.targetLang)

    if (!translator) {
      console.log('[AI] Using fallback translation')
      const fallback = fallbackTranslate(text, opts.targetLang)
      opts.onChunk?.(fallback)
      return fallback
    }

    // 4. 执行流式翻译
    console.log('[AI] Using Chrome AI Translator API (streaming)')

    try {
      const stream = translator.translateStreaming(text)
      let result = ''

      for await (const chunk of stream) {
        // 累积内容
        result += chunk

        // 实时更新
        if (opts.onChunk) {
          opts.onChunk(result)
        }
      }

      console.log('[AI] ✅ Translation completed')
      return result
    } catch (streamError) {
      console.error('[AI] Streaming error, trying non-streaming approach:', streamError)
      // 如果流式失败，尝试批量模式
      const result = await translator.translate(text)
      opts.onChunk?.(result)
      return result
    }
  } catch (e) {
    console.error('[AI] Translation error:', e)
    const fallback = fallbackTranslate(text, opts.targetLang)
    opts.onChunk?.(fallback)
    return fallback
  }
}

// 清理资源
export function destroyResources() {
  try {
    // 清理 Summarizer 实例
    if (summarizerCache.size > 0) {
      summarizerCache.forEach((summarizer, type) => {
        summarizer.destroy()
        console.log(`[AI] Destroyed Summarizer (type: ${type})`)
      })
      summarizerCache.clear()
      console.log('[AI] All Summarizer instances destroyed')
    }

    // 清理 Translator 实例
    if (translatorCache.size > 0) {
      translatorCache.forEach((translator, langPair) => {
        translator.destroy()
        console.log(`[AI] Destroyed Translator (${langPair})`)
      })
      translatorCache.clear()
      console.log('[AI] All Translator instances destroyed')
    }

    // 清理 LanguageDetector 实例
    if (languageDetectorInstance) {
      languageDetectorInstance.destroy()
      languageDetectorInstance = null
      console.log('[AI] LanguageDetector instance destroyed')
    }
  } catch (e) {
    console.warn('[AI] Error destroying AI instances:', e)
  }
}

