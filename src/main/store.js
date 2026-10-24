'use strict'
const fs = require('fs')
const path = require('path')

class JsonStore {
  constructor(file, fallback) {
    this.file = file
    this.fallback = fallback
    this.data = this.load()
  }

  load() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'))
    } catch {
      return structuredClone(this.fallback)
    }
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      const tmp = this.file + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8')
      fs.renameSync(tmp, this.file)
    } catch (e) {
      throw new Error(`Ayar dosyası yazılamadı (${this.file}): ${e.code || ''} ${e.message}`)
    }
  }
}

module.exports = { JsonStore }
