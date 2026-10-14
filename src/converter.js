// ============================================================
//  CONVERSOR — roda no servidor da Cloudflare (Worker).
//  O visitante NUNCA vê este arquivo, então a Secret fica protegida.
//  As credenciais NÃO ficam aqui — ficam nos "Secrets" do Worker,
//  no painel da Cloudflare (ver GUIA.md).
// ============================================================

// Domínios aceitos. O link precisa ser de um desses (ou subdomínio deles) —
// não basta ter "shopee" escrito em qualquer lugar.
const DOMINIOS_SHOPEE = ["shopee.com.br", "shp.ee"];
const DOMINIOS_LINK_CURTO = ["shp.ee", "s.shopee.com.br"];

// Produto da Shopee aparece em dois formatos: .../nome-i.<loja>.<item> ou /product/<loja>/<item>
const PADRAO_PRODUTO = /-i\.\d+\.\d+|\/product\/\d+\/\d+/;

const TAMANHO_MAXIMO_CORPO = 8 * 1024;
const TAMANHO_MAXIMO_TEXTO = 2000;

// Limite de uso por IP: no máximo LIMITE_PEDIDOS conversões a cada JANELA_MS.
// Fica na memória do Worker, então é "melhor esforço": cada instância tem o seu
// contador. Somado ao limitador da Cloudflare (LIMITADOR, por minuto), barra robô
// e abuso simples, não um ataque distribuído.
const LIMITE_PEDIDOS = 15;
const JANELA_MS = 10 * 60 * 1000;
const pedidosPorIp = new Map();

function passouDoLimite(ip) {
  const agora = Date.now();
  const recentes = (pedidosPorIp.get(ip) || []).filter((t) => agora - t < JANELA_MS);
  recentes.push(agora);
  pedidosPorIp.set(ip, recentes);

  // Faxina pra memória não crescer sem fim
  if (pedidosPorIp.size > 5000) {
    for (const [chave, tempos] of pedidosPorIp) {
      if (!tempos.some((t) => agora - t < JANELA_MS)) pedidosPorIp.delete(chave);
    }
  }

  return recentes.length > LIMITE_PEDIDOS;
}

function ehDoDominio(host, dominios) {
  host = host.toLowerCase();
  return dominios.some((d) => host === d || host.endsWith("." + d));
}

function responder(status, corpo, extras = {}) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      ...extras,
    },
  });
}

// O botão "compartilhar" do app manda texto junto ("Confira esse produto... https://br.shp.ee/xyz").
// Pega só o primeiro link da Shopee que aparecer no que foi colado.
function extrairLinkShopee(texto) {
  const candidatos = texto.match(/https?:\/\/[^\s"'<>]+/gi) || [texto];
  for (const candidato of candidatos) {
    try {
      const url = new URL(candidato);
      if ((url.protocol === "https:" || url.protocol === "http:") && !url.port && !url.username && ehDoDominio(url.hostname, DOMINIOS_SHOPEE)) {
        return url;
      }
    } catch (e) {
      // não é URL, tenta o próximo
    }
  }
  return null;
}

// Só devolve pro navegador um link https da própria Shopee
function ehLinkShopeeSeguro(link) {
  try {
    const url = new URL(link);
    return url.protocol === "https:" && ehDoDominio(url.hostname, DOMINIOS_SHOPEE);
  } catch (e) {
    return false;
  }
}

// Tenta descobrir o link completo do produto por trás de um link curto (br.shp.ee).
// Segue os redirects um por um, só dentro de domínios da Shopee, com tempo curto.
// Se não der (a Shopee às vezes só redireciona via JavaScript no navegador),
// devolve null e o link curto original é mandado direto pra API.
async function resolverLinkCurto(url) {
  let atual = url;
  const limite = Date.now() + 4000;

  for (let i = 0; i < 5; i++) {
    let resposta;
    try {
      resposta = await fetch(atual.href, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(Math.max(500, limite - Date.now())),
        headers: {
          "User-Agent": "Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "pt-BR,pt;q=0.9",
        },
      });
    } catch (e) {
      return null;
    }

    const destino = resposta.headers.get("location");
    if (resposta.status < 300 || resposta.status >= 400 || !destino) return null;

    let proximo;
    try {
      proximo = new URL(destino, atual);
    } catch (e) {
      return null;
    }
    if (proximo.protocol !== "https:" || proximo.port || !ehDoDominio(proximo.hostname, DOMINIOS_SHOPEE)) {
      return null;
    }

    if (PADRAO_PRODUTO.test(proximo.pathname)) {
      // Só o endereço do produto, sem os parâmetros de rastreio de quem gerou o link curto
      return `${proximo.origin}${proximo.pathname}`;
    }
    atual = proximo;
  }
  return null;
}

// Pedido feito por outro site (ex: um site malicioso disparando conversões pelo
// navegador de quem o visita). Pedidos sem Origin (curl, servidores) não dá pra
// barrar por aqui — pra esses existe o limite por IP.
function veioDeOutroSite(request) {
  const origem = request.headers.get("origin");
  if (!origem) return false;
  try {
    return new URL(origem).host !== new URL(request.url).host;
  } catch (e) {
    return true;
  }
}

// Lê o corpo sem aceitar mais que `maximo` bytes (não confia no Content-Length)
async function lerCorpoLimitado(request, maximo) {
  if (Number(request.headers.get("content-length") || 0) > maximo) return null;
  if (!request.body) return "";
  const leitor = request.body.getReader();
  const partes = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximo) {
      await leitor.cancel();
      return null;
    }
    partes.push(value);
  }
  const junto = new Uint8Array(total);
  let pos = 0;
  for (const parte of partes) {
    junto.set(parte, pos);
    pos += parte.byteLength;
  }
  return new TextDecoder().decode(junto);
}

async function sha256Hex(texto) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function tratarConversao(request, env) {
  // Só aceita POST
  if (request.method !== "POST") {
    return responder(405, { erro: "Método não permitido" }, { Allow: "POST" });
  }

  // IP do visitante, colocado pela própria Cloudflare (não dá pra falsificar)
  const ip = request.headers.get("cf-connecting-ip") || "desconhecido";
  if (passouDoLimite(ip)) {
    return responder(429, { erro: "Muitos links em pouco tempo. Espere alguns minutos e tente de novo." });
  }
  if (env.LIMITADOR) {
    const { success } = await env.LIMITADOR.limit({ key: ip });
    if (!success) {
      return responder(429, { erro: "Muitos links em pouco tempo. Espere alguns minutos e tente de novo." });
    }
  }

  if (veioDeOutroSite(request)) {
    return responder(403, { erro: "Origem não permitida." });
  }

  // Só JSON: um formulário de outro site não consegue mandar JSON sem a
  // permissão do navegador (CORS), que este endpoint nunca dá.
  if (!(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) {
    return responder(415, { erro: "Formato não suportado." });
  }

  const bruto = await lerCorpoLimitado(request, TAMANHO_MAXIMO_CORPO);
  if (bruto === null) {
    return responder(413, { erro: "Texto grande demais. Cole só o link do produto." });
  }
  let corpo;
  try {
    corpo = JSON.parse(bruto);
  } catch (e) {
    return responder(400, { erro: "Cole um link válido da Shopee." });
  }

  // Aceita tanto o link completo (shopee.com.br) quanto o encurtado (shp.ee),
  // mesmo que venha com texto junto
  const textoColado = (corpo && typeof corpo.link === "string" ? corpo.link : "").trim().slice(0, TAMANHO_MAXIMO_TEXTO);
  const url = textoColado && extrairLinkShopee(textoColado);
  if (!url) {
    return responder(400, { erro: "Cole um link válido da Shopee." });
  }

  // Credenciais vêm dos Secrets do Worker (seguros)
  const APP_ID = env.SHOPEE_APP_ID;
  const SECRET = env.SHOPEE_SECRET;
  const SUB_ID = env.SUB_ID || "site"; // rótulo p/ rastrear

  if (!APP_ID || !SECRET) {
    return responder(500, { erro: "Credenciais não configuradas no servidor." });
  }

  let linkOriginal = url.href;
  if (ehDoDominio(url.hostname, DOMINIOS_LINK_CURTO)) {
    linkOriginal = (await resolverLinkCurto(url)) || linkOriginal;
  }

  // Monta a requisição GraphQL para gerar o link curto de afiliado.
  // JSON.stringify escapa aspas/barras do link, pra ninguém conseguir quebrar ou alterar a query.
  const query = `mutation{generateShortLink(input:{originUrl:${JSON.stringify(linkOriginal)},subIds:[${JSON.stringify(SUB_ID)}]}){shortLink}}`;
  const payload = JSON.stringify({ query });

  const timestamp = Math.floor(Date.now() / 1000);

  // Assinatura exigida pela Shopee: SHA256(AppId + Timestamp + Payload + Secret)
  const signature = await sha256Hex(`${APP_ID}${timestamp}${payload}${SECRET}`);
  const authHeader = `SHA256 Credential=${APP_ID}, Timestamp=${timestamp}, Signature=${signature}`;

  try {
    const resposta = await fetch("https://open-api.affiliate.shopee.com.br/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": authHeader,
      },
      body: payload,
      signal: AbortSignal.timeout(10000),
    });

    const dados = await resposta.json();

    // Trata erros vindos da Shopee. O detalhe fica só no log do Worker — pro visitante
    // vai uma mensagem genérica, sem expor nada sobre as credenciais/conta.
    if (dados.errors && dados.errors.length) {
      console.error("[converter] erro da Shopee para", linkOriginal, JSON.stringify(dados.errors));
      return responder(400, { erro: "A Shopee não conseguiu gerar o link desse produto. Confira o link e tente de novo." });
    }

    const linkConvertido =
      dados &&
      dados.data &&
      dados.data.generateShortLink &&
      dados.data.generateShortLink.shortLink;

    if (!linkConvertido || !ehLinkShopeeSeguro(linkConvertido)) {
      return responder(400, { erro: "Não foi possível gerar o link. Se você colou um link curto (br.shp.ee), tente abrir ele e copiar o link completo do produto que aparece no navegador." });
    }

    return responder(200, { link: linkConvertido });
  } catch (e) {
    console.error("[converter] falha ao contatar a Shopee:", e && e.message);
    return responder(500, { erro: "Falha ao contatar a Shopee. Tente de novo." });
  }
}
