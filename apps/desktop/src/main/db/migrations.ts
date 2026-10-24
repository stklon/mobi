import type { Database } from 'better-sqlite3'

interface Migration {
  version: number
  name: string
  sql: string
}

/**
 * 顺序迁移：每个版本只执行一次（PRAGMA user_version 记录当前版本）。
 * 新增迁移只能追加，不得修改历史迁移。
 */
const migrations: Migration[] = [
  {
    version: 1,
    name: 'init-projects-volumes-chapters',
    sql: `
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        genre TEXT NOT NULL DEFAULT '',
        target_words INTEGER NOT NULL DEFAULT 0,
        style_guide TEXT NOT NULL DEFAULT '',
        pov TEXT NOT NULL DEFAULT '第三人称单视角',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE volumes (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        no INTEGER NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX idx_volumes_project ON volumes(project_id, no);

      CREATE TABLE chapters (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        volume_id TEXT NOT NULL REFERENCES volumes(id) ON DELETE CASCADE,
        no INTEGER NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        word_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'draft',
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX idx_chapters_project ON chapters(project_id, no);
      CREATE INDEX idx_chapters_volume ON chapters(volume_id);
    `
  },
  {
    version: 2,
    name: 'settings-kv',
    sql: `
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `
  }
]

export function runMigrations(db: Database): void {
  const current = db.pragma('user_version', { simple: true }) as number

  for (const m of migrations) {
    if (m.version <= current) continue
    const apply = db.transaction(() => {
      db.exec(m.sql)
      db.pragma(`user_version = ${m.version}`)
    })
    apply()
    console.log(`[db] 迁移 v${m.version}（${m.name}）已应用`)
  }
}
