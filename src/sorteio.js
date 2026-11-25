// ============================================================
//  SORTEIO — inscrições de quem comprou pelo link do cliente.
//  Guarda nome, número do pedido e WhatsApp num banco D1 da
//  Cloudflare (binding SORTEIO_DB). A exportação e a limpeza
//  ficam atrás da senha SORTEIO_SENHA (Secret do projeto).
//  Nada de dado pessoal vai para os logs.
// ============================================================

import { responder, veioDeOutroSite, lerCorpoLimitado } from "./converter.js";

const TAMANHO_MAXIMO_CORPO = 4 * 1024;
const TAMANHO_MINIMO_SENHA = 12;

// Limites por IP, na memória do Worker (melhor esforço, como no conversor)
const LIMITE_INSCRICOES = 10; // por IP a cada 10 min
const LIMITE_SENHA_ERRADA = 5; // tentativas erradas por IP a cada 15 min
const tentativas = { inscricao: new Map(), senha: new Map() };

function contarELimitar(mapa, ip, limite, janelaMs, registrar = true) {
  const agora = Date.now();
  const recentes = (mapa.get(ip) || []).filter((t) => agora - t < janelaMs);
  if (registrar) recentes.push(agora);
  mapa.set(ip, recentes);
  if (mapa.size > 5000) {
    for (const [chave, tempos] of mapa) {
      if (!tempos.some((t) => agora - t < janelaMs)) mapa.delete(chave);
    }
  }
  return recentes.length > limite;
}

const ipDe = (request) => request.headers.get("cf-connecting-ip") || "desconhecido";

// ---------- Validação (a mesma regra roda no navegador, em app.js) ----------

export function normalizarNome(nome) {
  return String(nome || "").trim().replace(/\s+/g, " ");
}

export function nomeValido(nome) {
  const partes = nome.split(" ").filter(Boolean);
  return nome.length >= 5 && nome.length <= 80 && partes.length >= 2 && /^[\p{L}\s'.-]+$/u.test(nome);
}

export function normalizarPedido(pedido) {
  return String(pedido || "").toUpperCase().replace(/[\s#-]/g, "");
}

export function pedidoValido(pedido) {
  return /^[A-Z0-9]{10,20}$/.test(pedido);
}

export function normalizarWhatsapp(whatsapp) {
  return String(whatsapp || "").replace(/\D/g, "");
}

// Celular brasileiro: DDD (dois dígitos de 1 a 9) + 9 + oito dígitos = 11 números
export function whatsappValido(numeros) {
  return /^[1-9][1-9]9\d{8}$/.test(numeros);
}

export function formatarWhatsapp(numeros) {
  return `(${numeros.slice(0, 2)}) ${numeros.slice(2, 7)}-${numeros.slice(7)}`;
}

// ---------- Banco ----------

const CRIAR_TABELA = `CREATE TABLE IF NOT EXISTS inscricoes (
  pedido TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  whatsapp TEXT NOT NULL,
  criado_em TEXT NOT NULL
)`;

async function garantirTabela(db) {
  await db.prepare(CRIAR_TABELA).run();
}

// ---------- Inscrição (POST /api/sorteio) ----------

export async function tratarInscricao(request, env) {
  if (request.method !== "POST") {
    return responder(405, { erro: "Método não permitido" }, { Allow: "POST" });
  }
  if (contarELimitar(tentativas.inscricao, ipDe(request), LIMITE_INSCRICOES, 10 * 60 * 1000)) {
    return responder(429, { erro: "Muitas tentativas em pouco tempo. Espere alguns minutos e tente de novo." });
  }
  if (veioDeOutroSite(request)) {
    return responder(403, { erro: "Origem não permitida." });
  }
  if (!(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) {
    return responder(415, { erro: "Formato não suportado." });
  }
  if (!env.SORTEIO_DB) {
    return responder(503, { erro: "As inscrições ainda não estão abertas." });
  }

  const bruto = await lerCorpoLimitado(request, TAMANHO_MAXIMO_CORPO);
  if (bruto === null) return responder(413, { erro: "Dados grandes demais." });
  let corpo;
  try {
    corpo = JSON.parse(bruto);
  } catch (e) {
    return responder(400, { erro: "Confira os dados e tente de novo." });
  }
  if (!corpo || typeof corpo !== "object") return responder(400, { erro: "Confira os dados e tente de novo." });

  // Campo escondido: só robô preenche
  if (corpo.site) return responder(200, { ok: true });

  const nome = normalizarNome(corpo.nome);
  const pedido = normalizarPedido(corpo.pedido);
  const whatsapp = normalizarWhatsapp(corpo.whatsapp);

  if (!nomeValido(nome)) return responder(400, { erro: "Digite seu nome completo (nome e sobrenome).", campo: "nome" });
  if (!pedidoValido(pedido)) return responder(400, { erro: "Confira o número do pedido: ele tem letras e números, sem espaços.", campo: "pedido" });
  if (!whatsappValido(whatsapp)) return responder(400, { erro: "Digite o celular com DDD: (xx) 9xxxx-xxxx.", campo: "whatsapp" });
  if (corpo.aceite !== true) return responder(400, { erro: "Marque a autorização para participar.", campo: "aceite" });

  try {
    await garantirTabela(env.SORTEIO_DB);
    await env.SORTEIO_DB
      .prepare("INSERT INTO inscricoes (pedido, nome, whatsapp, criado_em) VALUES (?, ?, ?, ?)")
      .bind(pedido, nome, formatarWhatsapp(whatsapp), new Date().toISOString())
      .run();
  } catch (e) {
    if (/UNIQUE|PRIMARY KEY|constraint/i.test(String(e && e.message))) {
      return responder(409, { erro: "Esse pedido já está participando do sorteio.", campo: "pedido" });
    }
    console.error("[sorteio] falha ao gravar inscrição:", e && e.message);
    return responder(500, { erro: "Não consegui salvar agora. Tente de novo em instantes." });
  }
  return responder(200, { ok: true, pedido });
}

// ---------- Área do dono (POST /api/sorteio-admin) ----------

async function sha256(texto) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto)));
}

async function senhaConfere(digitada, correta) {
  const [a, b] = await Promise.all([sha256(String(digitada || "")), sha256(correta)]);
  let diferenca = 0;
  for (let i = 0; i < a.length; i++) diferenca |= a[i] ^ b[i];
  return diferenca === 0;
}

// Evita que um nome tipo "=SOMA(...)" vire fórmula ao abrir no Excel
function celulaCsv(valor) {
  let texto = String(valor ?? "");
  if (/^[=+\-@\t\r]/.test(texto)) texto = "'" + texto;
  return `"${texto.replace(/"/g, '""')}"`;
}

export function gerarCsv(linhas) {
  const cabecalho = ["Nome", "Número do pedido", "WhatsApp", "Inscrito em"];
  const corpo = linhas.map((l) => {
    const data = new Date(l.criado_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    return [l.nome, l.pedido, l.whatsapp, data].map(celulaCsv).join(";");
  });
  // BOM + ";" para o Excel em português abrir com acentos e colunas certas
  return "﻿" + [cabecalho.map(celulaCsv).join(";"), ...corpo].join("\r\n") + "\r\n";
}

export async function tratarAdmin(request, env) {
  if (request.method !== "POST") {
    return responder(405, { erro: "Método não permitido" }, { Allow: "POST" });
  }
  const ip = ipDe(request);
  if (contarELimitar(tentativas.senha, ip, LIMITE_SENHA_ERRADA - 1, 15 * 60 * 1000, false)) {
    return responder(429, { erro: "Muitas senhas erradas. Espere 15 minutos." });
  }
  if (veioDeOutroSite(request)) return responder(403, { erro: "Origem não permitida." });
  if (!(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) {
    return responder(415, { erro: "Formato não suportado." });
  }
  if (!env.SORTEIO_SENHA || env.SORTEIO_SENHA.length < TAMANHO_MINIMO_SENHA) {
    return responder(503, { erro: `A senha da área do sorteio ainda não foi cadastrada (mínimo de ${TAMANHO_MINIMO_SENHA} caracteres).` });
  }
  if (!env.SORTEIO_DB) return responder(503, { erro: "O banco do sorteio não está ligado a este site." });

  const bruto = await lerCorpoLimitado(request, TAMANHO_MAXIMO_CORPO);
  let corpo;
  try {
    corpo = JSON.parse(bruto || "");
  } catch (e) {
    return responder(400, { erro: "Pedido inválido." });
  }
  if (!corpo || typeof corpo !== "object") return responder(400, { erro: "Pedido inválido." });

  if (!(await senhaConfere(corpo.senha, env.SORTEIO_SENHA))) {
    contarELimitar(tentativas.senha, ip, LIMITE_SENHA_ERRADA, 15 * 60 * 1000);
    return responder(401, { erro: "Senha errada." });
  }

  await garantirTabela(env.SORTEIO_DB);

  if (corpo.acao === "contar") {
    const linha = await env.SORTEIO_DB.prepare("SELECT COUNT(*) AS total FROM inscricoes").first();
    return responder(200, { total: Number(linha && linha.total) || 0 });
  }
  if (corpo.acao === "exportar") {
    const { results } = await env.SORTEIO_DB.prepare("SELECT nome, pedido, whatsapp, criado_em FROM inscricoes ORDER BY criado_em").all();
    return new Response(gerarCsv(results || []), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="inscricoes-sorteio.csv"',
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  if (corpo.acao === "apagar") {
    if (corpo.confirmacao !== "APAGAR") {
      return responder(400, { erro: 'Para apagar, digite APAGAR no campo de confirmação.' });
    }
    await env.SORTEIO_DB.prepare("DELETE FROM inscricoes").run();
    return responder(200, { ok: true, total: 0 });
  }
  return responder(400, { erro: "Ação desconhecida." });
}
