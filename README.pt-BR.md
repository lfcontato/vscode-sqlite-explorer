# LF SQLite Explorer

[English](README.md) · [Histórico de versões](CHANGELOG.md) · [Suporte](SUPPORT.md)

Extensão do Visual Studio Code para explorar arquivos SQLite, editar células e executar consultas SQL. Compatível com **Windows x64** e **Linux x64 / WSL**, com interface em inglês e português.

## Funcionalidades

- Abertura de arquivos `.db`, `.sqlite` e `.sqlite3` diretamente em uma aba.
- Árvore no explorador de arquivos e no ícone SQLite: banco → Tabelas → tabela → colunas; views e índices também aparecem.
- Clique na tabela para executar um SELECT com 100 registros por página, filtro literal e ordenação.
- Botão direito na raiz do banco → **SQLite: Consulta SQL** para uma aba independente com JOINs, CTEs, subconsultas e agregações.
- Edição por duplo clique, com escolha explícita entre Texto, Número e NULL.
- **Desfazer**, **Refazer**, **Salvar alterações** e **Descartar alterações**. Integração com o salvamento, o aviso ao fechar abas e a restauração de rascunhos do VS Code.
- Backup SQLite consistente antes de cada lote de gravação, transação atômica, chaves estrangeiras e detecção de conflitos.
- Exportação dos registros visíveis para CSV/JSON, incluindo os valores pendentes exibidos na grade.
- Conexões lembradas por workspace. A restauração da árvore não executa consultas SQL escritas pelo usuário.

## Instalação

No Marketplace, procure **LF SQLite Explorer**, publisher **lfcontato**, após a disponibilização da primeira versão.

Para instalar um pacote local, execute **Extensions: Install from VSIX…** e escolha o pacote do sistema em que a extensão será executada:

| Ambiente | Arquivo |
| --- | --- |
| Windows x64 | `sqlite-explorer-win32-x64.vsix` |
| Linux x64 ou WSL | `sqlite-explorer-linux-x64.vsix` |

Em WSL/SSH, instale o pacote Linux no host remoto. O binário nativo do Windows é diferente. São necessários VS Code **1.99+** e um workspace confiável. VS Code Web e workspaces virtuais não são suportados.

## Consultar os dados

1. Execute **SQLite: Abrir banco de dados** ou abra um arquivo SQLite.
2. Expanda a pasta Tabelas e clique em uma tabela para carregar os dados.
3. Para abrir em outra coluna do editor, use **SQLite: Visualizar tabela ao lado** no menu da tabela.
4. Para um JOIN, clique com o botão direito no banco, escolha **SQLite: Consulta SQL** e execute com **Ctrl+Enter** / **Cmd+Enter**.

```sql
SELECT p.id, u.nome
FROM pedidos AS p
JOIN usuarios AS u ON u.id = p.usuario_id
LIMIT 100;
```

Adapte os nomes ao seu banco. O editor SQL permanece somente leitura; a gravação passa pelo fluxo controlado de edição da grade.

## Editar, desfazer e refazer

Clique duas vezes em uma célula editável ou selecione-a e pressione Enter. Escolha o tipo, preencha o valor e clique em **Aplicar**. **Shift+Enter** insere uma quebra de linha no texto. Use os botões Desfazer/Refazer ou **Ctrl/Cmd+Z**, **Ctrl/Cmd+Shift+Z** e **Ctrl+Y** com o foco na grade. Dentro de um campo de texto, os atalhos mantêm o comportamento normal do campo.

As alterações ficam pendentes até salvar, inclusive quando o salvamento é iniciado pela configuração de autosave do VS Code. **Salvar ou descartar encerra o histórico da edição pendente.** Não há rollback automático do banco após um salvamento bem-sucedido. Salve ou descarte antes de mudar de tabela, página, filtro ou executar outra consulta.

A edição exige uma tabela real com chave primária declarada e não nula. Chaves compostas são suportadas. Chaves primárias, colunas geradas, células BLOB, views, resultados SQL arbitrários (inclusive JOINs) e registros com números sem representação segura em JavaScript são protegidos. Inserção/exclusão de registros e comandos SQL de escrita ainda não são implementados.

Antes de cada gravação, a extensão cria `<banco>.backup-<data>-<aleatório>.sqlite` ao lado do original usando `VACUUM INTO`, incluindo os dados já confirmados em WAL. Depois, abre uma transação, compara as assinaturas dos registros e o schema, aplica os UPDATEs, relê os resultados de afinidade/tipos e triggers e confirma o lote. Se houver conflito ou violação de restrição, todo o lote é revertido e o rascunho continua disponível.

Os backups permanecem no disco, inclusive quando a tentativa de salvamento falha; gerencie o espaço utilizado. **Salvar como** não é suportado para bancos: use a exportação de resultados ou o backup consistente.

## Idioma e configurações

| Configuração | Valores / comportamento |
| --- | --- |
| `sqliteExplorer.language` | `auto` (padrão), `en` ou `pt`; recarregue a janela após alterar. |
| `sqliteExplorer.openTablesBeside` | Abre tabelas ao lado por padrão. |

Em `auto`, a árvore e a Webview seguem o idioma do VS Code, com fallback para inglês. Títulos dos comandos, menus e configurações seguem os pacotes de idioma nativos do VS Code, independentemente da preferência da Webview. Erros técnicos recebidos do SQLite preservam o texto original.

## Arquitetura e padrões

O domínio contém contratos do banco, erros com códigos estáveis, política SQL e histórico pelo **padrão Command**. A camada de aplicação coordena schema, paginação, conexões e exportação. Os adaptadores SQLite isolam leitura, gravação transacional e cálculo das assinaturas. A árvore e o controlador da Webview tratam a apresentação; `extension.ts` monta as dependências e implementa o ciclo de vida do Custom Editor.

A injeção por construtor/fábrica mantém as regras independentes do driver. O canal de escrita é separado da conexão somente leitura das consultas. Statements, conexões e transações têm descarte explícito. A Webview valida mensagens, usa CSP com nonce e insere dados por `textContent`. Identificadores SQL são escapados, e os valores são parâmetros vinculados.

O driver N-API `sqlite3` está isolado na infraestrutura. Seu repositório upstream foi arquivado; a separação permite migrar o driver sem alterar o domínio ou a interface. As dependências estão registradas no lockfile, e o override de `minimatch` corrige um advisory transitivo do VSCE.

## Limites

- Consultas: até 1.000 registros, interrupção em 10 segundos e proteção de 8 MiB no resultado serializado. Gravações: até 100 registros por lote e interrupção em 30 segundos. Timeout de bloqueio: 3 segundos.
- A paginação usa LIMIT/OFFSET; varreduras, ordenação e offsets altos podem ser caros. Não há snapshot persistente entre páginas. O schema suporta até 1.000 objetos/colunas.
- A verificação de tamanho acontece após ler a célula nativa. Use projeções SQL para células muito grandes. BLOBs são exibidos/exportados como um resumo hexadecimal de até 128 bytes.
- Inteiros fora do intervalo seguro do JavaScript podem perder precisão na leitura; use `CAST(id AS TEXT)`. Esses registros não podem ser editados. Use aliases distintos para nomes de colunas repetidos.
- CSV escapa aspas, separadores e quebras de linha e prefixa possíveis fórmulas com apóstrofo. JSON preserva os valores escalares exibidos.
- A detecção de conflito compara o registro e o schema desde a leitura, incluindo mudanças em BLOBs; não é um mecanismo de merge colaborativo ou um editor geral de transações.

## Desenvolvimento

Use Node.js **22.22+** e npm. A extensão utiliza o runtime Node do próprio VS Code.

```sh
npm ci
npm run check
npm test
npm audit
npm run package
```

Pressione **F5** para abrir uma janela de desenvolvimento. Gere cada pacote em seu sistema de destino:

```sh
# No Windows x64
npx vsce package --target win32-x64 --out sqlite-explorer-win32-x64.vsix

# No Linux x64
npx vsce package --target linux-x64 --out sqlite-explorer-linux-x64.vsix
```

Sem um binário pré-compilado, a instalação pode exigir Python e ferramentas C++. Os testes automatizados cobrem SQLite real, histórico, rollback atômico, backups em WAL, conflitos, proteção de células, exportação, protocolo, tradução e o script real da Webview em um DOM.

## Publicação

Publisher: `lfcontato`. ID da extensão: `lfcontato.sqlite-explorer-local`. Teste os dois pacotes antes de publicar. No [portal do publisher](https://marketplace.visualstudio.com/manage/publishers/lfcontato), use **New extension → Visual Studio Code** para enviar os pacotes. Para automação futura, prefira [Trusted Publishing](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#secure-automated-publishing-to-visual-studio-marketplace).

Licença MIT. Consulte [LICENSE](LICENSE).
