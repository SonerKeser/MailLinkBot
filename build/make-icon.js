'use strict'
// Uygulama simgesini üretir: build/icon.svg, build/icon.png (256 px) ve çok boyutlu build/icon.ico.
// Çalıştırma: npm run icon
// SVG, Chromium'un canvas'ına her boyutta ayrı çizdirilip PNG'ye çevrilir. Küçük boyutlarda
// ayrıntı azaltılıp çizgiler kalınlaştırılır; böylece 16 px'te bile okunaklı kalır.
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')

const SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]

// Boyuta göre üç ayrıntı düzeyi (koordinatlar 256x256 ızgarada)
const LEVELS = {
  small: {
    tile: { x: 2, w: 252, r: 60 },
    env: { x: 16, y: 40, w: 180, h: 124, r: 18, v: 22 },
    badge: { cx: 186, cy: 166, r: 56, ring: 8 },
    glyph: null,
  },
  medium: {
    tile: { x: 4, w: 248, r: 58 },
    env: { x: 20, y: 44, w: 172, h: 118, r: 16, v: 15 },
    badge: { cx: 182, cy: 162, r: 52, ring: 6 },
    glyph: { stroke: 10, len: 46, thick: 28 },
  },
  full: {
    tile: { x: 8, w: 240, r: 56 },
    env: { x: 28, y: 49, w: 156, h: 108, r: 16, v: 11 },
    badge: { cx: 178, cy: 157, r: 46, ring: 5 },
    glyph: { stroke: 7, len: 44, thick: 24 },
  },
}
const levelFor = (size) => (size <= 24 ? 'small' : size <= 48 ? 'medium' : 'full')

function svg(size) {
  const { tile, env, badge, glyph } = LEVELS[levelFor(size)]
  const mid = env.x + env.w / 2
  const right = env.x + env.w
  const tip = env.y + env.h * 0.55

  // Zincir halkası: iki iç içe geçmiş kapsül, 45° döndürülmüş
  let link = ''
  if (glyph) {
    const x1 = -(glyph.len * 1.55) / 2
    const x2 = x1 + glyph.len * 0.55
    const cap = (x) =>
      `<rect x="${x.toFixed(2)}" y="${-glyph.thick / 2}" width="${glyph.len}" height="${glyph.thick}" rx="${glyph.thick / 2}"/>`
    link =
      `<g transform="translate(${badge.cx} ${badge.cy}) rotate(-45)" fill="none" stroke="#fff" ` +
      `stroke-width="${glyph.stroke}" stroke-linecap="round" stroke-linejoin="round">${cap(x1)}${cap(x2)}</g>`
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="tile" x1="0.1" y1="0" x2="0.9" y2="1">
      <stop offset="0" stop-color="#202b38"/>
      <stop offset="1" stop-color="#0b0f14"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.28" cy="0.18" r="0.8">
      <stop offset="0" stop-color="#ffb224" stop-opacity="0.24"/>
      <stop offset="1" stop-color="#ffb224" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="env" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffd978"/>
      <stop offset="1" stop-color="#ff9800"/>
    </linearGradient>
    <linearGradient id="badge" x1="0.15" y1="0" x2="0.85" y2="1">
      <stop offset="0" stop-color="#93e8ff"/>
      <stop offset="1" stop-color="#1a8ee0"/>
    </linearGradient>
    <clipPath id="body"><rect x="${env.x}" y="${env.y}" width="${env.w}" height="${env.h}" rx="${env.r}"/></clipPath>
    <filter id="shadow" x="-25%" y="-25%" width="150%" height="160%">
      <feDropShadow dx="0" dy="6" stdDeviation="6" flood-color="#000" flood-opacity="0.55"/>
    </filter>
  </defs>
  <rect x="${tile.x}" y="${tile.x}" width="${tile.w}" height="${tile.w}" rx="${tile.r}" fill="url(#tile)"/>
  <rect x="${tile.x}" y="${tile.x}" width="${tile.w}" height="${tile.w}" rx="${tile.r}" fill="url(#glow)"/>
  <rect x="${tile.x + 1}" y="${tile.x + 1}" width="${tile.w - 2}" height="${tile.w - 2}" rx="${tile.r - 1}" fill="none" stroke="#fff" stroke-opacity="0.1" stroke-width="2"/>
  <rect x="${env.x}" y="${env.y}" width="${env.w}" height="${env.h}" rx="${env.r}" fill="url(#env)" filter="url(#shadow)"/>
  <g clip-path="url(#body)">
    <path d="M${env.x} ${env.y} L${mid} ${tip} L${right} ${env.y} Z" fill="#fff" fill-opacity="0.18"/>
    <path d="M${env.x} ${env.y} L${mid} ${tip} L${right} ${env.y}" fill="none" stroke="#111820" stroke-width="${env.v}" stroke-linejoin="round"/>
  </g>
  <g filter="url(#shadow)">
    <circle cx="${badge.cx}" cy="${badge.cy}" r="${badge.r + badge.ring}" fill="#0e1318"/>
    <circle cx="${badge.cx}" cy="${badge.cy}" r="${badge.r}" fill="url(#badge)"/>
  </g>
  ${link}
</svg>
`
}

// ICO: PNG sıkıştırmalı girdiler (Windows Vista ve sonrası)
function buildIco(entries) {
  const head = Buffer.alloc(6)
  head.writeUInt16LE(1, 2) // tür: simge
  head.writeUInt16LE(entries.length, 4)
  const dir = Buffer.alloc(16 * entries.length)
  let offset = head.length + dir.length
  entries.forEach((e, i) => {
    const o = i * 16
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, o) // 0 = 256
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, o + 1)
    dir.writeUInt16LE(1, o + 4) // düzlem
    dir.writeUInt16LE(32, o + 6) // bit derinliği
    dir.writeUInt32LE(e.png.length, o + 8)
    dir.writeUInt32LE(offset, o + 12)
    offset += e.png.length
  })
  return Buffer.concat([head, dir, ...entries.map((e) => e.png)])
}

const rasterJs = (markup, size) => `(async () => {
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(${JSON.stringify(markup)});
  await img.decode();
  const c = document.createElement('canvas');
  c.width = ${size};
  c.height = ${size};
  c.getContext('2d').drawImage(img, 0, 0, ${size}, ${size});
  return c.toDataURL('image/png');
})()`

// Çalışma profili geçici klasörde tutulur; kullanıcı verisine dokunulmaz
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-link-bot-icon-'))
app.setPath('userData', scratch)
app.disableHardwareAcceleration()
app.on('window-all-closed', () => {})

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false })
  await win.loadURL('about:blank')
  const entries = []
  for (const size of SIZES) {
    const dataUrl = await win.webContents.executeJavaScript(rasterJs(svg(size), size))
    entries.push({ size, png: Buffer.from(dataUrl.split(',')[1], 'base64') })
  }
  win.destroy()

  fs.writeFileSync(path.join(__dirname, 'icon.svg'), svg(256))
  fs.writeFileSync(path.join(__dirname, 'icon.png'), entries.find((e) => e.size === 256).png)
  const ico = buildIco(entries)
  fs.writeFileSync(path.join(__dirname, 'icon.ico'), ico)

  console.log('Simge üretildi: ' + entries.map((e) => `${e.size}px=${e.png.length}B`).join(', '))
  console.log(`icon.ico: ${ico.length} bayt`)
  try { fs.rmSync(scratch, { recursive: true, force: true }) } catch {}
  app.exit(0)
}).catch((e) => {
  console.error(e)
  app.exit(1)
})
