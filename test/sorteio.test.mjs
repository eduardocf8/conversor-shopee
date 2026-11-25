// Testes do sorteio (src/sorteio.js): inscrição, validações, área do dono e exportação.
// O banco D1 é simulado em memória.

import { test } from "node:test";
import assert from "node:assert/strict";
import { tratarInscricao, tratarAdmin, gerarCsv, whatsappValido, nomeValido } from "../src/sorteio.js";

// D1 de mentira: só o que o sorteio usa
function bancoFalso() {
  const linhas = new Map();
  const banco = {
    linhas,
    falhar: false,
    prepare(sql) {
      let args = [];
      const consulta = {
        bind(...a) {
          args = a;
          return consulta;
        },
        async run() {
          if (banco.falhar) throw new Error("D1_ERROR: falha simulada");
          if (sql.startsWith("CREATE TABLE")) return {};
          if (sql.startsWith("INSERT")) {
            const [pedido, nome, whatsapp, criado_em] = args;
            if (linhas.has(pedido)) throw new Error("D1_ERROR: UNIQUE constraint failed: inscricoes.pedido");
            linhas.set(pedido, { pedido, nome, whatsapp, criado_em });
            return {};
          }
          if (sql.startsWith("DELETE")) {
            linhas.clear();
            return {};
          }
          throw new Error("sql inesperado: " + sql);
        },
        async first() {
          return { total: linhas.size };
        },
        async all() {
          return { results: [...linhas.values()] };
        },
      };
      return consulta;
    },
  };
  return banco;
}

const SENHA = "senha-bem-longa-123";
let ipSeq = 0;

function pedidoHttp(caminho, corpo, { headers = {}, ip, metodo = "POST" } = {}) {
  ip = ip || `10.1.${ipSeq >> 8}.${++ipSeq & 255}`;
  const h = { "content-type": "application/json", "cf-connecting-ip": ip, ...headers };
  for (const k of Object.keys(h)) if (h[k] === undefined) delete h[k];
  const init = { method: metodo, headers: h };
  if (metodo !== "GET") init.body = typeof corpo === "string" ? corpo : JSON.stringify(corpo);
  return new Request("https://fulana.pages.dev" + caminho, init);
}

const VALIDO = { nome: "Maria da Silva", pedido: "251125abcd1234", whatsapp: "(11) 91234-5678", aceite: true };

async function inscrever(corpo, opcoes = {}, env) {
  const resp = await tratarInscricao(pedidoHttp("/api/sorteio", corpo, opcoes), env);
  return { status: resp.status, corpo: await resp.json() };
}

test("inscrição válida é gravada normalizada", async () => {
  const db = bancoFalso();
  const r = await inscrever(VALIDO, {}, { SORTEIO_DB: db });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.pedido, "251125ABCD1234");
  const linha = db.linhas.get("251125ABCD1234");
  assert.equal(linha.nome, "Maria da Silva");
  assert.equal(linha.whatsapp, "(11) 91234-5678");
  assert.ok(!Number.isNaN(Date.parse(linha.criado_em)));
});

test("mesmo pedido não entra duas vezes", async () => {
  const db = bancoFalso();
  await inscrever(VALIDO, {}, { SORTEIO_DB: db });
  const r = await inscrever({ ...VALIDO, nome: "Outra Pessoa", pedido: "251125ABCD1234 " }, {}, { SORTEIO_DB: db });
  assert.equal(r.status, 409);
  assert.equal(r.corpo.campo, "pedido");
  assert.equal(db.linhas.size, 1);
});

test("WhatsApp: só celular com 11 números e DDD válido", async () => {
  for (const ok of ["11912345678", "(21) 98765-4321", "85 9 8888-7777"]) {
    const db = bancoFalso();
    assert.equal((await inscrever({ ...VALIDO, whatsapp: ok }, {}, { SORTEIO_DB: db })).status, 200, ok);
  }
  for (const ruim of ["1191234567", "119123456789", "(11) 81234-5678", "(01) 91234-5678", "(10) 91234-5678", "", "abc"]) {
    const db = bancoFalso();
    const r = await inscrever({ ...VALIDO, whatsapp: ruim }, {}, { SORTEIO_DB: db });
    assert.equal(r.status, 400, ruim);
    assert.equal(r.corpo.campo, "whatsapp", ruim);
    assert.equal(db.linhas.size, 0);
  }
  assert.ok(whatsappValido("11912345678"));
  assert.ok(!whatsappValido("1191234567"));
});

test("nome completo, pedido e autorização são obrigatórios", async () => {
  const casos = [
    [{ nome: "Maria" }, "nome"],
    [{ nome: "  " }, "nome"],
    [{ nome: "Maria <b>Silva</b>" }, "nome"],
    [{ nome: "Maria 123" }, "nome"],
    [{ pedido: "123" }, "pedido"],
    [{ pedido: "251125ABCD1234'; DROP TABLE" }, "pedido"],
    [{ aceite: false }, "aceite"],
    [{ aceite: "true" }, "aceite"],
  ];
  for (const [mudanca, campo] of casos) {
    const db = bancoFalso();
    const r = await inscrever({ ...VALIDO, ...mudanca }, {}, { SORTEIO_DB: db });
    assert.equal(r.status, 400, JSON.stringify(mudanca));
    assert.equal(r.corpo.campo, campo, JSON.stringify(mudanca));
    assert.equal(db.linhas.size, 0);
  }
  assert.ok(nomeValido("Ana Lú D'Ávila"));
});

test("robô que preenche o campo escondido recebe ok mas não grava", async () => {
  const db = bancoFalso();
  const r = await inscrever({ ...VALIDO, site: "http://spam" }, {}, { SORTEIO_DB: db });
  assert.equal(r.status, 200);
  assert.equal(db.linhas.size, 0);
});

test("bloqueia outro site, formato errado, método errado e corpo grande", async () => {
  const env = { SORTEIO_DB: bancoFalso() };
  assert.equal((await inscrever(VALIDO, { headers: { origin: "https://evil.com" } }, env)).status, 403);
  assert.equal((await inscrever(VALIDO, { headers: { "content-type": "text/plain" } }, env)).status, 415);
  assert.equal((await tratarInscricao(pedidoHttp("/api/sorteio", null, { metodo: "GET" }), env)).status, 405);
  assert.equal((await inscrever(JSON.stringify({ ...VALIDO, nome: "a".repeat(10000) }), {}, env)).status, 413);
  assert.equal((await inscrever("{quebrado", {}, env)).status, 400);
  assert.equal(env.SORTEIO_DB.linhas.size, 0);
});

test("sem banco ligado: inscrições fechadas, sem erro", async () => {
  const r = await inscrever(VALIDO, {}, {});
  assert.equal(r.status, 503);
});

test("falha do banco vira mensagem genérica, sem dados pessoais", async () => {
  const db = bancoFalso();
  db.falhar = true;
  const erros = [];
  const original = console.error;
  console.error = (...a) => erros.push(a.join(" "));
  try {
    const r = await inscrever(VALIDO, {}, { SORTEIO_DB: db });
    assert.equal(r.status, 500);
  } finally {
    console.error = original;
  }
  assert.ok(!erros.join(" ").includes("Maria") && !erros.join(" ").includes("91234"), "log com dado pessoal");
});

test("limite de inscrições por IP", async () => {
  const env = { SORTEIO_DB: bancoFalso() };
  const ip = "203.0.113.90";
  for (let i = 0; i < 10; i++) await inscrever({ ...VALIDO, pedido: `251125ABCD${1000 + i}` }, { ip }, env);
  assert.equal((await inscrever({ ...VALIDO, pedido: "251125ZZZZ9999" }, { ip }, env)).status, 429);
});

// ---------- Área do dono ----------

async function admin(corpo, env, opcoes = {}) {
  const resp = await tratarAdmin(pedidoHttp("/api/sorteio-admin", corpo, opcoes), env);
  return resp;
}

test("área do dono: senha errada não entra; certa conta, exporta e apaga", async () => {
  const db = bancoFalso();
  const env = { SORTEIO_DB: db, SORTEIO_SENHA: SENHA };
  await inscrever(VALIDO, {}, env);
  await inscrever({ ...VALIDO, pedido: "251125EFGH5678", nome: "João Souza" }, {}, env);

  assert.equal((await admin({ senha: "errada", acao: "contar" }, env)).status, 401);
  assert.equal((await admin({ acao: "contar" }, env)).status, 401);

  const contar = await admin({ senha: SENHA, acao: "contar" }, env);
  assert.deepEqual(await contar.json(), { total: 2 });

  const exportar = await admin({ senha: SENHA, acao: "exportar" }, env);
  assert.equal(exportar.status, 200);
  assert.match(exportar.headers.get("content-type"), /text\/csv/);
  assert.equal(exportar.headers.get("cache-control"), "no-store");
  const bytes = new Uint8Array(await exportar.arrayBuffer());
  // .text() esconde o BOM; nos bytes ele precisa estar lá pro Excel acertar os acentos
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], "BOM para o Excel");
  const csv = new TextDecoder().decode(bytes);
  assert.ok(csv.includes('"Maria da Silva";"251125ABCD1234";"(11) 91234-5678"'));
  assert.ok(csv.includes('"João Souza";"251125EFGH5678"'));

  assert.equal((await admin({ senha: SENHA, acao: "apagar" }, env)).status, 400, "sem confirmação não apaga");
  assert.equal(db.linhas.size, 2);
  assert.equal((await admin({ senha: SENHA, acao: "apagar", confirmacao: "APAGAR" }, env)).status, 200);
  assert.equal(db.linhas.size, 0);
});

test("área do dono: sem senha cadastrada (ou curta) fica fechada", async () => {
  const db = bancoFalso();
  assert.equal((await admin({ senha: "", acao: "contar" }, { SORTEIO_DB: db })).status, 503);
  assert.equal((await admin({ senha: "curta", acao: "contar" }, { SORTEIO_DB: db, SORTEIO_SENHA: "curta" })).status, 503);
});

test("área do dono: bloqueia depois de 5 senhas erradas", async () => {
  const env = { SORTEIO_DB: bancoFalso(), SORTEIO_SENHA: SENHA };
  const ip = "198.51.100.200";
  for (let i = 0; i < 5; i++) assert.equal((await admin({ senha: "chute" + i, acao: "contar" }, env, { ip })).status, 401);
  assert.equal((await admin({ senha: SENHA, acao: "contar" }, env, { ip })).status, 429, "nem a certa passa durante o bloqueio");
  assert.equal((await admin({ senha: SENHA, acao: "contar" }, env, { ip: "198.51.100.201" })).status, 200);
});

test("área do dono: bloqueia outro site e método errado", async () => {
  const env = { SORTEIO_DB: bancoFalso(), SORTEIO_SENHA: SENHA };
  assert.equal((await admin({ senha: SENHA, acao: "exportar" }, env, { headers: { origin: "https://evil.com" } })).status, 403);
  assert.equal((await tratarAdmin(pedidoHttp("/api/sorteio-admin", null, { metodo: "GET" }), env)).status, 405);
});

test("CSV neutraliza fórmulas do Excel (proteção extra, o formulário já barra)", () => {
  const csv = gerarCsv([{ nome: "=SOMA(A1)", pedido: "+X", whatsapp: "@x", criado_em: "2026-11-25T12:00:00Z" }]);
  assert.ok(csv.includes(`"'=SOMA(A1)";"'+X";"'@x"`));
});

test("CSV escapa aspas", () => {
  const csv = gerarCsv([{ nome: 'Ana "Lu" Souza', pedido: "X1", whatsapp: "(11) 91111-1111", criado_em: "2026-11-25T12:00:00Z" }]);
  assert.ok(csv.includes('"Ana ""Lu"" Souza"'));
  assert.ok(csv.includes("25/11/2026"));
});
