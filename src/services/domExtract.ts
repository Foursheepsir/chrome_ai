export function getSelectionText(): string {
    const sel = window.getSelection()
    return sel ? sel.toString().trim() : ''
  }
  export function extractReadableText(doc: Document = document): string {
    const cloned = doc.body.cloneNode(true) as HTMLElement
    for (const sel of ['nav','header','footer','aside','script','style','noscript']) {
      cloned.querySelectorAll(sel).forEach(e => e.remove())
    }
    return cloned.innerText.replace(/\n{3,}/g, '\n\n').trim()
  }
  