'use strict'
const { ImapFlow } = require('imapflow')
const { simpleParser } = require('mailparser')
const cheerio = require('cheerio')

const URL_RE = /https?:\/\/[^\s<>"')\]}]+/g

function extractLinks(parsed) {
  const links = []
  const seen = new Set()
  const push = (href, text) => {
    if (!href) return
    href = href.trim()
    if (!/^https?:\/\//i.test(href)) return
    if (seen.has(href)) return
    seen.add(href)
    links.push({
      href,
      text: (text || '').replace(/\s+/g, ' ').trim().slice(0, 160),
    })
  }
  if (parsed.html) {
    const $ = cheerio.load(parsed.html)
    $('a[href]').each((_, el) => push($(el).attr('href'), $(el).text()))
  }
  for (const m of (parsed.text || '').match(URL_RE) || []) push(m, '')
  return links
}

// Gmail'de IMAP araması yapar, eşleşen mailleri (en yenisi başta) bağlantılarıyla döndürür
async function searchMails({ user, pass, filter = {}, limit = 15 }) {
  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user, pass },
    logger: false,
  })
  await client.connect()
  const lock = await client.getMailboxLock('INBOX')
  try {
    const q = {}
    if (filter.subject) q.subject = filter.subject
    if (filter.from) q.from = filter.from
    if (filter.body) q.body = filter.body
    if (filter.unseenOnly) q.seen = false
    q.since = new Date(Date.now() - (Number(filter.sinceDays) || 7) * 864e5)

    let uids = await client.search(q, { uid: true })
    if (!uids || !uids.length) return []
    uids = uids.slice(-limit).reverse() // en yeni başta

    const mails = []
    for (const uid of uids) {
      const msg = await client.fetchOne(uid, { source: true }, { uid: true })
      if (!msg || !msg.source) continue
      const parsed = await simpleParser(msg.source)
      mails.push({
        uid,
        subject: parsed.subject || '(konu yok)',
        from: parsed.from ? parsed.from.text : '',
        date: parsed.date ? parsed.date.toISOString() : null,
        links: extractLinks(parsed),
      })
    }
    return mails
  } finally {
    lock.release()
    await client.logout().catch(() => {})
  }
}

module.exports = { searchMails }
