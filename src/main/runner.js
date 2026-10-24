'use strict'
// Tarif çalıştırma: mail ara -> bağlantı/buton zincirini izle -> değeri oku -> Telegram'a gönder.
// Zamanlayıcı: her tarif için ayrı setInterval; yeni mailler UID üzerinden takip edilir.
const mail = require('./mail')
const scraper = require('./scraper')
const telegram = require('./telegram')

const timers = new Map()
const running = new Set()

// Bağlantı eşleştirme: birebir URL -> desen (içerir) -> kayıtlı sıra numarası
function pickLink(links, step, depth) {
  if (!links || !links.length) throw new Error(`Adım ${depth + 1}: sayfada hiç bağlantı bulunamadı`)
  if (step.href) {
    const f = links.find((l) => l.href === step.href)
    if (f) return f
  }
  if (step.pattern) {
    const p = String(step.pattern).toLowerCase()
    const f = links.find(
      (l) => l.href.toLowerCase().includes(p) || (l.text || '').toLowerCase().includes(p)
    )
    if (f) return f
  }
  if (Number.isInteger(step.index) && step.index >= 0 && step.index < links.length) {
    return links[step.index]
  }
  throw new Error(`Adım ${depth + 1}: bağlantı eşleşmedi (desen: "${step.pattern || '-'}", sıra: ${step.index})`)
}

function renderTemplate(tpl, ctx) {
  const t = tpl && tpl.trim() ? tpl : '{value}'
  return t.replace(/\{(value|subject|url|name|date)\}/g, (_, k) =>
    ctx[k] == null ? '' : String(ctx[k])
  )
}

async function runOnMail(recipe, m, token, log) {
  if (!recipe.tgChatId) {
    throw new Error("Tarifte Telegram chat ID yok; tarifi Sihirbaz'dan yeniden kaydedin")
  }
  const steps = recipe.steps || []
  if (!steps.length) throw new Error('Tarifte hiç adım yok')
  if ((steps[0].type || 'link') !== 'link') {
    throw new Error('İlk adım mail içindeki bir bağlantı olmalı (mailde buton olmaz)')
  }
  log(`Mail işleniyor: "${m.subject}"`)
  const session = scraper.openSession()
  try {
    let coll = { links: m.links, buttons: [] }
    for (let d = 0; d < steps.length; d++) {
      const step = steps[d]
      const type = step.type || 'link' // eski tarifler için varsayılan
      if (type === 'click') {
        log(`Adım ${d + 1}: buton "${String(step.text || step.selector || '').slice(0, 60)}"`)
        await session.click(step)
      } else {
        const chosen = pickLink(coll.links, step, d)
        log(`Adım ${d + 1}: ${chosen.href}`)
        await session.goto(chosen.href)
      }
      if (d < steps.length - 1) {
        coll = await session.collect()
        log(`Sayfa hazır (${coll.title || 'başlıksız'}): ${coll.links.length} bağlantı, ${coll.buttons.length} buton`)
      }
    }
    const res = await session.value(recipe.selector, recipe.mode, recipe.attr)
    if (!res.ok) throw new Error(`Seçici başarısız: ${res.error || recipe.selector}`)
    const value = (res.value || '').trim()
    log(`Değer okundu: ${value.slice(0, 200) || '(boş)'}`)
    const message = renderTemplate(recipe.template, {
      value,
      subject: m.subject,
      url: session.url(),
      name: recipe.name,
      date: new Date().toLocaleString('tr-TR'),
    })
    await telegram.sendText(token, recipe.tgChatId, message)
    log(`Telegram'a gönderildi → ${recipe.tgChatName || recipe.tgChatId}`)
    return { value, message, uid: m.uid }
  } finally {
    session.close()
  }
}

// "Çalıştır" butonu: filtreye uyan EN YENİ maili işler
async function runRecipeManual(recipe, creds, token, log) {
  log('Mailler aranıyor…')
  const mails = await mail.searchMails({ ...creds, filter: recipe.filter, limit: 3 })
  if (!mails.length) {
    log('Filtreye uyan mail bulunamadı', 'warn')
    return null
  }
  return runOnMail(recipe, mails[0], token, log)
}

// Zamanlanmış kontrol: yalnızca son kontrolden sonra gelen YENİ mailleri işler
async function tick(id, deps) {
  if (running.has(id)) return
  const recipe = deps.getRecipe(id)
  if (!recipe || !recipe.enabled) {
    clearSchedule(id)
    return
  }
  running.add(id)
  const log = (t, lv) => deps.log(`[${recipe.name}] ${t}`, lv)
  try {
    const creds = deps.getCreds()
    const mails = await mail.searchMails({ ...creds, filter: recipe.filter, limit: 10 })
    const st = deps.stateStore.data[recipe.id] || (deps.stateStore.data[recipe.id] = {})
    if (mails.length) {
      const maxUid = Math.max(...mails.map((m) => m.uid))
      if (!st.lastUid) {
        st.lastUid = maxUid
        log(`Başlangıç noktası alındı (UID ${maxUid}); bundan sonra gelen yeni mailler otomatik işlenecek`)
      } else {
        const fresh = mails.filter((m) => m.uid > st.lastUid).sort((a, b) => a.uid - b.uid)
        for (const m of fresh) {
          try {
            await runOnMail(recipe, m, deps.getTgToken(), log)
            st.lastRunAt = Date.now()
            deps.broadcast({ kind: 'recipe-run', id: recipe.id })
          } catch (e) {
            log('Hata: ' + e.message, 'error')
          }
          st.lastUid = Math.max(st.lastUid || 0, m.uid)
          deps.stateStore.save()
        }
      }
    }
    st.lastCheckAt = Date.now()
    deps.stateStore.save()
    deps.broadcast({ kind: 'recipe-check', id: recipe.id, at: st.lastCheckAt })
  } catch (e) {
    log('Kontrol hatası: ' + e.message, 'error')
  } finally {
    running.delete(id)
  }
}

function schedule(recipe, deps) {
  clearSchedule(recipe.id)
  if (!recipe.enabled) return
  const mins = Math.max(1, Number(recipe.intervalMinutes) || 10)
  // İlk kontrol 5 sn sonra (başlangıç UID'i hemen alınsın), sonrası aralıklı
  const first = setTimeout(() => tick(recipe.id, deps), 5000)
  const t = setInterval(() => tick(recipe.id, deps), mins * 60000)
  timers.set(recipe.id, { t, first })
}

function clearSchedule(id) {
  const h = timers.get(id)
  if (h) {
    clearInterval(h.t)
    clearTimeout(h.first)
    timers.delete(id)
  }
}

function clearAll() {
  for (const id of [...timers.keys()]) clearSchedule(id)
}

module.exports = { schedule, clearSchedule, clearAll, runRecipeManual }
