type SummOpts = { 
  lang?: string
  type?: 'tldr' | 'key-points' | 'teaser' | 'headline'  // 摘要类型
  onChunk?: (chunk: string) => void  // 流式更新回调
}
type ExplainOpts = { context?: string; lang?: string }
type TransOpts = { targetLang: string }

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
}

// Summarizer 实例缓存（按 type 分别缓存）
const summarizerCache: Map<string, Summarizer> = new Map()

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
  if (wordCount < 500) return 'medium'     // 中等文本: 200-500词 -> 3句摘要
  return 'long'                            // 长文本: >500词 -> 5句摘要
}

// 获取或创建 Summarizer 实例
async function getSummarizer(text: string, opts: SummOpts = {}): Promise<Summarizer | null> {
  try {
    const lang = opts.lang || 'en'
    const type = opts.type || 'tldr'
    
    // 使用 type 作为缓存键
    const cacheKey = type
    
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
      format: 'plain-text',
      expectedInputLanguages: [lang],
      outputLanguage: lang
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
      lang: createOptions.outputLanguage
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
          
          // 重要：每个 chunk 是增量内容（新增的 token），需要累积
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

export async function translate(text: string, opts: TransOpts): Promise<string> {
  try {
    // Summarizer API 不直接支持翻译，这里使用降级方案
    // 未来可以集成 Chrome Translation API
    console.log('[AI] Translation not yet supported by Summarizer API')
    return `[${opts.targetLang}] ${text}`
  } catch (e) {
    console.error('[AI] Translation error:', e)
    return `[${opts.targetLang}] ${text}`
  }
}

// 清理资源
export function destroySummarizer() {
  if (summarizerCache.size > 0) {
    try {
      summarizerCache.forEach((summarizer, type) => {
        summarizer.destroy()
        console.log(`[AI] Destroyed Summarizer (type: ${type})`)
      })
      summarizerCache.clear()
      console.log('[AI] All Summarizer instances destroyed')
    } catch (e) {
      console.warn('[AI] Error destroying summarizers:', e)
    }
  }
}

// 诊断 AI API 状态
export async function __diagnoseAI() {
  console.log('=== Chrome AI Diagnostic ===')
  console.log('User Agent:', navigator.userAgent)
  console.log('Chrome Version:', /Chrome\/(\S+)/.exec(navigator.userAgent)?.[1] || 'Unknown')
  
  // 复用现有的检查逻辑
  console.log('\n1. Checking Summarizer availability...')
  const availability = await checkSummarizerAvailability()
  
  if (availability === 'unavailable') {
    console.log('=== End Diagnostic ===\n')
    return
  }
  
  // 2. 测试创建实例
  console.log('\n2. Testing instance creation...')
  try {
    console.log('Creating test Summarizer instance with sample text...')
    const testText = 'This is a test to verify the Summarizer API is working correctly.'
    const testSummarizer = await Summarizer.create({
      type: 'tldr',
      length: determineLength(testText),
      format: 'plain-text',
      expectedInputLanguages: ['en'],
      outputLanguage: 'en'
    })
    console.log('✅ Successfully created Summarizer instance!')
    testSummarizer.destroy()
    console.log('✅ Cleaned up test instance')
  } catch (e) {
    console.error('❌ Failed to create instance:', e)
  }
  
  console.log('\n=== End Diagnostic ===\n')
}

