#!/usr/bin/env node
// Lê a saída de `wrangler pages project list --json` (stdin) e diz se o projeto existe.
//   ... | node scripts/projeto-pages.js <nome>
// Sai com 0 e imprime os domínios do projeto se ele existir; sai com 1 se não existir.

const nome = process.argv[2];
const texto = require("fs").readFileSync(0, "utf8");
// Ignora qualquer aviso que o wrangler imprima antes/depois do JSON
const inicio = texto.indexOf("[");
const fim = texto.lastIndexOf("]");
if (inicio === -1 || fim < inicio) {
  console.error("Não consegui ler a lista de projetos do Pages:\n" + texto);
  process.exit(2);
}
const projeto = JSON.parse(texto.slice(inicio, fim + 1)).find((p) => p["Project Name"] === nome);
if (!projeto) process.exit(1);
console.log(projeto["Project Domains"]);
