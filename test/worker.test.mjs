// Testes de segurança e comportamento do conversor da Cloudflare (src/).
// Rodar com: npm test
// Não usa a Shopee de verdade: o fetch é simulado.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import worker from "../src/worker.js";

const ENV_BASE = {
  SHOPEE_APP_ID: "APPID_DE_TESTE_123",
  SHOPEE_SECRET: "SEGREDO_DE_TESTE_456",
  SUB_ID: "site",
  ASSETS: { fetch: async () => new Response("pagina", { status: 200 }) },
};

let chamadas; // URLs que o backend tentou acessar
let rotas; // respostas simuladas por URL
let respostaShopee;
let ultimaQuery;
let ipSeq = 0;

const respostaPadrao = (corpo) => {
  ultimaQuery = corpo.query;
  return { data: { generateShortLink: { shortLink: "https://s.shopee.com.br/AFILIADO" } } };
};

beforeEach(() => {
  chamadas = [];
  rotas = {};
  ultimaQuery = null;
  respostaShopee = respostaPadrao;
});

globalThis.fetch = async (url, opts = {}) => {
  chamadas.push(url);
  if (url === "https://open-api.affiliate.shopee.com.br/graphql") {
    const corpo = respostaShopee(JSON.parse(opts.body), opts);
    if (corpo instanceof Error) throw corpo;
    return new Response(JSON.stringify(corpo), { headers: { "Content-Type": "application/json" } });
  }
  const rota = rotas[url];
  if (rota === "trava") {
    return new Promise((_, rejeitar) => opts.signal.addEventListener("abort", () => rejeitar(new Error("abortado"))));
  }
  if (rota) return new Response(null, { status: 302, headers: { location: rota } });
  return new Response("<html>abra no app</html>", { status: 200 });
};

async function chamar({ link, corpoBruto, metodo = "POST", headers = {}, ip, caminho = "/api/converter", env = {} } = {}) {
  ip = ip || `10.0.${ipSeq >> 8}.${++ipSeq & 255}`;
  const h = { "content-type": "application/json", "cf-connecting-ip": ip, ...headers };
  for (const k of Object.keys(h)) if (h[k] === undefined) delete h[k];
  const init = { method: metodo, headers: h };
  if (!["GET", "HEAD"].includes(metodo)) init.body = corpoBruto !== undefined ? corpoBruto : JSON.stringify({ link });
  const resposta = await worker.fetch(new Request("https://meusite.workers.dev" + caminho, init), { ...ENV_BASE, ...env });
  const texto = await resposta.text();
  let corpo;
  try {
    corpo = JSON.parse(texto);
  } catch (e) {
    corpo = texto;
  }
  return { status: resposta.status, corpo, cabecalhos: resposta.headers, texto };
}

function semSegredos(r) {
  assert.ok(!r.texto.includes("SEGREDO_DE_TESTE_456"), "resposta vazou a Secret");
  assert.ok(!r.texto.includes("APPID_DE_TESTE_123"), "resposta vazou o App ID");
}

// ---------- Fluxo normal ----------

test("converte link completo da Shopee", async () => {
  const r = await chamar({ link: "https://shopee.com.br/Produto-i.123.456" });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.link, "https://s.shopee.com.br/AFILIADO");
  assert.equal(ultimaQuery, 'mutation{generateShortLink(input:{originUrl:"https://shopee.com.br/Produto-i.123.456",subIds:["site"]}){shortLink}}');
  assert.equal(r.cabecalhos.get("cache-control"), "no-store");
  assert.equal(r.cabecalhos.get("x-content-type-options"), "nosniff");
  semSegredos(r);
});

test("usa o SUB_ID configurado do cliente", async () => {
  await chamar({ link: "https://shopee.com.br/a-i.1.2", env: { SUB_ID: "fulana2024" } });
  assert.ok(ultimaQuery.includes('subIds:["fulana2024"]'), ultimaQuery);
});

test("extrai o link do texto do botão compartilhar", async () => {
  const r = await chamar({ link: "Confira Linha De Cuidados por R$29,90. Compre na Shopee agora! https://br.shp.ee/abc123?x=1 fim" });
  assert.equal(r.status, 200);
  assert.ok(ultimaQuery.includes('originUrl:"https://br.shp.ee/abc123?x=1"'));
});

test("assinatura no formato exigido pela Shopee", async () => {
  let auth, corpo;
  respostaShopee = (c, opts) => {
    auth = opts.headers.Authorization;
    corpo = opts.body;
    return { data: { generateShortLink: { shortLink: "https://s.shopee.com.br/X" } } };
  };
  await chamar({ link: "https://shopee.com.br/a-i.1.2" });
  const m = auth.match(/^SHA256 Credential=APPID_DE_TESTE_123, Timestamp=(\d+), Signature=([0-9a-f]{64})$/);
  assert.ok(m, auth);
  assert.ok(Math.abs(Number(m[1]) - Date.now() / 1000) < 5, "timestamp em segundos");
  const esperado = createHash("sha256").update(`APPID_DE_TESTE_123${m[1]}${corpo}SEGREDO_DE_TESTE_456`).digest("hex");
  assert.equal(m[2], esperado);
});

// ---------- Rotas ----------

test("páginas vão pros arquivos estáticos; /api desconhecida dá 404", async () => {
  const pagina = await chamar({ metodo: "GET", caminho: "/" });
  assert.equal(pagina.texto, "pagina");
  const nada = await chamar({ caminho: "/api/outra" });
  assert.equal(nada.status, 404);
});

// ---------- Método, origem e formato ----------

test("rejeita métodos que não sejam POST", async () => {
  for (const metodo of ["GET", "PUT", "DELETE", "OPTIONS", "PATCH"]) {
    const r = await chamar({ metodo, link: "https://shopee.com.br/a-i.1.2" });
    assert.equal(r.status, 405, metodo);
    assert.equal(r.cabecalhos.get("allow"), "POST");
  }
  assert.equal(chamadas.length, 0);
});

test("rejeita pedido vindo de outro site (Origin diferente)", async () => {
  for (const origin of ["https://evil.com", "https://meusite.workers.dev.evil.com", "http://meusite.workers.dev:8080", "null", "lixo"]) {
    const r = await chamar({ link: "https://shopee.com.br/a-i.1.2", headers: { origin } });
    assert.equal(r.status, 403, origin);
  }
  assert.equal(chamadas.length, 0);
});

test("aceita pedido do próprio site e sem Origin", async () => {
  assert.equal((await chamar({ link: "https://shopee.com.br/a-i.1.2", headers: { origin: "https://meusite.workers.dev" } })).status, 200);
  assert.equal((await chamar({ link: "https://shopee.com.br/a-i.1.2" })).status, 200);
});

test("só aceita Content-Type JSON (bloqueia formulário de outro site)", async () => {
  for (const ct of ["application/x-www-form-urlencoded", "text/plain", "multipart/form-data; boundary=x", undefined]) {
    const r = await chamar({ link: "https://shopee.com.br/a-i.1.2", headers: { "content-type": ct } });
    assert.equal(r.status, 415, String(ct));
  }
  assert.equal(chamadas.length, 0);
});

test("JSON malformado ou com tipos errados não derruba o Worker", async () => {
  for (const corpoBruto of ['{"link":', "", "null", "[]", '"texto"', '{"link":123}', '{"link":{"a":1}}', '{"link":["https://shopee.com.br/a-i.1.2"]}', '{"link":null}', '{"link":""}', '{"link":"   "}', '{"__proto__":{"link":"https://shopee.com.br/a-i.1.2"}}']) {
    const r = await chamar({ corpoBruto });
    assert.equal(r.status, 400, corpoBruto);
  }
  assert.equal(chamadas.length, 0);
});

test("corpo grande demais é recusado sem ler tudo (413)", async () => {
  const r = await chamar({ corpoBruto: JSON.stringify({ link: "a".repeat(20_000) }) });
  assert.equal(r.status, 413);
  // Content-Length mentiroso: o limite vale pelo que chega de verdade
  const fluxo = new ReadableStream({
    start(c) {
      for (let i = 0; i < 20; i++) c.enqueue(new TextEncoder().encode("a".repeat(1000)));
      c.close();
    },
  });
  const resposta = await worker.fetch(
    new Request("https://meusite.workers.dev/api/converter", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "10.99.0.1" }, body: fluxo, duplex: "half" }),
    ENV_BASE,
  );
  assert.equal(resposta.status, 413);
  assert.equal(chamadas.length, 0);
});

// ---------- Validação do link ----------

test("rejeita links que não são da Shopee (incluindo disfarçados)", async () => {
  const ruins = [
    "https://evil.com/shopee",
    "https://shopee.com.br.evil.com/a-i.1.2",
    "https://evilshopee.com.br/a-i.1.2",
    "https://shopee.com.br@evil.com/a-i.1.2",
    "https://user:pass@shopee.com.br/a-i.1.2",
    "https://shopee.com.br:8443/a-i.1.2",
    "https://br.shp.ee:22/abc",
    "javascript:alert(1)//shopee.com.br",
    "data:text/html,shopee.com.br",
    "file:///etc/passwd",
    "ftp://shopee.com.br/x",
    "https://shopee.com/a-i.1.2",
    "https://shopee.com.br%2eevil.com/",
    "https://xn--shope-9qa.com.br/a-i.1.2",
    "https://shp.ee.evil.com/abc",
    "http://169.254.169.254/latest/meta-data/",
    "http://localhost/shopee.com.br",
    "lixo",
    "shopee",
  ];
  for (const link of ruins) {
    const r = await chamar({ link });
    assert.equal(r.status, 400, link);
  }
  assert.equal(chamadas.length, 0, "não pode acessar nada com link inválido");
});

test("aceita variações legítimas de domínio", async () => {
  for (const link of ["https://SHOPEE.COM.BR/a-i.1.2", "https://www.shopee.com.br/a-i.1.2", "http://shopee.com.br/a-i.1.2", "https://s.shopee.com.br/abc"]) {
    assert.equal((await chamar({ link })).status, 200, link);
  }
});

test("injeção na query GraphQL não altera a mutation", async () => {
  const ataques = [
    'https://shopee.com.br/x"){shortLink}}mutation{a(b:"',
    'https://shopee.com.br/x\\"){shortLink}}',
    'https://shopee.com.br/a-i.1.2?q="}){shortLink}}#',
    "https://shopee.com.br/a-i.1.2?q=%22%7D%29",
    "https://shopee.com.br/a-i.1.2?q=  ",
  ];
  for (const link of ataques) {
    ultimaQuery = null;
    await chamar({ link });
    if (ultimaQuery === null) continue;
    const m = ultimaQuery.match(/^mutation\{generateShortLink\(input:\{originUrl:("(?:[^"\\]|\\.)*"),subIds:\["site"\]\}\)\{shortLink\}\}$/);
    assert.ok(m, `query alterada: ${ultimaQuery}`);
    assert.ok(new URL(JSON.parse(m[1])).hostname.endsWith("shopee.com.br"));
  }
});

// ---------- Link curto / SSRF ----------

test("segue redirect do link curto e limpa parâmetros de rastreio", async () => {
  rotas["https://br.shp.ee/abc"] = "https://shopee.com.br/Produto-i.123.456?smtt=0.0.9&utm_source=outro&mmp_pid=x";
  const r = await chamar({ link: "https://br.shp.ee/abc" });
  assert.equal(r.status, 200);
  assert.ok(ultimaQuery.includes('originUrl:"https://shopee.com.br/Produto-i.123.456"'), ultimaQuery);
});

test("formato novo /product/<loja>/<item> também é reconhecido", async () => {
  rotas["https://br.shp.ee/novo"] = "https://shopee.com.br/product/123/456?x=1";
  await chamar({ link: "https://br.shp.ee/novo" });
  assert.ok(ultimaQuery.includes('originUrl:"https://shopee.com.br/product/123/456"'), ultimaQuery);
});

test("sem redirect (Shopee via JavaScript) manda o link curto original", async () => {
  const r = await chamar({ link: "https://br.shp.ee/js" });
  assert.equal(r.status, 200);
  assert.ok(ultimaQuery.includes('originUrl:"https://br.shp.ee/js"'));
});

test("SSRF: nunca segue redirect para fora da Shopee", async () => {
  const destinos = [
    "http://169.254.169.254/latest/meta-data/",
    "http://localhost:3000/admin",
    "https://evil.com/a-i.1.2",
    "http://shopee.com.br/a-i.1.2",
    "https://shopee.com.br:8080/a-i.1.2",
    "https://shopee.com.br.evil.com/a-i.1.2",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "//evil.com/a-i.1.2",
  ];
  for (const destino of destinos) {
    chamadas = [];
    rotas = { "https://br.shp.ee/r": destino };
    const r = await chamar({ link: "https://br.shp.ee/r" });
    assert.equal(r.status, 200, destino);
    for (const url of chamadas) {
      const host = new URL(url).hostname;
      assert.ok(host === "br.shp.ee" || host === "open-api.affiliate.shopee.com.br", `acessou ${url} (destino ${destino})`);
    }
    assert.ok(ultimaQuery.includes('originUrl:"https://br.shp.ee/r"'), destino);
  }
});

test("redirect em loop para após 5 saltos", async () => {
  rotas["https://br.shp.ee/a"] = "https://br.shp.ee/b";
  rotas["https://br.shp.ee/b"] = "https://br.shp.ee/a";
  const r = await chamar({ link: "https://br.shp.ee/a" });
  assert.equal(r.status, 200);
  assert.equal(chamadas.filter((u) => u.includes("shp.ee")).length, 5);
});

test("link curto que trava não segura o Worker (timeout)", async () => {
  rotas["https://br.shp.ee/lento"] = "trava";
  const inicio = Date.now();
  // O timer do AbortSignal.timeout não segura o processo vivo sozinho; numa conexão real, o socket segura.
  const manterVivo = setInterval(() => {}, 100);
  const r = await chamar({ link: "https://br.shp.ee/lento" }).finally(() => clearInterval(manterVivo));
  assert.equal(r.status, 200);
  assert.ok(Date.now() - inicio < 6000);
});

// ---------- Respostas da Shopee ----------

test("erro da Shopee vira mensagem genérica (sem detalhes da conta)", async () => {
  respostaShopee = () => ({ errors: [{ message: "Invalid Credential: APPID_DE_TESTE_123 assinatura errada", extensions: { code: 10020 } }] });
  const r = await chamar({ link: "https://shopee.com.br/a-i.1.2" });
  assert.equal(r.status, 400);
  assert.ok(!r.corpo.erro.includes("Invalid Credential"));
  semSegredos(r);
});

test("link devolvido que não é da Shopee nunca chega ao navegador", async () => {
  for (const link of ["javascript:alert(document.cookie)", "https://evil.com/x", "http://s.shopee.com.br/x", "data:text/html,<script>alert(1)</script>"]) {
    respostaShopee = () => ({ data: { generateShortLink: { shortLink: link } } });
    const r = await chamar({ link: "https://shopee.com.br/a-i.1.2" });
    assert.equal(r.status, 400, link);
    assert.equal(r.corpo.link, undefined);
  }
});

test("falha de rede ou resposta não-JSON da Shopee: 500 genérico", async () => {
  respostaShopee = () => new Error("ECONNRESET 10.1.2.3 SEGREDO_DE_TESTE_456");
  let r = await chamar({ link: "https://shopee.com.br/a-i.1.2" });
  assert.equal(r.status, 500);
  semSegredos(r);

  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async () => new Response("<html>erro</html>", { status: 502 });
  try {
    r = await chamar({ link: "https://shopee.com.br/a-i.1.2" });
  } finally {
    globalThis.fetch = fetchOriginal;
  }
  assert.equal(r.status, 500);
  semSegredos(r);
});

test("sem credenciais configuradas: erro claro, sem chamar a Shopee", async () => {
  const r = await chamar({ link: "https://shopee.com.br/a-i.1.2", env: { SHOPEE_APP_ID: undefined } });
  assert.equal(r.status, 500);
  assert.equal(chamadas.length, 0);
});

// ---------- Limite por IP ----------

test("limite de 15 pedidos por IP a cada 10 minutos", async () => {
  const ip = "203.0.113.7";
  for (let i = 1; i <= 15; i++) {
    assert.equal((await chamar({ link: "https://shopee.com.br/a-i.1.2", ip })).status, 200, `pedido ${i}`);
  }
  assert.equal((await chamar({ link: "https://shopee.com.br/a-i.1.2", ip })).status, 429);
  assert.equal((await chamar({ link: "https://shopee.com.br/a-i.1.2", ip: "203.0.113.8" })).status, 200);
});

test("pedidos inválidos também contam no limite", async () => {
  const ip = "203.0.113.50";
  for (let i = 0; i < 15; i++) await chamar({ link: "lixo", ip });
  assert.equal((await chamar({ link: "lixo", ip })).status, 429);
});

test("limitador da Cloudflare (LIMITADOR) é consultado com o IP do visitante", async () => {
  const chaves = [];
  const LIMITADOR = { limit: async ({ key }) => (chaves.push(key), { success: false }) };
  const r = await chamar({ link: "https://shopee.com.br/a-i.1.2", ip: "198.51.100.77", env: { LIMITADOR } });
  assert.equal(r.status, 429);
  assert.deepEqual(chaves, ["198.51.100.77"]);
  assert.equal(chamadas.length, 0);
});

test("X-Forwarded-For falso não muda o IP considerado", async () => {
  const ip = "198.51.100.1";
  for (let i = 0; i < 15; i++) await chamar({ link: "lixo", ip, headers: { "x-forwarded-for": `1.2.3.${i}` } });
  assert.equal((await chamar({ link: "lixo", ip, headers: { "x-forwarded-for": "9.9.9.9" } })).status, 429);
});

test("memória do limitador não cresce sem fim", async () => {
  for (let i = 0; i < 6000; i++) await chamar({ link: "lixo", ip: `172.16.${i >> 8}.${i & 255}` });
  assert.ok(true);
});
