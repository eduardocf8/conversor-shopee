// ============================================================
//  BACKEND SEGURO — roda no servidor da Vercel.
//  O visitante NUNCA vê este arquivo, então a Secret fica protegida.
//  Suas credenciais NÃO ficam aqui — ficam nas "Environment Variables"
//  da Vercel (te explico no passo a passo).
// ============================================================

const crypto = require("crypto");

module.exports = async (req, res) => {
  // Só aceita POST
  if (req.method !== "POST") {
    return res.status(405).json({ erro: "Método não permitido" });
  }

  // Pega o link que a pessoa colou no site
  const linkOriginal = (req.body && req.body.link ? req.body.link : "").trim();

  if (!linkOriginal || !linkOriginal.includes("shopee")) {
    return res.status(400).json({ erro: "Cole um link válido da Shopee." });
  }

  // Credenciais vêm das variáveis de ambiente da Vercel (seguras)
  const APP_ID = process.env.SHOPEE_APP_ID;
  const SECRET = process.env.SHOPEE_SECRET;
  const SUB_ID = process.env.SHOPEE_SUB_ID || "site"; // rótulo p/ rastrear

  if (!APP_ID || !SECRET) {
    return res.status(500).json({ erro: "Credenciais não configuradas no servidor." });
  }

  // Monta a requisição GraphQL para gerar o link curto de afiliado
  const query = `mutation{generateShortLink(input:{originUrl:"${linkOriginal}",subIds:["${SUB_ID}"]}){shortLink}}`;
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
    });

    const dados = await resposta.json();

    // Trata erros vindos da Shopee
    if (dados.errors && dados.errors.length) {
      return res.status(400).json({ erro: dados.errors[0].message || "Erro na Shopee." });
    }

    const linkConvertido =
      dados &&
      dados.data &&
      dados.data.generateShortLink &&
      dados.data.generateShortLink.shortLink;

    if (!linkConvertido) {
      return res.status(400).json({ erro: "Não foi possível gerar o link. Confira se o link do produto está correto." });
    }

    return res.status(200).json({ link: linkConvertido });
  } catch (e) {
    return res.status(500).json({ erro: "Falha ao contatar a Shopee. Tente de novo." });
  }
};
