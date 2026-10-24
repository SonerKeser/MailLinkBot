'use strict'
const $ = (s) => document.querySelector(s)
const $$ = (s) => Array.from(document.querySelectorAll(s))

const state = {
  mails: [],
  currentMailIdx: -1,
  chain: [],        // link: {type:'link', index, href, pattern, text} | buton: {type:'click', index, selector, text}
  pageLinks: [],    // 3. paneldeki bağlantılar
  pageButtons: [],  // 3. paneldeki tıklanabilir butonlar
  atMailLevel: true,
  lastValue: null,
  tgChats: [],
  picking: false,
}

let webview = null

/* Sayfa içinde çalışan yardımcılar (src/main/scraper.js içindeki kopyasıyla birebir aynı tutulmalı) */
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

function pageClickJs(step) {
  return `(() => {${PAGE_LIB}
  var el = __findButton(${JSON.stringify(step.selector || '')}, ${JSON.stringify(step.text || '')}, ${Number.isInteger(step.index) ? step.index : -1});
  if (!el) return { ok: false, error: 'Buton sayfada bulunamadı: ' + ${JSON.stringify(String(step.text || step.selector || '?').slice(0, 60))} };
  try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
  el.click();
  return { ok: true };
})()`
}

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

/* ── yardımcılar ─────────────────────────────────────────────── */
function err(e) {
  return String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
function toast(msg, isErr) {
  const d = document.createElement('div')
  d.className = 'toast' + (isErr ? ' err' : '')
  d.textContent = msg
  $('#toasts').appendChild(d)
  setTimeout(() => d.remove(), isErr ? 6000 : 3500)
}
function fmtDate(iso) {
  return iso ? new Date(iso).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' }) : ''
}
function renderTemplate(tpl, ctx) {
  const t = tpl && tpl.trim() ? tpl : '{value}'
  return t.replace(/\{(value|subject|url|name|date)\}/g, (_, k) => (ctx[k] == null ? '' : String(ctx[k])))
}

/* ── sekmeler ────────────────────────────────────────────────── */
$$('.tab').forEach((b) =>
  b.addEventListener('click', () => {
    $$('.tab').forEach((x) => x.classList.toggle('active', x === b))
    $$('.tabpage').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + b.dataset.tab))
    if (b.dataset.tab === 'recipes') renderRecipes()
    if (b.dataset.tab === 'settings') loadSettings() // her açılışta diskteki güncel durumu göster
  })
)

/* ── webview (önizleme) ─────────────────────────────────────── */
function createWebview() {
  webview = document.createElement('webview')
  webview.setAttribute('preload', window.api.webviewPreload)
  webview.setAttribute('src', 'about:blank')
  $('#viewWrap').appendChild(webview)

  let collectTimer = null
  const scheduleCollect = (delay) => {
    clearTimeout(collectTimer)
    collectTimer = setTimeout(collectPageLinks, delay)
  }
  webview.addEventListener('did-stop-loading', () => {
    const url = webview.getURL()
    if (url === 'about:blank') return
    $('#pageUrl').textContent = url
    scheduleCollect(1200)
  })
  // SPA'lar (one-page siteler) tam sayfa yüklemeden gezinir; bunları da yakala
  webview.addEventListener('did-navigate-in-page', () => scheduleCollect(800))
  webview.addEventListener('did-navigate', () => {
    if (state.picking) { state.picking = false; updatePickBtn() }
  })
  webview.addEventListener('did-fail-load', (e) => {
    if (e.errorCode === -3 || e.isMainFrame === false) return
    toast(`Sayfa yüklenemedi: ${e.errorDescription || e.errorCode}`, true)
  })
  webview.addEventListener('ipc-message', (e) => {
    if (e.channel === 'picker:picked') {
      const { selector, text } = e.args[0] || {}
      state.picking = false
      updatePickBtn()
      $('#selInput').value = selector || ''
      toast('Eleman seçildi: ' + (text || selector || '').slice(0, 60))
      testSelector()
    } else if (e.channel === 'picker:cancelled') {
      state.picking = false
      updatePickBtn()
    }
  })
}

async function collectPageLinks() {
  if (!webview || webview.getURL() === 'about:blank') return
  try {
    const res = await webview.executeJavaScript(COLLECT_JS, true)
    state.pageLinks = res.links || []
    state.pageButtons = res.buttons || []
    state.atMailLevel = false
    $('#pageUrl').textContent = res.url || webview.getURL()
    renderLinks()
    renderCrumbs()
  } catch {
    /* sayfa henüz hazır değil; sonraki yükleme olayı yakalar */
  }
}

/* ── mail arama ve listeleme ────────────────────────────────── */
function collectFilter() {
  return {
    subject: $('#fSubject').value.trim(),
    from: $('#fFrom').value.trim(),
    body: $('#fBody').value.trim(),
    sinceDays: Number($('#fDays').value),
    unseenOnly: $('#fUnseen').checked,
  }
}

$('#filterForm').addEventListener('submit', async (e) => {
  e.preventDefault()
  const f = collectFilter()
  if (!f.subject && !f.from && !f.body) return toast('En az bir filtre alanı doldurun', true)
  const btn = $('#btnSearch')
  btn.disabled = true
  btn.textContent = 'Aranıyor…'
  try {
    state.mails = await window.api.mailSearch(f)
    state.currentMailIdx = -1
    renderMails()
    resetChain()
    if (!state.mails.length) toast('Filtreye uyan mail bulunamadı')
  } catch (e2) {
    toast(err(e2), true)
  } finally {
    btn.disabled = false
    btn.textContent = 'Mailleri Tara'
  }
})

function renderMails() {
  const ul = $('#mailList')
  ul.innerHTML = ''
  $('#mailCount').textContent = state.mails.length ? `(${state.mails.length})` : ''
  if (!state.mails.length) {
    ul.innerHTML = '<li class="empty">Sonuç yok</li>'
    return
  }
  state.mails.forEach((m, i) => {
    const li = document.createElement('li')
    li.className = 'item' + (i === state.currentMailIdx ? ' sel' : '')
    const t = document.createElement('div')
    t.className = 't'
    t.textContent = m.subject
    const s = document.createElement('div')
    s.className = 's'
    s.textContent = `${m.from} • ${fmtDate(m.date)} • ${m.links.length} bağlantı`
    li.append(t, s)
    li.addEventListener('click', () => selectMail(i))
    ul.appendChild(li)
  })
}

function selectMail(i) {
  state.currentMailIdx = i
  renderMails()
  resetChain()
}

/* ── bağlantı zinciri ───────────────────────────────────────── */
function resetChain() {
  state.chain = []
  state.picking = false
  updatePickBtn()
  state.lastValue = null
  $('#valueOut').textContent = '—'
  const m = state.mails[state.currentMailIdx]
  state.pageLinks = m ? m.links : []
  state.pageButtons = []
  state.atMailLevel = true
  if (webview) {
    try { webview.stop() } catch {}
    webview.setAttribute('src', 'about:blank')
  }
  $('#pageUrl').textContent = 'sayfa açılmadı'
  $('#viewPlaceholder').classList.remove('hidden')
  renderLinks()
  renderCrumbs()
}

function openLink(i) {
  const l = state.pageLinks[i]
  if (!l) return
  let pattern = ''
  try {
    const u = new URL(l.href)
    pattern = u.hostname + (u.pathname !== '/' ? u.pathname : '')
  } catch {}
  state.chain.push({ type: 'link', index: i, href: l.href, pattern, text: l.text })
  $('#viewPlaceholder').classList.add('hidden')
  webview.setAttribute('src', l.href)
  $('#pageUrl').textContent = l.href + '  (yükleniyor…)'
  renderCrumbs()
}

async function openButton(i) {
  const b = state.pageButtons[i]
  if (!b) return
  const step = { type: 'click', index: i, selector: b.selector, text: b.text }
  try {
    const res = await webview.executeJavaScript(pageClickJs(step), true)
    if (!res || !res.ok) return toast((res && res.error) || 'Buton tıklanamadı', true)
  } catch (e) {
    return toast(err(e), true)
  }
  state.chain.push(step)
  renderCrumbs()
  toast(`Buton tıklandı: ${(b.text || '').slice(0, 40)} — sayfa güncelleniyor…`)
  setTimeout(collectPageLinks, 1500)
}

function chainBack() {
  if (!state.chain.length) return
  if (state.chain.some((s) => s.type === 'click')) {
    resetChain()
    return toast('Buton adımları geri alınamadığı için zincir başa döndü')
  }
  if (state.chain.length === 1) return resetChain()
  state.chain.pop()
  const last = state.chain[state.chain.length - 1]
  webview.setAttribute('src', last.href)
  renderCrumbs()
}

function renderLinks() {
  const ul = $('#linkList')
  const hint = $('#linkHint')
  ul.innerHTML = ''
  const nl = state.pageLinks.length
  const nb = state.pageButtons.length
  $('#linkCount').textContent = nl + nb ? `(${nl + nb})` : ''
  if (state.currentMailIdx < 0) {
    hint.textContent = 'Bir mail seçince bağlantıları burada listelenir'
    return
  }
  hint.textContent = state.atMailLevel
    ? `Mail içindeki bağlantılar — ${state.chain.length + 1}. adım için birini açın`
    : `${nl} bağlantı, ${nb} buton — ${state.chain.length + 1}. adım için birini seçin (ya da sağda eleman seçin)`
  if (!nl && !nb) {
    ul.innerHTML = '<li class="empty">Bağlantı veya buton bulunamadı</li>'
    return
  }
  const addItem = (chip, chipCls, text, sub, subCls, title, onClick) => {
    const li = document.createElement('li')
    li.className = 'item'
    const t = document.createElement('div')
    t.className = 't'
    const idx = document.createElement('span')
    idx.className = 'idx' + (chipCls ? ' ' + chipCls : '')
    idx.textContent = chip
    t.appendChild(idx)
    t.appendChild(document.createTextNode(text))
    const u = document.createElement('div')
    u.className = subCls
    u.textContent = sub
    li.append(t, u)
    li.title = title
    li.addEventListener('click', onClick)
    ul.appendChild(li)
  }
  state.pageLinks.forEach((l, i) =>
    addItem(String(i + 1), '', l.text || '(metinsiz bağlantı)', l.href, 'u', l.href, () => openLink(i))
  )
  state.pageButtons.forEach((b, i) =>
    addItem('B' + (i + 1), 'btn', b.text || '(metinsiz buton)', 'buton — sayfada tıklanır', 's', b.selector, () => openButton(i))
  )
}

function renderCrumbs() {
  const c = $('#chainCrumbs')
  c.innerHTML = ''
  const start = document.createElement('button')
  start.className = 'crumb' + (state.chain.length ? '' : ' cur')
  start.textContent = '✉ Mail'
  start.title = 'Mail bağlantılarına dön (zinciri sıfırlar)'
  start.disabled = state.currentMailIdx < 0
  start.addEventListener('click', resetChain)
  c.appendChild(start)
  state.chain.forEach((s, i) => {
    const b = document.createElement('span')
    b.className = 'crumb' + (i === state.chain.length - 1 ? ' cur' : '')
    if (s.type === 'click') {
      b.textContent = `${i + 1} 🖱 ${(s.text || 'buton').slice(0, 22)}`
      b.title = s.selector || ''
    } else {
      let host = s.href
      try { host = new URL(s.href).hostname } catch {}
      b.textContent = `${i + 1} ▸ ${host}`
      b.title = s.href
    }
    c.appendChild(b)
  })
}

/* ── eleman seçici / değer okuma ────────────────────────────── */
function updatePickBtn() {
  const b = $('#btnPick')
  b.classList.toggle('active', state.picking)
  b.textContent = state.picking ? '⏹ Seçimi İptal (Esc)' : '◎ Eleman Seç'
}

$('#btnPick').addEventListener('click', () => {
  if (!state.chain.length) return toast('Önce soldaki listeden bir bağlantı açın', true)
  state.picking = !state.picking
  try { webview.send('picker:set', state.picking) } catch {}
  updatePickBtn()
  if (state.picking) toast('Önizlemede istediğiniz elemana tıklayın')
})

$('#btnChainBack').addEventListener('click', chainBack)

$('#selMode').addEventListener('change', () => {
  $('#selAttr').classList.toggle('hidden', $('#selMode').value !== 'attr')
})

async function testSelector() {
  if (!state.chain.length) return toast('Önce bir bağlantı açın', true)
  const sel = $('#selInput').value.trim()
  if (!sel) return toast('CSS seçici girin ya da "Eleman Seç" kullanın', true)
  try {
    const res = await webview.executeJavaScript(valueJs(sel, $('#selMode').value, $('#selAttr').value.trim()), true)
    if (!res.ok) {
      state.lastValue = null
      $('#valueOut').textContent = '—'
      return toast(res.error || 'Eleman bulunamadı', true)
    }
    state.lastValue = res.value
    $('#valueOut').textContent = res.value.slice(0, 800) || '(boş değer)'
  } catch (e) {
    toast(err(e), true)
  }
}
$('#btnTestSel').addEventListener('click', testSelector)
$('#selInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') testSelector() })

/* ── Telegram ───────────────────────────────────────────────── */
function applyTgBadge(hasToken, botName) {
  const b = $('#tgBadge')
  if (botName) {
    b.textContent = 'Telegram: @' + botName + ' ✓'
    b.className = 'badge on'
  } else if (hasToken) {
    b.textContent = 'Telegram: token kayıtlı'
    b.className = 'badge on'
  } else {
    b.textContent = 'Telegram: token gerekli'
    b.className = 'badge off'
  }
}

$('#btnTgChats').addEventListener('click', async () => {
  const btn = $('#btnTgChats')
  btn.disabled = true
  try {
    state.tgChats = await window.api.tgChats()
    const dl = $('#tgChatOptions')
    dl.innerHTML = ''
    for (const c of state.tgChats) {
      const o = document.createElement('option')
      o.value = c.id
      o.label = `${c.name} (${c.type})`
      dl.appendChild(o)
    }
    if (state.tgChats.length) {
      toast(`${state.tgChats.length} sohbet bulundu — Chat ID alanına tıklayıp listeden seçin`)
      if (!$('#tgChatId').value && state.tgChats.length === 1) $('#tgChatId').value = state.tgChats[0].id
    } else {
      toast('Sohbet bulunamadı. Botu gruba ekleyip grupta bir mesaj yazın (ya da bota özelden mesaj atın), sonra tekrar deneyin.', true)
    }
  } catch (e) {
    toast(err(e), true)
  } finally {
    btn.disabled = false
  }
})

$('#btnSendNow').addEventListener('click', async () => {
  const chatId = $('#tgChatId').value.trim()
  if (!chatId) return toast('Telegram chat ID girin ("Sohbetleri Bul" yardımcı olur)', true)
  if (state.lastValue == null) return toast('Önce "Değeri Oku" ile değeri alın', true)
  const m = state.mails[state.currentMailIdx]
  const text = renderTemplate($('#msgTemplate').value, {
    value: state.lastValue,
    subject: m ? m.subject : '',
    url: webview.getURL(),
    name: $('#recipeName').value.trim(),
    date: new Date().toLocaleString('tr-TR'),
  })
  try {
    await window.api.tgSend(chatId, text)
    toast("Telegram'a gönderildi ✓")
  } catch (e) {
    toast(err(e), true)
  }
})

/* ── tarif kaydetme ─────────────────────────────────────────── */
$('#btnSaveRecipe').addEventListener('click', async () => {
  const name = $('#recipeName').value.trim()
  if (!name) return toast('Tarif adı girin', true)
  const f = collectFilter()
  if (!f.subject && !f.from && !f.body) return toast('Mail filtresi boş olamaz', true)
  if (!state.chain.length) return toast('En az bir bağlantı adımı gerekli (soldaki listeden açın)', true)
  const selector = $('#selInput').value.trim()
  if (!selector) return toast('CSS seçici girin ya da "Eleman Seç" kullanın', true)
  const chatId = $('#tgChatId').value.trim()
  if (!chatId) return toast('Telegram chat ID girin ("Sohbetleri Bul" yardımcı olur)', true)
  const known = state.tgChats.find((c) => c.id === chatId)

  const recipe = {
    name,
    filter: f,
    steps: state.chain.map((s) =>
      s.type === 'click'
        ? { type: 'click', index: s.index, selector: s.selector, text: s.text }
        : { type: 'link', index: s.index, href: s.href, pattern: s.pattern }
    ),
    selector,
    mode: $('#selMode').value,
    attr: $('#selAttr').value.trim(),
    tgChatId: chatId,
    tgChatName: known ? known.name : '',
    template: $('#msgTemplate').value,
    intervalMinutes: Math.max(1, Number($('#recipeInterval').value) || 10),
    enabled: $('#recipeEnabled').checked,
  }
  try {
    await window.api.recipeSave(recipe)
    toast(`Tarif kaydedildi: "${name}" ✓`)
  } catch (e) {
    toast(err(e), true)
  }
})

/* ── tarifler & loglar ──────────────────────────────────────── */
async function renderRecipes() {
  let list = []
  try { list = await window.api.recipesList() } catch { return }
  const tb = $('#recipeRows')
  tb.innerHTML = ''
  $('#recipeEmpty').classList.toggle('hidden', !!list.length)
  for (const r of list) {
    const tr = document.createElement('tr')

    const tdName = document.createElement('td')
    tdName.className = 'name'
    tdName.textContent = r.name

    const tdFilt = document.createElement('td')
    const filt = [
      r.filter.subject && `konu: "${r.filter.subject}"`,
      r.filter.from && `kimden: "${r.filter.from}"`,
      r.filter.body && `içerik: "${r.filter.body}"`,
    ].filter(Boolean).join(' • ')
    tdFilt.textContent = filt || 'tümü'

    const tdChain = document.createElement('td')
    tdChain.textContent = `${r.steps.length} adım`
    const selSub = document.createElement('span')
    selSub.className = 'sub mono'
    selSub.textContent = r.selector
    tdChain.appendChild(selSub)

    const tdGrp = document.createElement('td')
    tdGrp.textContent = r.tgChatName || r.tgChatId || '—'

    const tdInt = document.createElement('td')
    tdInt.textContent = `${r.intervalMinutes} dk`

    const tdSt = document.createElement('td')
    const parts = []
    if (r.runInfo.lastRunAt) parts.push('son gönderim: ' + new Date(r.runInfo.lastRunAt).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' }))
    if (r.runInfo.lastCheckAt) parts.push('son kontrol: ' + new Date(r.runInfo.lastCheckAt).toLocaleTimeString('tr-TR'))
    tdSt.textContent = parts.join(' • ') || '—'
    tdSt.className = 'sub'

    const tdActs = document.createElement('td')
    tdActs.className = 'acts'
    const enLbl = document.createElement('label')
    enLbl.className = 'inline check'
    const en = document.createElement('input')
    en.type = 'checkbox'
    en.checked = !!r.enabled
    en.addEventListener('change', async () => {
      try { await window.api.recipeToggle(r.id, en.checked) } catch (e) { toast(err(e), true) }
    })
    enLbl.append(en, document.createTextNode(' Aktif'))
    const run = document.createElement('button')
    run.textContent = '▶ Çalıştır'
    run.addEventListener('click', async () => {
      run.disabled = true
      run.textContent = '…'
      try {
        const res = await window.api.recipeRun(r.id)
        toast(res ? `Gönderildi ✓ Değer: ${res.value.slice(0, 60)}` : 'Filtreye uyan mail yok')
      } catch (e) {
        toast(err(e), true)
      } finally {
        run.disabled = false
        run.textContent = '▶ Çalıştır'
        renderRecipes()
      }
    })
    const del = document.createElement('button')
    del.className = 'danger'
    del.textContent = 'Sil'
    del.addEventListener('click', async () => {
      if (!confirm(`"${r.name}" tarifi silinsin mi?`)) return
      await window.api.recipeRemove(r.id)
      renderRecipes()
    })
    tdActs.append(enLbl, run, del)

    tr.append(tdName, tdFilt, tdChain, tdGrp, tdInt, tdSt, tdActs)
    tb.appendChild(tr)
  }
}

function appendLog(e) {
  const box = $('#logBox')
  const div = document.createElement('div')
  div.className = 'log ' + (e.level || 'info')
  div.textContent = `[${new Date(e.ts).toLocaleTimeString('tr-TR')}] ${e.text}`
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60
  box.appendChild(div)
  while (box.children.length > 500) box.removeChild(box.firstChild)
  if (nearBottom) box.scrollTop = box.scrollHeight
}

/* ── ayarlar ────────────────────────────────────────────────── */
async function loadSettings() {
  try {
    const s = await window.api.settingsGet()
    $('#setUser').value = s.gmailUser
    $('#setPass').placeholder = s.hasPass ? '•••• kayıtlı — değiştirmek için yenisini yazın' : 'abcd efgh ijkl mnop'
    $('#gmailSaved').textContent = s.hasPass && s.gmailUser
      ? `✔ Kayıtlı hesap: ${s.gmailUser} (uygulama şifresi kayıtlı)`
      : '✖ Henüz kayıtlı Gmail bilgisi yok — bilgileri girip Kaydet deyin.'
    $('#setTgToken').placeholder = s.hasTgToken ? '•••• kayıtlı — değiştirmek için yenisini yazın' : '123456789:AAF...'
    if (!$('#tgChatId').value && s.lastTgChatId) $('#tgChatId').value = s.lastTgChatId
    applyTgBadge(s.hasTgToken)
  } catch (e) {
    $('#setStatus').textContent = 'Ayarlar okunamadı: ' + err(e)
  }
}

$('#btnSaveSettings').addEventListener('click', async () => {
  try {
    await window.api.settingsSave({ gmailUser: $('#setUser').value, gmailPass: $('#setPass').value })
    $('#setPass').value = ''
    toast('Gmail ayarları kaydedildi ✓')
    loadSettings()
  } catch (e) {
    toast(err(e), true)
  }
})

$('#btnTestMail').addEventListener('click', async () => {
  const el = $('#setStatus')
  el.textContent = 'Bağlantı deneniyor…'
  try {
    // Forma yazılmış (henüz kaydedilmemiş) bilgilerle de test edilebilir
    await window.api.mailTest({ gmailUser: $('#setUser').value, gmailPass: $('#setPass').value })
    el.textContent = 'IMAP bağlantısı başarılı ✓ (unutmayın: kalıcı olması için Kaydet)'
  } catch (e) {
    el.textContent = 'Hata: ' + err(e)
  }
})

$('#btnSaveTg').addEventListener('click', async () => {
  try {
    await window.api.settingsSave({ tgToken: $('#setTgToken').value })
    $('#setTgToken').value = ''
    toast('Telegram token kaydedildi ✓')
    loadSettings()
  } catch (e) {
    toast(err(e), true)
  }
})

$('#btnTestTg').addEventListener('click', async () => {
  const el = $('#tgStatus')
  el.textContent = 'Doğrulanıyor…'
  try {
    const me = await window.api.tgTest()
    el.textContent = `Bot doğrulandı: @${me.username} ✓`
    applyTgBadge(true, me.username)
  } catch (e) {
    el.textContent = 'Hata: ' + err(e)
  }
})

/* ── ana olay akışı ─────────────────────────────────────────── */
window.api.onEvent((e) => {
  if (e.kind === 'log') {
    appendLog(e)
  } else if (e.kind === 'recipe-run' || e.kind === 'recipe-check') {
    if ($('#tab-recipes').classList.contains('active')) renderRecipes()
  }
})

/* ── başlangıç ──────────────────────────────────────────────── */
async function init() {
  createWebview()
  renderCrumbs()
  updatePickBtn()
  loadSettings()
  renderRecipes()
}
init()
