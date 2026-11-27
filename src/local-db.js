import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';

export function openDatabase(path = ':memory:') {
  const sqlite = new DatabaseSync(path);
  const migrations = new URL('../migrations/', import.meta.url);
  const exists = name => Boolean(sqlite.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?").get(name));
  try {
    sqlite.exec('BEGIN IMMEDIATE');
    const legacy = exists('runs') && !exists('d1_migrations');
    sqlite.exec(`CREATE TABLE IF NOT EXISTS d1_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`);
    const record = sqlite.prepare('INSERT INTO d1_migrations (name) VALUES (?)');
    const applied = sqlite.prepare('SELECT name FROM d1_migrations WHERE name = ?');
    if (legacy) record.run('0001_initial.sql');
    for (const file of readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) {
      if (applied.get(file)) continue;
      sqlite.exec(readFileSync(new URL(file, migrations), 'utf8'));
      record.run(file);
    }
    sqlite.exec('COMMIT');
  } catch (error) {
    sqlite.exec('ROLLBACK');
    sqlite.close();
    throw error;
  }

  return {
    close: () => sqlite.close(),
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      const bind = (...params) => ({
        first: async () => statement.get(...params) ?? null,
        all: async () => ({ results: statement.all(...params) }),
        run: async () => statement.run(...params),
        execute: () => statement.run(...params)
      });
      return { ...bind(), bind };
    },
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map(statement => statement.execute());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    }
  };
}
