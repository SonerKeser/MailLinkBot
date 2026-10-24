'use strict'
const { app, BrowserWindow, ipcMain, safeStorage, session, Menu } = require('electron')
const path = require('path')
const { pathToFileURL } = require('url')
const { JsonStore } = require('./src/main/store')
const mail = require('./src/main/mail')
const telegram = require('./src/main/telegram')
const runner = require('./src/main/runner')

const SMOKE = process.argv.includes('--smoke')
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const WEBVIEW_PRELOAD = path.join(__dirname, 'webview-preload.js')

let win = null
let settings, recipes, runState

// İkinci kopya açılmasın: app.quit() yarış durumuna girebildiği için anında çıkıyoruz
if (!SMOKE && !app.requestSingleInstanceLock()) {
  app.exit(0)
}

function broadcast(data) {
  if (win && !win.isDestroyed()) win.webContents.send('app:event', data)
}
function log(text, level = 'info') {
  broadcast({ kind: 'log', text, level, ts: Date.now() })
}

function decrypt(encB64) {
  return safeStorage.decryptString(Buffer.from(encB64, 'base64'))
}

function getCreds() {
  const s = settings.data
  if (!s.gmailUser || !(s.gmailPassEnc || s.gmailPassPlain)) {
    throw new Error('Gmail bilgileri kayıtlı değil. Ayarlar sekmesinden adres ve uygulama şifresini girin.')
  }
  let pass
  try {
    pass = s.gmailPassPlain ? s.gmailPassPlain : decrypt(s.gmailPassEnc)
  } catch {
    throw new Error('Kayıtlı Gmail şifresi çözülemedi; Ayarlar sekmesinden şifreyi yeniden girin.')
  }
  return { user: s.gmailUser, pass }
}

function getTgToken() {
  const s = settings.data
  if (!(s.tgTokenEnc || s.tgTokenPlain)) {
    throw new Error('Telegram bot token kayıtlı değil. Ayarlar sekmesinden girin.')
  }
  try {
    return s.tgTokenPlain ? s.tgTokenPlain : decrypt(s.tgTokenEnc)
  } catch {
    throw new Error('Kayıtlı Telegram token çözülemedi; Ayarlar sekmesinden yeniden girin.')
  }
}

// safeStorage varsa şifreli, yoksa düz saklar
function storeSecret(value, encKey, plainKey) {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      settings.data[encKey] = safeStorage.encryptString(value).toString('base64')
      delete settings.data[plainKey]
      return
    }
  } catch (e) {
    log('Şifreleme kullanılamadı, bilgi düz metin saklanacak: ' + e.message, 'warn')
  }
  settings.data[plainKey] = value
  delete settings.data[encKey]
}

const deps = {
  getCreds,
  getTgToken,
  getRecipe: (id) => recipes.data.find((r) => r.id === id),
  stateStore: null,
  log,
  broadcast,
}

function rescheduleAll() {
  runner.clearAll()
  for (const r of recipes.data) runner.schedule(r, deps)
}

function createWindow() {
  win = new BrowserWindow({
    width: 1420,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    show: !SMOKE,
    autoHideMenuBar: true,
    backgroundColor: '#101418',
    title: 'Mail Link Bot',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      spellcheck: false,
    },
  })

  // Webview'lere her zaman bizim güvenli preload'umuz ve izole ayarlar dayatılır
  win.webContents.on('will-attach-webview', (_e, webPreferences, params) => {
    webPreferences.preload = WEBVIEW_PRELOAD
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
    delete params.preload
    delete params.preloadURL
  })

  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools()
  })

  win.on('closed', () => { win = null })
  win.loadFile('renderer/index.html')
}

app.on('web-contents-created', (_e, contents) => {
  if (contents.getType() === 'webview') {
    // Popup açmak yerine aynı görünümde yükle
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) contents.loadURL(url)
      return { action: 'deny' }
    })
    contents.on('will-navigate', (e, url) => {
      if (!/^https?:|^about:blank/i.test(url)) e.preventDefault()
    })
  } else {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  }
})

function registerIpc() {
  ipcMain.on('app:paths', (e) => {
    e.returnValue = { webviewPreload: pathToFileURL(WEBVIEW_PRELOAD).href }
  })

  ipcMain.handle('settings:get', () => ({
    gmailUser: settings.data.gmailUser || '',
    hasPass: !!(settings.data.gmailPassEnc || settings.data.gmailPassPlain),
    hasTgToken: !!(settings.data.tgTokenEnc || settings.data.tgTokenPlain),
    lastTgChatId: settings.data.lastTgChatId || '',
  }))

  ipcMain.handle('settings:save', (_e, patch) => {
    if ('gmailUser' in patch) settings.data.gmailUser = (patch.gmailUser || '').trim()
    if (patch.gmailPass && patch.gmailPass.trim()) {
      // Google şifreyi boşluklu gösterir
      storeSecret(patch.gmailPass.replace(/\s+/g, ''), 'gmailPassEnc', 'gmailPassPlain')
    }
    if (patch.tgToken && patch.tgToken.trim()) {
      storeSecret(patch.tgToken.trim(), 'tgTokenEnc', 'tgTokenPlain')
    }
    settings.save()
    return true
  })

  // Test, forma yazılmış ama henüz kaydedilmemiş bilgilerle de çalışır
  ipcMain.handle('mail:test', async (_e, override) => {
    let creds
    const typedUser = override && (override.gmailUser || '').trim()
    const typedPass = override && (override.gmailPass || '').trim()
    if (typedUser && typedPass) {
      creds = { user: typedUser, pass: typedPass.replace(/\s+/g, '') }
    } else if (typedUser) {
      try {
        creds = { user: typedUser, pass: getCreds().pass }
      } catch {
        throw new Error('Şifre alanı boş. İlk kez giriyorsanız uygulama şifresini de yazın.')
      }
    } else {
      creds = getCreds()
    }
    const r = await mail.searchMails({ ...creds, filter: { sinceDays: 1 }, limit: 1 })
    return { ok: true, count: r.length }
  })

  ipcMain.handle('mail:search', async (_e, filter) => {
    return mail.searchMails({ ...getCreds(), filter, limit: 15 })
  })

  ipcMain.handle('tg:test', () => telegram.getMe(getTgToken()))
  ipcMain.handle('tg:chats', () => telegram.listChats(getTgToken()))
  ipcMain.handle('tg:send', async (_e, { chatId, text }) => {
    await telegram.sendText(getTgToken(), chatId, text)
    settings.data.lastTgChatId = String(chatId)
    settings.save()
    return true
  })

  ipcMain.handle('recipes:list', () =>
    recipes.data.map((r) => ({ ...r, runInfo: runState.data[r.id] || {} }))
  )

  ipcMain.handle('recipes:save', (_e, r) => {
    if (!r.id) r.id = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    const i = recipes.data.findIndex((x) => x.id === r.id)
    if (i >= 0) recipes.data[i] = r
    else recipes.data.push(r)
    recipes.save()
    runner.schedule(r, deps)
    log(`Tarif kaydedildi: "${r.name}"` + (r.enabled ? ` — her ${r.intervalMinutes} dk yeni mail kontrol edilecek` : ' (otomatik çalıştırma kapalı)'))
    return r.id
  })

  ipcMain.handle('recipes:remove', (_e, id) => {
    recipes.data = recipes.data.filter((x) => x.id !== id)
    recipes.save()
    runner.clearSchedule(id)
    delete runState.data[id]
    runState.save()
    return true
  })

  ipcMain.handle('recipes:toggle', (_e, { id, enabled }) => {
    const r = recipes.data.find((x) => x.id === id)
    if (!r) throw new Error('Tarif bulunamadı')
    r.enabled = !!enabled
    recipes.save()
    runner.schedule(r, deps)
    return true
  })

  ipcMain.handle('recipes:run', async (_e, id) => {
    const r = recipes.data.find((x) => x.id === id)
    if (!r) throw new Error('Tarif bulunamadı')
    const plog = (t, lv) => log(`[${r.name}] ${t}`, lv)
    try {
      const res = await runner.runRecipeManual(r, getCreds(), getTgToken(), plog)
      const st = runState.data[r.id] || (runState.data[r.id] = {})
      if (res) {
        st.lastRunAt = Date.now()
        st.lastUid = Math.max(st.lastUid || 0, res.uid || 0)
      }
      runState.save()
      broadcast({ kind: 'recipe-run', id: r.id })
      return res
    } catch (e) {
      plog('Hata: ' + e.message, 'error')
      throw e
    }
  })
}

function setupSmoke() {
  let rendererErrors = 0
  win.webContents.on('console-message', (...args) => {
    let level, message
    if (args.length === 1 && typeof args[0] === 'object' && args[0] && 'level' in args[0]) {
      level = args[0].level
      message = args[0].message
    } else {
      level = args[1]
      message = args[2]
    }
    if (level === 3 || level === 'error') {
      rendererErrors++
      console.error('RENDERER_ERROR:', message)
    }
  })
  win.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      console.log(rendererErrors ? 'SMOKE_FAIL' : 'SMOKE_OK')
      app.exit(rendererErrors ? 1 : 0)
    }, 1500)
  })
  win.webContents.once('did-fail-load', (_e, code, desc) => {
    console.error('SMOKE_FAIL load:', code, desc)
    app.exit(1)
  })
}

app.whenReady().then(() => {
  const dataDir = app.getPath('userData')
  settings = new JsonStore(path.join(dataDir, 'settings.json'), {})
  recipes = new JsonStore(path.join(dataDir, 'recipes.json'), [])
  runState = new JsonStore(path.join(dataDir, 'state.json'), {})
  deps.stateStore = runState

  session.defaultSession.setUserAgent(UA)
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
  session.defaultSession.on('will-download', (e) => e.preventDefault())
  Menu.setApplicationMenu(null)

  registerIpc()
  createWindow()

  if (SMOKE) setupSmoke()
  else rescheduleAll()
})

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.on('window-all-closed', () => app.quit())
