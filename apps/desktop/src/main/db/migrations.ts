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
  },
  {
    version: 3,
    name: 'ai-templates-logs-snapshots',
    sql: `
      CREATE TABLE prompt_templates (
        code TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        content TEXT NOT NULL,
        variables TEXT NOT NULL DEFAULT '[]',
        is_builtin INTEGER NOT NULL DEFAULT 1,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE ai_logs (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL,
        scene TEXT NOT NULL,
        template_code TEXT,
        provider_id TEXT,
        model TEXT,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        latency_ms INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        error TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE snapshots (
        id TEXT PRIMARY KEY,
        chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_snapshots_chapter ON snapshots(chapter_id, created_at);
    `
  },
  {
    version: 4,
    name: 'codex-and-outline',
    sql: `
      CREATE TABLE codex_entries (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        aliases TEXT NOT NULL DEFAULT '[]',
        content TEXT NOT NULL DEFAULT '',
        importance TEXT NOT NULL DEFAULT 'retrieval',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX idx_codex_project ON codex_entries(project_id, type);

      CREATE TABLE outline_nodes (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        volume_id TEXT,
        chapter_no INTEGER,
        level TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        goal TEXT NOT NULL DEFAULT '',
        plot_points TEXT NOT NULL DEFAULT '[]',
        characters TEXT NOT NULL DEFAULT '[]',
        ending_hook TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'confirmed',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX idx_outline_project ON outline_nodes(project_id, level);
      CREATE INDEX idx_outline_chapter ON outline_nodes(project_id, chapter_no);
      CREATE UNIQUE INDEX idx_outline_volume ON outline_nodes(volume_id) WHERE level = 'volume';
    `
  },
  {
    version: 5,
    name: 'summaries-and-rag-chunks',
    sql: `
      CREATE TABLE summaries (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        chapter_no INTEGER NOT NULL,
        level TEXT NOT NULL DEFAULT 'chapter',
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(project_id, chapter_no, level)
      );
      CREATE INDEX idx_summaries_project ON summaries(project_id, chapter_no);

      CREATE TABLE chunks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        chapter_no INTEGER,
        text TEXT NOT NULL,
        entities TEXT NOT NULL DEFAULT '[]',
        embedding BLOB,
        embedding_model TEXT,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX idx_chunks_project ON chunks(project_id, source_type);
      CREATE INDEX idx_chunks_chapter ON chunks(project_id, chapter_no);
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
