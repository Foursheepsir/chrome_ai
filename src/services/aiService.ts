type SummOpts = { maxWords?: number; lang?: string }
type ExplainOpts = { context?: string; lang?: string }
type TransOpts = { targetLang: string }

export async function summarize(text: string, opts: SummOpts = {}) {
  const max = opts.maxWords ?? 120
  const fake = text.split(/\s+/).slice(0, max).join(' ')
  return `Summary (${opts.lang ?? 'auto'}): ${fake}${fake.length < text.length ? '…' : ''}`
}
export async function explain(term: string, opts: ExplainOpts = {}) {
  const ctx = opts.context?.slice(0, 300) ?? ''
  return `Explanation (${opts.lang ?? 'auto'}): “${term}” — based on context: ${ctx ? ctx + ' …' : 'N/A'}`
}
export async function translate(text: string, opts: TransOpts) {
  return `[${opts.targetLang}](placeholder) ${text}`
}
