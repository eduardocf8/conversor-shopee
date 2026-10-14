// ============================================================
//  BACKEND SEGURO — roda no servidor da Vercel.
//  O visitante NUNCA vê este arquivo, então a Secret fica protegida.
//  Suas credenciais NÃO ficam aqui — ficam nas "Environment Variables"
//  da Vercel (te explico no passo a passo).
// ============================================================

const crypto = require("crypto");

// Domínios aceitos. O link precisa ser de um desses (ou subdomínio deles) —
// não basta ter "shopee" escrito em qualquer lugar.
const DOMINIOS_SHOPEE = ["shopee.com.br", "shp.ee"];
const DOMINIOS_LINK_CURTO = ["shp.ee", "s.shopee.com.br"];

// Produto da Shopee aparece em dois formatos: .../nome-i.<loja>.<item> ou /product/<loja>/<item>
const PADRAO_PRODUTO = /-i\.\d+\.\d+|\/product\/\d+\/\d+/;

// Limite de uso por IP: no máximo LIMITE_PEDIDOS conversões a cada JANELA_MS.
// Fica na memória da função, então é "melhor esforço": cada instância da Vercel
// tem o seu contador. Barra robô e abuso simples, não um ataque distribuído.
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

function pegarIp(req) {
  const encaminhado = req.headers["x-forwarded-for"];
  if (encaminhado) return String(encaminhado).split(",")[0].trim();
  return req.headers["x-real-ip"] || (req.socket && req.socket.remoteAddress) || "desconhecido";
}

function ehDoDominio(host, dominios) {
  host = host.toLowerCase();
  return dominios.some((d) => host === d || host.endsWith("." + d));
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
function veioDeOutroSite(req) {
  const origem = req.headers.origin;
  if (!origem) return false;
  try {
    return new URL(origem).host !== req.headers.host;
  } catch (e) {
    return true;
  }
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

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  // Só aceita POST
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ erro: "Método não permitido" });
  }

  if (veioDeOutroSite(req)) {
    return res.status(403).json({ erro: "Origem não permitida." });
  }

  // Só JSON: um formulário de outro site não consegue mandar JSON sem a
  // permissão do navegador (CORS), que este endpoint nunca dá.
  if (!String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
    return res.status(415).json({ erro: "Formato não suportado." });
  }

  if (passouDoLimite(pegarIp(req))) {
    return res.status(429).json({ erro: "Muitos links em pouco tempo. Espere alguns minutos e tente de novo." });
  }

  // Pega o que a pessoa colou no site (JSON malformado faz o req.body da Vercel lançar erro)
  let corpo;
  try {
    corpo = req.body;
  } catch (e) {
    return res.status(400).json({ erro: "Cole um link válido da Shopee." });
  }
  const textoColado = (corpo && typeof corpo.link === "string" ? corpo.link : "").trim().slice(0, 2000);

  // Aceita tanto o link completo (shopee.com.br) quanto o encurtado (shp.ee),
  // mesmo que venha com texto junto
  const url = textoColado && extrairLinkShopee(textoColado);
  if (!url) {
    return res.status(400).json({ erro: "Cole um link válido da Shopee." });
  }

  // Credenciais vêm das variáveis de ambiente da Vercel (seguras)
  const APP_ID = process.env.SHOPEE_APP_ID;
  const SECRET = process.env.SHOPEE_SECRET;
  const SUB_ID = process.env.SHOPEE_SUB_ID || "site"; // rótulo p/ rastrear

  if (!APP_ID || !SECRET) {
    return res.status(500).json({ erro: "Credenciais não configuradas no servidor." });
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
  const baseString = `${APP_ID}${timestamp}${payload}${SECRET}`;
  const signature = crypto.createHash("sha256").update(baseString).digest("hex");

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

    // Trata erros vindos da Shopee. O detalhe fica só no log da Vercel — pro visitante
    // vai uma mensagem genérica, sem expor nada sobre as credenciais/conta.
    if (dados.errors && dados.errors.length) {
      console.error("[converter] erro da Shopee para", linkOriginal, JSON.stringify(dados.errors));
      return res.status(400).json({ erro: "A Shopee não conseguiu gerar o link desse produto. Confira o link e tente de novo." });
    }

    const linkConvertido =
      dados &&
      dados.data &&
      dados.data.generateShortLink &&
      dados.data.generateShortLink.shortLink;

    if (!linkConvertido || !ehLinkShopeeSeguro(linkConvertido)) {
      return res.status(400).json({ erro: "Não foi possível gerar o link. Se você colou um link curto (br.shp.ee), tente abrir ele e copiar o link completo do produto que aparece no navegador." });
    }

    return res.status(200).json({ link: linkConvertido });
  } catch (e) {
    return res.status(500).json({ erro: "Falha ao contatar a Shopee. Tente de novo." });
  }
};
