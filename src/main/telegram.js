'use strict'
// Telegram Bot API (resmî): sendMessage / getMe / getUpdates
const API = 'https://api.telegram.org'
const CHUNK = 4000 // Telegram mesaj sınırı 4096; pay bırakıyoruz
const MAX_CHUNKS = 5

async function call(token, method, params) {
  if (!token) throw new Error('Telegram bot token kayıtlı değil. Ayarlar sekmesinden girin.')
  let res
  try {
    res = await fetch(`${API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params || {}),
      signal: AbortSignal.timeout(20000),
    })
  } catch (e) {
    throw new Error('Telegram API erişilemedi: ' + (e && e.message ? e.message : e))
  }
  const data = await res.json().catch(() => null)
  if (!data || !data.ok) {
    throw new Error('Telegram: ' + (data && data.description ? data.description : `HTTP ${res.status}`))
  }
  return data.result
}

async function getMe(token) {
  const me = await call(token, 'getMe')
  return { id: me.id, username: me.username, name: me.first_name }
}

function chatLabel(c) {
  return c.title || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username || String(c.id)
}

// Botun son gördüğü güncellemelerden sohbet/grupları çıkarır (chat ID bulma yardımcısı)
async function listChats(token) {
  const updates = await call(token, 'getUpdates', { limit: 100, timeout: 0 })
  const map = new Map()
  for (const u of updates || []) {
    const src = u.message || u.edited_message || u.channel_post || u.my_chat_member
    const chat = src && src.chat
    if (chat) map.set(chat.id, { id: String(chat.id), name: chatLabel(chat), type: chat.type })
  }
  return [...map.values()]
}

async function sendText(token, chatId, text) {
  const full = String(text == null ? '' : text)
  const chunks = []
  for (let i = 0; i < full.length && chunks.length < MAX_CHUNKS; i += CHUNK) {
    chunks.push(full.slice(i, i + CHUNK))
  }
  if (!chunks.length) chunks.push('(boş mesaj)')
  if (full.length > CHUNK * MAX_CHUNKS) {
    chunks[chunks.length - 1] += '\n… (mesaj çok uzundu, kırpıldı)'
  }
  for (const c of chunks) {
    await call(token, 'sendMessage', { chat_id: chatId, text: c, disable_web_page_preview: true })
  }
  return true
}

module.exports = { getMe, listChats, sendText }
