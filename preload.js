'use strict'
const { contextBridge, ipcRenderer } = require('electron')

const paths = ipcRenderer.sendSync('app:paths')

contextBridge.exposeInMainWorld('api', {
  webviewPreload: paths.webviewPreload,

  settingsGet: () => ipcRenderer.invoke('settings:get'),
  settingsSave: (s) => ipcRenderer.invoke('settings:save', s),

  mailTest: (override) => ipcRenderer.invoke('mail:test', override),
  mailSearch: (filter) => ipcRenderer.invoke('mail:search', filter),

  tgTest: () => ipcRenderer.invoke('tg:test'),
  tgChats: () => ipcRenderer.invoke('tg:chats'),
  tgSend: (chatId, text) => ipcRenderer.invoke('tg:send', { chatId, text }),

  recipesList: () => ipcRenderer.invoke('recipes:list'),
  recipeSave: (r) => ipcRenderer.invoke('recipes:save', r),
  recipeRemove: (id) => ipcRenderer.invoke('recipes:remove', id),
  recipeRun: (id) => ipcRenderer.invoke('recipes:run', id),
  recipeToggle: (id, enabled) => ipcRenderer.invoke('recipes:toggle', { id, enabled }),

  onEvent: (cb) => ipcRenderer.on('app:event', (_e, data) => cb(data)),
})
