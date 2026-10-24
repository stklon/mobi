import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { runMigrations } from './migrations'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!db) throw new Error('数据库尚未初始化')
  return db
}

export function initDb(): Database.Database {
  if (db) return db

  const dataDir = path.join(app.getPath('userData'), 'data')
  mkdirSync(dataDir, { recursive: true })
  const dbPath = path.join(dataDir, 'library.db')

  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  console.log(`[db] ready at ${dbPath}`)
  return db
}

export function closeDb(): void {
  db?.close()
  db = null
}
