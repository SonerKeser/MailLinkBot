'use strict'
// Önizleme webview'i içinde çalışır: eleman seçme (picker) modu.
// Tıklanan elemandan CSS seçici üretip ana pencereye gönderir.
const { ipcRenderer } = require('electron')

let picking = false
let lastEl = null
let lastOutline = ''

function cssPath(el) {
  if (el.id) return '#' + CSS.escape(el.id)
  const parts = []
  let cur = el
  while (cur && cur.nodeType === 1 && cur.tagName !== 'HTML') {
    if (cur.id) {
      parts.unshift('#' + CSS.escape(cur.id))
      break
    }
    let part = cur.tagName.toLowerCase()
    const parent = cur.parentElement
    if (parent) {
      const same = Array.from(parent.children).filter((c) => c.tagName === cur.tagName)
      if (same.length > 1) part += `:nth-of-type(${same.indexOf(cur) + 1})`
    }
    parts.unshift(part)
    cur = parent
  }
  return parts.join(' > ')
}

function restore() {
  if (lastEl) {
    try { lastEl.style.outline = lastOutline } catch {}
    lastEl = null
  }
}

function setPicking(on) {
  picking = on
  if (!on) restore()
  if (document.documentElement) {
    document.documentElement.style.cursor = on ? 'crosshair' : ''
  }
}

window.addEventListener('mouseover', (e) => {
  if (!picking || !e.target || e.target.nodeType !== 1) return
  restore()
  lastEl = e.target
  lastOutline = lastEl.style.outline
  lastEl.style.outline = '2px solid #ffb224'
}, true)

window.addEventListener('click', (e) => {
  if (!picking) return
  e.preventDefault()
  e.stopImmediatePropagation()
  const el = e.target
  restore()
  setPicking(false)
  ipcRenderer.sendToHost('picker:picked', {
    selector: cssPath(el),
    text: (el.innerText || el.textContent || '').trim().slice(0, 300),
  })
}, true)

window.addEventListener('mousedown', (e) => {
  if (picking) { e.preventDefault(); e.stopImmediatePropagation() }
}, true)

window.addEventListener('keydown', (e) => {
  if (picking && e.key === 'Escape') {
    setPicking(false)
    ipcRenderer.sendToHost('picker:cancelled')
  }
}, true)

ipcRenderer.on('picker:set', (_e, on) => setPicking(!!on))
