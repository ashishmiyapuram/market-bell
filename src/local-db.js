import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export function openDatabase(path = ':memory:') {
  const sqlite = new DatabaseSync(path);
  if (!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name = 'runs'").get()) {
    try {
      sqlite.exec('BEGIN');
      sqlite.exec(readFileSync(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8'));
      sqlite.exec('COMMIT');
    } catch (error) {
      sqlite.exec('ROLLBACK');
      sqlite.close();
      throw error;
    }
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
