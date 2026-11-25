#!/usr/bin/env node
// Ajuda o workflow de publicação com o banco D1 do sorteio.
//
//   ... d1 list --json | node scripts/banco-sorteio.js id <nome>
//        imprime o id do banco (vazio se ainda não existe)
//   node scripts/banco-sorteio.js ligar <wrangler.jsonc> <nome> <id>
//        declara o banco como SORTEIO_DB no wrangler.jsonc (Workers e Pages)
//   node scripts/banco-sorteio.js corpo-pages <id>
//        imprime o corpo do PATCH que liga o banco a um projeto Pages

const fs = require("fs");

const [acao, ...args] = process.argv.slice(2);

if (acao === "id") {
  const [nome] = args;
  const texto = fs.readFileSync(0, "utf8");
  // Ignora qualquer aviso que o wrangler imprima antes/depois do JSON
  const inicio = texto.indexOf("[");
  const fim = texto.lastIndexOf("]");
  if (inicio === -1 || fim < inicio) {
    console.error("Não consegui ler a lista de bancos D1:\n" + texto);
    process.exit(2);
  }
  const banco = JSON.parse(texto.slice(inicio, fim + 1)).find((b) => b.name === nome);
  if (banco) console.log(banco.uuid);
} else if (acao === "ligar") {
  const [arquivo, nome, id] = args;
  if (!/^[0-9a-f-]{36}$/.test(id || "")) {
    console.error(`Id de banco inválido: "${id}"`);
    process.exit(2);
  }
  const config = JSON.parse(fs.readFileSync(arquivo, "utf8"));
  config.d1_databases = [{ binding: "SORTEIO_DB", database_name: nome, database_id: id }];
  fs.writeFileSync(arquivo, JSON.stringify(config, null, 2) + "\n");
  console.log(`Banco ${nome} ligado ao site como SORTEIO_DB.`);
} else if (acao === "corpo-pages") {
  // Corpo do PATCH que liga o banco ao projeto Pages (produção e prévias)
  const [id] = args;
  if (!/^[0-9a-f-]{36}$/.test(id || "")) {
    console.error(`Id de banco inválido: "${id}"`);
    process.exit(2);
  }
  const ligacao = { d1_databases: { SORTEIO_DB: { id } } };
  console.log(JSON.stringify({ deployment_configs: { production: ligacao, preview: ligacao } }));
} else {
  console.error("Uso: banco-sorteio.js id <nome> | ligar <wrangler.jsonc> <nome> <id>");
  process.exit(2);
}
