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
  assert.equal(wrangler.name, BASE.cloudflare.nome_projeto);
  assert.equal(wrangler.ratelimits[0].name, "LIMITADOR");
});

test("tipo workers: wrangler.jsonc de Worker com SUB_ID nas vars", () => {
  const { wrangler, destino } = montarCom(com({ sub_id: "fulana1", cloudflare: { ...BASE.cloudflare, tipo: "workers" } }));
  assert.equal(wrangler.main, "../../src/worker.js");
  assert.equal(wrangler.vars.SUB_ID, "fulana1");
  assert.deepEqual(wrangler.assets.run_worker_first, ["/api/*"]);
  assert.ok(!fs.existsSync(path.join(destino, "functions")));
  assert.equal(JSON.parse(fs.readFileSync(path.join(destino, "publicar.json"))).tipo, "workers");
});

test("tipo pages: wrangler.jsonc de Pages e função com o SUB_ID do cliente", () => {
  const { wrangler, destino } = montarCom(com({ sub_id: "fulana1", cloudflare: { ...BASE.cloudflare, tipo: "pages" } }));
  assert.equal(wrangler.pages_build_output_dir, "./public");
  assert.equal(wrangler.main, undefined);
  const funcao = fs.readFileSync(path.join(destino, "functions/api/converter.js"), "utf8");
  assert.ok(funcao.includes('const SUB_ID = "fulana1";'));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(destino, "publicar.json"))), {
    tipo: "pages",
    nome: BASE.cloudflare.nome_projeto,
    account_id: BASE.cloudflare.account_id,
  });
});

test("função do Pages gerada converte de verdade usando o SUB_ID do cliente", async () => {
  const raiz = projeto(com({ sub_id: "subDoCliente", cloudflare: { ...BASE.cloudflare, tipo: "pages" } }), { cliente: "teste-funcao" });
  const saida = fs.mkdtempSync(path.join(os.tmpdir(), "dist-"));
  try {
    const destino = montar("teste-funcao", { raiz, saida });
    // Fora do repositório o import relativo não acha src/; aponta pro src/ real só neste teste
    const arquivo = path.join(destino, "functions/api/converter.js");
    fs.writeFileSync(arquivo, fs.readFileSync(arquivo, "utf8").replace("../../../../src/converter.js", path.join(RAIZ_REAL, "src/converter.js")));
    const { onRequest } = await import(arquivo);
    let query;
    global.fetch = async (url, opts) => {
      query = JSON.parse(opts.body).query;
      return new Response(JSON.stringify({ data: { generateShortLink: { shortLink: "https://s.shopee.com.br/OK" } } }));
    };
    const request = new Request("https://fulana.pages.dev/api/converter", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "1.2.3.4" },
      body: JSON.stringify({ link: "https://shopee.com.br/a-i.1.2" }),
    });
    const resposta = await onRequest({ request, env: { SHOPEE_APP_ID: "a", SHOPEE_SECRET: "b", SUB_ID: "tentativa-de-troca" } });
    assert.equal(resposta.status, 200);
    assert.ok(query.includes('subIds:["subDoCliente"]'), query);
  } finally {
    fs.rmSync(saida, { recursive: true, force: true });
  }
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

test("sub_id, tipo, nome do projeto e account_id são validados", () => {
  for (const sub_id of ["com espaço", "acentuação", "a-b", "", "x".repeat(101)]) {
    assert.throws(() => montarCom(com({ sub_id })), ConfigInvalida, sub_id);
  }
  for (const nome_projeto of ["Maiusculo", "-comeca", "termina-", "tem_underline", "a".repeat(59), "../x", ""]) {
    assert.throws(() => montarCom(com({ cloudflare: { ...BASE.cloudflare, nome_projeto } })), ConfigInvalida, nome_projeto);
  }
  for (const tipo of ["Pages", "vercel", "", true]) {
    assert.throws(() => montarCom(com({ cloudflare: { ...BASE.cloudflare, tipo } })), ConfigInvalida, String(tipo));
  }
  for (const account_id of ["123", "G".repeat(32), "a".repeat(33)]) {
    assert.throws(() => montarCom(com({ cloudflare: { ...BASE.cloudflare, account_id } })), ConfigInvalida, account_id);
  }
});

test("publicar exige account_id; com ele, vai pro wrangler", () => {
  assert.throws(() => montarCom(com({}), { publicar: true }), /account_id/);
  const id = "0123456789abcdef0123456789abcdef";
  const workers = montarCom(com({ cloudflare: { ...BASE.cloudflare, tipo: "workers", account_id: id } }), { publicar: true });
  assert.equal(workers.wrangler.account_id, id);
  const pages = montarCom(com({ cloudflare: { ...BASE.cloudflare, tipo: "pages", account_id: id } }), { publicar: true });
  assert.equal(JSON.parse(fs.readFileSync(path.join(pages.destino, "publicar.json"))).account_id, id);
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
