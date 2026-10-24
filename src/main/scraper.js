'use strict'
// Otomatik (tarif) çalıştırmada sayfalar gizli bir pencerede, tek oturum halinde gezilir:
// bağlantı adımı -> URL yüklenir; buton adımı -> aynı sayfada tıklanır (SPA desteği).
const { BrowserWindow } = require('electron')

const SETTLE_MS = 2500 // JS ile içerik dolduran sayfalar için bekleme
const LOAD_TIMEOUT = 30000

// Sayfa içinde çalışan yardımcılar (renderer/app.js içindeki kopyasıyla birebir aynı tutulmalı)
const PAGE_LIB = `
  function __label(el) {
    return (el.innerText || el.textContent || el.value || el.getAttribute('aria-label') || el.title || '')
      .replace(/\\s+/g, ' ').trim().slice(0, 160);
  }
  function __visible(el) {
    if (!el.getClientRects || !el.getClientRects().length) return false;
    var st = getComputedStyle(el);
    return st.visibility !== 'hidden' && st.display !== 'none';
  }
  function __cssPath(el) {
    if (el.id) return '#' + CSS.escape(el.id);
    var parts = [];
    var cur = el;
    while (cur && cur.nodeType === 1 && cur.tagName !== 'HTML') {
      if (cur.id) { parts.unshift('#' + CSS.escape(cur.id)); break; }
      var part = cur.tagName.toLowerCase();
      var parent = cur.parentElement;
      if (parent) {
        var same = Array.prototype.filter.call(parent.children, function (c) { return c.tagName === cur.tagName; });
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(cur) + 1) + ')';
      }
      parts.unshift(part);
      cur = parent;
    }
    return parts.join(' > ');
  }
  var __BTN_SEL = 'button, [role="button"], input[type="button"], input[type="submit"], a:not([href]), a[href="#"], a[href^="javascript:"], [onclick]';
  function __collect() {
    var seen = new Set(); var links = [];
    var as = document.querySelectorAll('a[href]');
    for (var i = 0; i < as.length; i++) {
      var a = as[i];
      var raw = a.getAttribute('href') || '';
      if (raw.charAt(0) === '#' || raw.toLowerCase().indexOf('javascript:') === 0) continue;
      var href = a.href;
      if (!/^https?:/i.test(href) || seen.has(href)) continue;
      seen.add(href);
      links.push({ href: href, text: __label(a) });
    }
    var buttons = []; var used = new Set();
    var els = document.querySelectorAll(__BTN_SEL);
    for (var j = 0; j < els.length; j++) {
      var el = els[j];
      if (used.has(el) || !__visible(el)) continue;
      used.add(el);
      if (el.tagName === 'A') {
        var r2 = el.getAttribute('href') || '';
        if (r2 && r2.charAt(0) !== '#' && r2.toLowerCase().indexOf('javascript:') !== 0) continue;
      }
      var text = __label(el);
      if (!text) continue;
      buttons.push({ selector: __cssPath(el), text: text });
      if (buttons.length >= 100) break;
    }
    return { title: document.title, url: location.href, links: links, buttons: buttons };
  }
  function __findButton(sel, text, index) {
    var el = null;
    if (sel) { try { el = document.querySelector(sel); } catch (e) {} }
    if (el) return el;
    var data = __collect();
    var want = (text || '').toLowerCase();
    var i;
    if (want) {
      for (i = 0; i < data.buttons.length; i++) {
        if (data.buttons[i].text.toLowerCase() === want) {
          try { el = document.querySelector(data.buttons[i].selector); } catch (e) {}
          if (el) return el;
        }
      }
      for (i = 0; i < data.buttons.length; i++) {
        if (data.buttons[i].text.toLowerCase().indexOf(want) !== -1) {
          try { el = document.querySelector(data.buttons[i].selector); } catch (e) {}
          if (el) return el;
        }
      }
    }
    if (typeof index === 'number' && index >= 0 && index < data.buttons.length) {
      try { el = document.querySelector(data.buttons[index].selector); } catch (e) {}
      if (el) return el;
    }
    return null;
  }
`

const COLLECT_JS = `(() => {${PAGE_LIB}
  return __collect();
})()`

function valueJs(selector, mode, attr) {
  return `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return { ok: false, error: 'Eleman bulunamadı: ' + ${JSON.stringify(selector)} };
    const mode = ${JSON.stringify(mode || 'text')};
    let value;
    if (mode === 'html') value = el.innerHTML;
    else if (mode === 'attr') value = el.getAttribute(${JSON.stringify(attr || '')});
    else value = (el.innerText || el.textContent || '').trim();
    return { ok: true, value: value == null ? '' : String(value) };
  })()`
}

// Buton adımı: önce CSS seçici, sonra buton metni, en son sıra numarası ile bulunur
function clickJs(step) {
  return `(() => {${PAGE_LIB}
  var el = __findButton(${JSON.stringify(step.selector || '')}, ${JSON.stringify(step.text || '')}, ${Number.isInteger(step.index) ? step.index : -1});
  if (!el) return { ok: false, error: 'Buton sayfada bulunamadı: ' + ${JSON.stringify(String(step.text || step.selector || '?').slice(0, 60))} };
  try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
  el.click();
  return { ok: true };
})()`
}

function openSession() {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  const wc = win.webContents
  // Popup açmaya çalışan butonlar aynı görünümde ilerlesin
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) wc.loadURL(url)
    return { action: 'deny' }
  })

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  async function waitQuiet() {
    for (let round = 0; round < 2; round++) {
      if (wc.isLoading()) {
        await new Promise((resolve) => {
          let timer = null
          const finish = () => {
            clearTimeout(timer)
            wc.removeListener('did-stop-loading', finish)
            resolve()
          }
          timer = setTimeout(finish, 15000)
          wc.once('did-stop-loading', finish)
        })
      }
      await sleep(SETTLE_MS)
      if (!wc.isLoading()) break
    }
  }

  return {
    async goto(url) {
      await Promise.race([
        win.loadURL(url),
        new Promise((_, rej) =>
          setTimeout(() => rej(new Error('Sayfa yükleme zaman aşımı: ' + url)), LOAD_TIMEOUT)
        ),
      ]).catch((err) => {
        // Bazı yönlendirmeler ERR_ABORTED üretir ama sayfa kullanılabilir olur
        if (!/ERR_ABORTED/.test(String(err))) throw err
      })
      await sleep(SETTLE_MS)
    },
    async collect() {
      return wc.executeJavaScript(COLLECT_JS, true)
    },
    async click(step) {
      const r = await wc.executeJavaScript(clickJs(step), true)
      if (!r || !r.ok) throw new Error((r && r.error) || 'Buton tıklanamadı')
      await waitQuiet()
    },
    async value(selector, mode, attr) {
      return wc.executeJavaScript(valueJs(selector, mode, attr), true)
    },
    url() {
      try { return wc.getURL() } catch { return '' }
    },
    close() {
      if (!win.isDestroyed()) win.destroy()
    },
  }
}

module.exports = { openSession }
