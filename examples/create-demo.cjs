// Synthetic data for documentation screenshots. Never overwrites an existing database.
const fs = require('node:fs');
const path = require('node:path');
const sqlite3 = require('sqlite3');
const file = path.join(__dirname, 'demo.sqlite');
try { fs.closeSync(fs.openSync(file, 'wx')); }
catch (error) {
  if (error.code !== 'EEXIST') { throw error; }
  console.log('Demo already exists; left unchanged:', file); process.exit(0);
}
const sql = `
PRAGMA foreign_keys=ON;
CREATE TABLE clientes (id INTEGER PRIMARY KEY, nome TEXT NOT NULL, email TEXT, cidade TEXT);
INSERT INTO clientes VALUES
 (1,'Ana Silva','ana@example.com','São Paulo'),
 (2,'Bruno Costa','bruno@example.com','Curitiba'),
 (3,'Carla Lima','carla@example.com','Recife'),
 (4,'Diego Alves','diego@example.com','Belo Horizonte'),
 (5,'Elisa Santos','elisa@example.com','Porto Alegre'),
 (6,'Felipe Rocha','felipe@example.com','Florianópolis');
CREATE TABLE pedidos (id INTEGER PRIMARY KEY, cliente_id INTEGER NOT NULL REFERENCES clientes(id), produto TEXT NOT NULL, quantidade INTEGER CHECK(quantidade>0), valor REAL CHECK(valor>=0), status TEXT);
INSERT INTO pedidos VALUES
 (101,1,'Teclado mecânico',1,289.90,'Entregue'),
 (102,2,'Monitor 27 polegadas',1,1499.00,'Enviado'),
 (103,1,'Mouse sem fio',2,159.90,'Em separação'),
 (104,3,'Webcam HD',1,219.00,'Entregue'),
 (105,4,'Hub USB-C',1,179.90,'Enviado'),
 (106,5,'Suporte para notebook',1,129.00,'Entregue'),
 (107,6,'Headset',1,349.90,'Em separação'),
 (108,2,'Cabo USB-C',3,39.90,'Entregue');
CREATE INDEX pedidos_cliente ON pedidos(cliente_id);
CREATE VIEW resumo_pedidos AS
SELECT c.nome, count(p.id) AS pedidos, round(sum(p.quantidade*p.valor),2) AS total
FROM clientes c LEFT JOIN pedidos p ON p.cliente_id=c.id GROUP BY c.id;
`;
const db = new sqlite3.Database(file, sqlite3.OPEN_READWRITE, error => {
  if (error) { console.error(error.message); process.exitCode = 1; return; }
  db.exec(sql, error => {
    if (error) { console.error(error.message); process.exitCode = 1; }
    db.close(closeError => {
      if (closeError) { console.error(closeError.message); process.exitCode = 1; }
      else if (!error) { console.log('Created synthetic demo database:', file); }
    });
  });
});
