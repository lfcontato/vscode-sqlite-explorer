import { AppError } from './domain/errors';
export type Language = 'en' | 'pt';
const en = {
  editRow: 'Edit row', rowDetails: 'Row details', rowPosition: '{table} · Row {row}', protectedField: 'Protected field · read only', rowModalHint: 'Apply stages all changed fields as one undoable edit. Save changes in the table to write to the database.',
  saveAsUnavailable: 'Save As is not supported for databases. Use CSV/JSON export or the automatic SQLite backup.',
  editing: 'Table editing', editHint: 'Double-click a row to open its fields · changes are written only when saved', save: 'Save changes', undo: 'Undo', redo: 'Redo', discard: 'Discard changes', apply: 'Apply', cancel: 'Cancel', cellText: 'Text', cellNumber: 'Number', cellNull: 'NULL', editCell: 'Edit {column}', pendingCount: '{count} pending cell change(s)', savedChanges: 'Changes saved. Backup: {path}',
  invalidEdit: 'This cell or value cannot be edited. Use a real table with a non-null primary key. Key, BLOB, generated and unsafe-number cells are protected.', editingUnavailable: 'Editing is unavailable for this result.', editConflict: 'The row or schema changed outside this editor. Nothing was saved. Keep your draft, or discard it and reload.', pendingEdits: 'Save or discard pending changes before navigating.', discardPrompt: 'Discard all pending cell changes?',
  readOnly: 'Read only', tables: 'Tables', views: 'Views', indexes: 'Indexes', viewTable: 'View table',
  heading: 'Explore your database.', tableOrView: 'Table or view', filter: 'Filter data', search: 'Search all columns…', applyFilter: 'Apply filter', refresh: 'Refresh',
  browseHint: '100 rows per page · Click a column header to sort', sqlQuery: 'SQL query', runQuery: 'Run query', queryHint: 'Ctrl/Cmd + Enter · up to 1,000 rows · 10-second limit',
  exportCsv: 'Export CSV', exportJson: 'Export JSON', opening: 'Opening database…', emptyStart: 'Select a table or run a query.', previous: '← Previous', next: 'Next →',
  page: 'Page {page}', exporting: 'Exporting…', loading: 'Loading…', noRows: 'No rows found.', sortBy: 'Sort by {column}', emptyDatabase: 'No tables or views. You can run a SELECT query.',
  rowCount: '{count} row(s) displayed', moreRows: 'More rows on the next page', limited: 'Result limited; refine your query', exportHint: 'Export includes only these rows.', queryResult: 'Query result', exportFinished: 'Export completed or canceled.', exported: 'Visible result exported.',
  queryPlaceholder: 'SELECT a.id, b.name\nFROM your_table AS a\nJOIN other_table AS b ON b.id = a.other_id\nLIMIT 100;', queryReady: 'Write a SQL query for this database. JOINs, CTEs and subqueries are supported.',
  invalidIdentifier: 'Invalid identifier.', queryTooLong: 'The query exceeds 100,000 characters.', unclosedComment: 'Unterminated SQL comment.', singleStatement: 'Run only one statement at a time.', unclosedText: 'Unterminated SQL string or identifier.',
  readOnlyQuery: 'Read-only mode: use SELECT, WITH or EXPLAIN.', invalidLimit: 'Invalid limit.', connectionClosed: 'Connection closed.', resultTooLarge: 'Result exceeds 8 MiB. Select fewer columns or use filters.', unexpectedRead: 'Unexpected read state.',
  schemaTooLarge: 'Browsing more than 1,000 schema objects is not supported.', columnsTooLarge: 'Tables with more than 1,000 columns are not supported.', invalidPage: 'Invalid page.', tableMissing: 'Table or view not found.', invalidSort: 'Invalid sort column.', invalidMessage: 'Invalid message or parameters.',
  noResult: 'Run a query before exporting.', invalidExport: 'Save to a .csv or .json file matching the selected format.', overwriteDatabase: 'The export cannot overwrite the open database.', untrustedWorkspace: 'Open the database in a trusted workspace.', unsupportedFile: 'Only filesystem databases on the extension host are supported.',
  allFiles: 'All files', restoreFailed: 'Some saved databases could not be reopened. Check their paths and permissions.', languageReload: 'Reload the window to apply the SQLite Explorer language to existing views.', reload: 'Reload window'
};
export type Messages = Record<keyof typeof en, string>;
const pt: Messages = {
  editRow: 'Editar registro', rowDetails: 'Detalhes do registro', rowPosition: '{table} · Registro {row}', protectedField: 'Campo protegido · somente leitura', rowModalHint: 'Aplicar mantém os campos alterados como uma única edição que pode ser desfeita. Use Salvar alterações na tabela para gravar no banco.',
  saveAsUnavailable: 'Salvar como não é suportado para bancos. Use exportação CSV/JSON ou o backup automático SQLite.',
  editing: 'Edição de tabela', editHint: 'Clique duas vezes em uma linha para abrir os campos · as alterações só são gravadas ao salvar', save: 'Salvar alterações', undo: 'Desfazer', redo: 'Refazer', discard: 'Descartar alterações', apply: 'Aplicar', cancel: 'Cancelar', cellText: 'Texto', cellNumber: 'Número', cellNull: 'NULL', editCell: 'Editar {column}', pendingCount: '{count} alteração(ões) de célula pendente(s)', savedChanges: 'Alterações salvas. Backup: {path}',
  invalidEdit: 'Esta célula ou valor não pode ser editado. Use uma tabela real com chave primária não nula. Chaves, BLOBs, colunas geradas e números sem precisão segura são protegidos.', editingUnavailable: 'A edição não está disponível para este resultado.', editConflict: 'O registro ou o schema mudou fora deste editor. Nada foi salvo. Mantenha o rascunho ou descarte e atualize os dados.', pendingEdits: 'Salve ou descarte as alterações pendentes antes de navegar.', discardPrompt: 'Descartar todas as alterações de células pendentes?',
  readOnly: 'Somente leitura', tables: 'Tabelas', views: 'Views', indexes: 'Índices', viewTable: 'Visualizar tabela',
  heading: 'Seu banco, por dentro.', tableOrView: 'Tabela ou view', filter: 'Filtrar dados', search: 'Buscar nas colunas…', applyFilter: 'Aplicar filtro', refresh: 'Atualizar',
  browseHint: '100 registros por página · Clique no título de uma coluna para ordenar', sqlQuery: 'Consulta SQL', runQuery: 'Executar consulta', queryHint: 'Ctrl/Cmd + Enter · até 1.000 registros · limite de 10 segundos',
  exportCsv: 'Exportar CSV', exportJson: 'Exportar JSON', opening: 'Abrindo banco…', emptyStart: 'Selecione uma tabela ou execute uma consulta.', previous: '← Anterior', next: 'Próxima →',
  page: 'Página {page}', exporting: 'Exportando…', loading: 'Carregando…', noRows: 'Nenhum registro encontrado.', sortBy: 'Ordenar por {column}', emptyDatabase: 'Banco sem tabelas ou views. Você pode executar SELECT.',
  rowCount: '{count} registro(s) exibido(s)', moreRows: 'Há mais registros na próxima página', limited: 'Resultado limitado; refine a consulta', exportHint: 'A exportação inclui apenas estes registros.', queryResult: 'Resultado da consulta', exportFinished: 'Exportação finalizada ou cancelada.', exported: 'Resultado visível exportado.',
  queryPlaceholder: 'SELECT a.id, b.nome\nFROM sua_tabela AS a\nJOIN outra_tabela AS b ON b.id = a.outra_id\nLIMIT 100;', queryReady: 'Escreva uma consulta SQL para este banco. JOINs, CTEs e subconsultas são suportados.',
  invalidIdentifier: 'Identificador inválido.', queryTooLong: 'A consulta excede 100 mil caracteres.', unclosedComment: 'Comentário SQL não terminado.', singleStatement: 'Execute apenas uma instrução por vez.', unclosedText: 'Texto ou identificador SQL não terminado.',
  readOnlyQuery: 'Modo somente leitura: use SELECT, WITH ou EXPLAIN.', invalidLimit: 'Limite inválido.', connectionClosed: 'Conexão encerrada.', resultTooLarge: 'Resultado excede 8 MiB. Selecione menos colunas ou use filtros.', unexpectedRead: 'Estado inesperado de leitura.',
  schemaTooLarge: 'Navegação com mais de 1.000 objetos não suportada.', columnsTooLarge: 'Tabelas com mais de 1.000 colunas não são suportadas.', invalidPage: 'Página inválida.', tableMissing: 'Tabela ou view não encontrada.', invalidSort: 'Coluna de ordenação inválida.', invalidMessage: 'Mensagem ou parâmetros inválidos.',
  noResult: 'Execute uma consulta antes de exportar.', invalidExport: 'Salve em um arquivo .csv ou .json correspondente ao formato selecionado.', overwriteDatabase: 'A exportação não pode substituir o banco aberto.', untrustedWorkspace: 'Abra o banco em um workspace confiável.', unsupportedFile: 'Apenas bancos do sistema de arquivos do host da extensão são suportados.',
  allFiles: 'Todos os arquivos', restoreFailed: 'Alguns bancos salvos não puderam ser reabertos. Verifique os caminhos e as permissões.', languageReload: 'Recarregue a janela para aplicar o idioma do SQLite Explorer às visualizações abertas.', reload: 'Recarregar janela'
};
export function resolveLanguage(setting: string, editorLanguage: string): Language {
  const selected = setting === 'auto' ? editorLanguage : setting;
  return selected.toLowerCase().startsWith('pt') ? 'pt' : 'en';
}
export function messages(language: Language): Messages { return language === 'pt' ? pt : en; }
export function errorMessage(error: unknown, language: Language): string {
  return error instanceof AppError ? messages(language)[error.code] : error instanceof Error ? error.message : String(error);
}
