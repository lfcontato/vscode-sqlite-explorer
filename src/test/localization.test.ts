import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { messages, errorMessage, resolveLanguage } from '../localization';
import { AppError } from '../domain/errors';

test('language selection respects the override and editor locale', () => {
  assert.equal(resolveLanguage('auto', 'pt-BR'), 'pt');
  assert.equal(resolveLanguage('auto', 'pt-PT'), 'pt');
  assert.equal(resolveLanguage('auto', 'en-US'), 'en');
  assert.equal(resolveLanguage('en', 'pt-BR'), 'en');
  assert.equal(resolveLanguage('pt', 'en'), 'pt');
  assert.equal(resolveLanguage('auto', 'de'), 'en');
  assert.deepEqual(Object.keys(messages('en')).sort(), Object.keys(messages('pt')).sort());
  assert.equal(errorMessage(new AppError('readOnlyQuery'), 'en'), 'Read-only mode: use SELECT, WITH or EXPLAIN.');
  assert.match(errorMessage(new AppError('readOnlyQuery'), 'pt'), /somente leitura/);
  assert.equal(errorMessage(new Error('SQLITE_ERROR: syntax error'), 'pt'), 'SQLITE_ERROR: syntax error');
});

test('manifest localization and database menus are complete', async () => {
  const root = path.resolve(__dirname, '../..');
  const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const dictionaries = await Promise.all(['package.nls.json', 'package.nls.pt.json', 'package.nls.pt-br.json'].map(async name => JSON.parse(await readFile(path.join(root, name), 'utf8')) as Record<string, string>));
  const keys = [...JSON.stringify(manifest).matchAll(/%([a-zA-Z.]+)%/g)].map(match => match[1]!);
  for (const dictionary of dictionaries) { for (const key of keys) { assert.ok(dictionary[key], `Missing manifest translation: ${key}`); } }
  assert.ok(manifest.contributes.views.explorer.some((view: { id: string }) => view.id === 'sqliteExplorer.files'));
  assert.ok(manifest.contributes.menus['view/item/context'].some((item: { command: string; when: string }) => item.command === 'sqliteExplorer.query' && item.when.includes('viewItem == database')));
});
