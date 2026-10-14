// Testes do montador de sites por cliente (scripts/montar.js).
// Rodar com: npm test

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { montar, ConfigInvalida } = require("../scripts/montar.js");

const RAIZ_REAL = path.join(__dirname, "..");
const BASE = JSON.parse(fs.readFileSync(path.join(RAIZ_REAL, "clientes/exemplo/config.json"), "utf8"));
const FOTO = fs.readFileSync(path.join(RAIZ_REAL, "clientes/exemplo/foto.jpg"));

// Cria um projeto temporário com o modelo real e um cliente com a config dada
function projeto(config, { foto = FOTO, cliente = "teste" } = {}) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "montar-"));
  fs.cpSync(path.join(RAIZ_REAL, "modelo"), path.join(raiz, "modelo"), { recursive: true });
  const pasta = path.join(raiz, "clientes", cliente);
  fs.mkdirSync(pasta, { recursive: true });
  fs.writeFileSync(path.join(pasta, "config.json"), typeof config === "string" ? config : JSON.stringify(config));
  if (foto) fs.writeFileSync(path.join(pasta, "foto.jpg"), foto);
  return raiz;
}

function montarCom(config, opcoes = {}) {
  const raiz = projeto(config, opcoes);
  const destino = montar(opcoes.cliente || "teste", { raiz, publicar: opcoes.publicar });
  return {
    html: fs.readFileSync(path.join(destino, "public/index.html"), "utf8"),
    wrangler: JSON.parse(fs.readFileSync(path.join(destino, "wrangler.jsonc"), "utf8")),
    destino,
  };
}

const com = (mudancas) => ({ ...structuredClone(BASE), ...mudancas });

test("monta os clientes do repositório sem sobrar marcador", () => {
  for (const cliente of fs.readdirSync(path.join(RAIZ_REAL, "clientes"))) {
    const saida = fs.mkdtempSync(path.join(os.tmpdir(), "dist-"));
    const destino = montar(cliente, { saida });
    const html = fs.readFileSync(path.join(destino, "public/index.html"), "utf8");
    assert.ok(!html.includes("{{"), `${cliente}: sobrou marcador`);
    assert.ok(!html.includes("FAIXA_CUPONS"), `${cliente}: sobrou marcador da faixa`);
    for (const arquivo of ["app.js", "_headers", "foto.jpg"]) {
      assert.ok(fs.existsSync(path.join(destino, "public", arquivo)), `${cliente}: falta ${arquivo}`);
    }
  }
});

test("textos e cores do cliente vão pra página", () => {
  const { html, wrangler } = montarCom(com({ titulo: "Links da Fulana", subtitulo: "Sub", texto_botao: "Gerar!", cores: { principal: "#123456", escura: "#000000", fundo: "#ffffff" }, sub_id: "fulana1" }));
  assert.ok(html.includes("<title>Links da Fulana</title>"));
  assert.ok(html.includes("<h1>Links da Fulana</h1>"));
  assert.ok(html.includes('<button id="btn">Gerar!</button>'));
  assert.ok(html.includes("--laranja: #123456;"));
  assert.equal(wrangler.vars.SUB_ID, "fulana1");
  assert.equal(wrangler.name, BASE.cloudflare.nome_worker);
  assert.deepEqual(wrangler.assets.run_worker_first, ["/api/*"]);
  assert.equal(wrangler.ratelimits[0].name, "LIMITADOR");
});

test("faixa de cupons liga e desliga", () => {
  const ligada = montarCom(com({ mostrar_faixa_cupons: true, texto_faixa_cupons: "Últimos cupons!" })).html;
  assert.ok(ligada.includes('<div class="urgencia">Últimos cupons!</div>'));
  const desligada = montarCom(com({ mostrar_faixa_cupons: false, texto_faixa_cupons: "Últimos cupons!" })).html;
  assert.ok(!desligada.includes('class="urgencia"'));
  assert.ok(!desligada.includes("Últimos cupons!"));
});

test("faixa ligada exige texto", () => {
  assert.throws(() => montarCom(com({ mostrar_faixa_cupons: true, texto_faixa_cupons: "  " })), ConfigInvalida);
});

test("textos com HTML/JS são escapados (sem XSS pela config)", () => {
  const ataque = `"><script>alert(1)</script><img src=x onerror=alert(2)>'`;
  const { html } = montarCom(com({ titulo: ataque, subtitulo: ataque, descricao: ataque, texto_botao: ataque.slice(0, 40), nome: ataque, mostrar_faixa_cupons: true, texto_faixa_cupons: ataque }));
  assert.ok(!html.includes("<script>alert"));
  assert.ok(!html.includes("<img src=x"));
  assert.ok(!/content="[^"]*"><script/.test(html));
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  // única tag <script> é a do app.js
  assert.equal((html.match(/<script/g) || []).length, 1);
});

test("marcadores {{...}} digitados no texto não são processados de novo", () => {
  const { html } = montarCom(com({ titulo: "{{COR_PRINCIPAL}} $1 $& {{X}}" }));
  assert.ok(html.includes("<h1>{{COR_PRINCIPAL}} $1 $&amp; {{X}}</h1>"));
});

test("cor fora do formato #RRGGBB é recusada (sem injeção de CSS)", () => {
  for (const principal of ["red", "#fff", "#ee4d2d;} body{display:none", "#ee4d2dzz", "url(x)", "", 123]) {
    assert.throws(() => montarCom(com({ cores: { ...BASE.cores, principal } })), ConfigInvalida, String(principal));
  }
});

test("sub_id, nome do worker e account_id são validados", () => {
  for (const sub_id of ["com espaço", "acentuação", "a-b", "", "x".repeat(101)]) {
    assert.throws(() => montarCom(com({ sub_id })), ConfigInvalida, sub_id);
  }
  for (const nome_worker of ["Maiusculo", "-comeca", "termina-", "tem_underline", "a".repeat(64), "../x"]) {
    assert.throws(() => montarCom(com({ cloudflare: { ...BASE.cloudflare, nome_worker } })), ConfigInvalida, nome_worker);
  }
  for (const account_id of ["123", "G".repeat(32), "a".repeat(33)]) {
    assert.throws(() => montarCom(com({ cloudflare: { ...BASE.cloudflare, account_id } })), ConfigInvalida, account_id);
  }
});

test("publicar exige account_id; com ele, vai pro wrangler", () => {
  assert.throws(() => montarCom(com({}), { publicar: true }), /account_id/);
  const id = "0123456789abcdef0123456789abcdef";
  const { wrangler } = montarCom(com({ cloudflare: { ...BASE.cloudflare, account_id: id } }), { publicar: true });
  assert.equal(wrangler.account_id, id);
});

test("campo faltando, sobrando ou com tipo errado é recusado", () => {
  const semTitulo = com({});
  delete semTitulo.titulo;
  assert.throws(() => montarCom(semTitulo), /Falta o campo "titulo"/);
  assert.throws(() => montarCom(com({ titlo: "x" })), /Campo desconhecido "titlo"/);
  assert.throws(() => montarCom(com({ mostrar_faixa_cupons: "sim" })), ConfigInvalida);
  assert.throws(() => montarCom(com({ cores: "laranja" })), ConfigInvalida);
  assert.throws(() => montarCom(com({ titulo: "x".repeat(81) })), ConfigInvalida);
  assert.throws(() => montarCom("{ isso não é json"), /JSON válido/);
  assert.throws(() => montarCom("[]"), ConfigInvalida);
});

test("foto precisa ser JPEG de verdade e pequena", () => {
  assert.throws(() => montarCom(com({}), { foto: null }), /Falta a foto/);
  assert.throws(() => montarCom(com({}), { foto: Buffer.from("<svg onload=alert(1)>") }), /JPEG/);
  const grande = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(1024 * 1024 + 1)]);
  assert.throws(() => montarCom(com({}), { foto: grande }), /reduza/);
});

test("nome de cliente não permite sair da pasta clientes/", () => {
  const raiz = projeto(com({}));
  for (const cliente of ["../modelo", "..", "/etc", "a/b", "", undefined, "Teste"]) {
    assert.throws(() => montar(cliente, { raiz }), ConfigInvalida, String(cliente));
  }
});
