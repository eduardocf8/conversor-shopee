#!/usr/bin/env node
// Monta o site de um cliente a partir do modelo.
//
//   node scripts/montar.js <cliente>             -> gera dist/<cliente>/
//   node scripts/montar.js <cliente> --publicar  -> idem, exigindo account_id (usado no deploy)
//
// Lê clientes/<cliente>/config.json e clientes/<cliente>/foto.jpg, valida tudo
// e escreve em dist/<cliente>/:
//   public/          a página
//   wrangler.jsonc   configuração da Cloudflare
//   functions/       (só no tipo "pages") o conversor como Pages Function
//   publicar.json    conta, tipo, nome e account_id, lidos pelo workflow de publicação

const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..");
const TAMANHO_MAXIMO_FOTO = 1024 * 1024;

class ConfigInvalida extends Error {}

const texto = (min, max) => (v, campo) => {
  if (typeof v !== "string") throw new ConfigInvalida(`"${campo}" precisa ser um texto.`);
  const n = [...v].length;
  if (n < min || n > max) throw new ConfigInvalida(`"${campo}" precisa ter entre ${min} e ${max} caracteres (tem ${n}).`);
};
const padrao = (regex, explicacao) => (v, campo) => {
  if (typeof v !== "string" || !regex.test(v)) throw new ConfigInvalida(`"${campo}" inválido: ${explicacao}.`);
};
const booleano = (v, campo) => {
  if (typeof v !== "boolean") throw new ConfigInvalida(`"${campo}" precisa ser true ou false.`);
};
const cor = padrao(/^#[0-9a-fA-F]{6}$/, "use uma cor no formato #RRGGBB, ex: #ee4d2d");

const ESQUEMA = {
  nome: texto(1, 60),
  titulo: texto(1, 80),
  subtitulo: texto(0, 120),
  descricao: texto(0, 200),
  texto_botao: texto(1, 40),
  mostrar_faixa_cupons: booleano,
  texto_faixa_cupons: texto(0, 80),
  cores: { principal: cor, escura: cor, fundo: cor },
  sub_id: padrao(/^[A-Za-z0-9]{1,100}$/, "só letras sem acento e números (exigência da Shopee)"),
  cloudflare: {
    conta: padrao(/^(?:clientes|pessoal)$/, 'use "clientes" (conta Cloudflare dos clientes) ou "pessoal" (sua conta)'),
    tipo: padrao(/^(?:pages|workers)$/, 'use "pages" (endereço nome.pages.dev) ou "workers" (nome.<conta>.workers.dev)'),
    nome_projeto: padrao(/^[a-z0-9](?:[a-z0-9-]{0,56}[a-z0-9])?$/, "só letras minúsculas, números e hífen, até 58 caracteres (vira o endereço do site)"),
    account_id: padrao(/^(?:[0-9a-f]{32})?$/, "copie o Account ID do painel da Cloudflare (32 letras/números)"),
  },
};

function validar(obj, esquema, prefixo = "") {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    throw new ConfigInvalida(`"${prefixo || "config"}" precisa ser um objeto { }.`);
  }
  for (const chave of Object.keys(obj)) {
    if (!(chave in esquema)) throw new ConfigInvalida(`Campo desconhecido "${prefixo}${chave}" (erro de digitação?).`);
  }
  for (const [chave, regra] of Object.entries(esquema)) {
    const campo = prefixo + chave;
    if (!(chave in obj)) throw new ConfigInvalida(`Falta o campo "${campo}".`);
    if (typeof regra === "function") regra(obj[chave], campo);
    else validar(obj[chave], regra, campo + ".");
  }
}

function escaparHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function lerConfig(cliente, raiz = RAIZ) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(cliente || "")) {
    throw new ConfigInvalida(`Nome de cliente inválido: "${cliente}". Use o nome da pasta em clientes/ (letras minúsculas, números e hífen).`);
  }
  const pasta = path.join(raiz, "clientes", cliente);
  const arquivo = path.join(pasta, "config.json");
  if (!fs.existsSync(arquivo)) throw new ConfigInvalida(`Não achei ${path.relative(raiz, arquivo)}.`);
  let config;
  try {
    config = JSON.parse(fs.readFileSync(arquivo, "utf8"));
  } catch (e) {
    throw new ConfigInvalida(`config.json não é um JSON válido: ${e.message}`);
  }
  validar(config, ESQUEMA);
  if (config.mostrar_faixa_cupons && !config.texto_faixa_cupons.trim()) {
    throw new ConfigInvalida(`"texto_faixa_cupons" não pode ficar vazio com a faixa ligada.`);
  }

  const foto = path.join(pasta, "foto.jpg");
  if (!fs.existsSync(foto)) throw new ConfigInvalida(`Falta a foto: ${path.relative(raiz, foto)}.`);
  const bytes = fs.readFileSync(foto);
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    throw new ConfigInvalida("foto.jpg não é um JPEG de verdade (converta a imagem pra JPG).");
  }
  if (bytes.length > TAMANHO_MAXIMO_FOTO) {
    throw new ConfigInvalida(`foto.jpg tem ${(bytes.length / 1024 / 1024).toFixed(1)} MB; reduza pra menos de 1 MB (ex: 400x400 px).`);
  }
  return { config, foto: bytes };
}

function gerarHtml(modelo, config) {
  let html = modelo.replace(/<!--FAIXA_CUPONS-->\n?([\s\S]*?)<!--\/FAIXA_CUPONS-->\n?/, config.mostrar_faixa_cupons ? "$1" : "");
  const valores = {
    NOME: config.nome,
    TITULO: config.titulo,
    SUBTITULO: config.subtitulo,
    DESCRICAO: config.descricao,
    TEXTO_BOTAO: config.texto_botao,
    TEXTO_FAIXA_CUPONS: config.texto_faixa_cupons,
    COR_PRINCIPAL: config.cores.principal,
    COR_ESCURA: config.cores.escura,
    COR_FUNDO: config.cores.fundo,
  };
  html = html.replace(/\{\{([A-Z_]+)\}\}/g, (_, chave) => {
    if (!(chave in valores)) throw new Error(`Marcador desconhecido no modelo: {{${chave}}}`);
    return escaparHtml(valores[chave]);
  });
  return html;
}

const LIMITADOR = [{ name: "LIMITADOR", namespace_id: "1001", simple: { limit: 10, period: 60 } }];

function gerarWranglerWorkers(config) {
  const wrangler = {
    $schema: "../../node_modules/wrangler/config-schema.json",
    name: config.cloudflare.nome_projeto,
    main: "../../src/worker.js",
    compatibility_date: "2026-09-01",
    workers_dev: true,
    assets: {
      directory: "./public",
      binding: "ASSETS",
      run_worker_first: ["/api/*"],
    },
    vars: { SUB_ID: config.sub_id },
    ratelimits: LIMITADOR,
    observability: { enabled: true },
  };
  if (config.cloudflare.account_id) wrangler.account_id = config.cloudflare.account_id;
  return JSON.stringify(wrangler, null, 2) + "\n";
}

// No Pages o account_id vai pela variável CLOUDFLARE_ACCOUNT_ID (ver publicar.yml).
// O Pages não aceita o limitador nativo ("ratelimits"); fica só o limite por IP do converter.js.
function gerarWranglerPages(config) {
  const wrangler = {
    name: config.cloudflare.nome_projeto,
    pages_build_output_dir: "./public",
    compatibility_date: "2026-09-01",
  };
  return JSON.stringify(wrangler, null, 2) + "\n";
}

// O Pages só roda funções da pasta functions/; o SUB_ID vai direto no código
// porque as "vars" do arquivo de configuração não chegam às funções do Pages.
function gerarFuncaoPages(config) {
  return `// Gerado por scripts/montar.js — não edite à mão.
import { tratarConversao } from "../../../../src/converter.js";

const SUB_ID = ${JSON.stringify(config.sub_id)};

export const onRequest = ({ request, env }) => tratarConversao(request, { ...env, SUB_ID });
`;
}

function montar(cliente, { raiz = RAIZ, saida = path.join(raiz, "dist"), publicar = false } = {}) {
  const { config, foto } = lerConfig(cliente, raiz);
  if (publicar && !config.cloudflare.account_id) {
    throw new ConfigInvalida(`Preencha "cloudflare.account_id" em clientes/${cliente}/config.json antes de publicar.`);
  }

  const destino = path.join(saida, cliente);
  const publico = path.join(destino, "public");
  fs.rmSync(destino, { recursive: true, force: true });
  fs.mkdirSync(publico, { recursive: true });

  const modelo = path.join(raiz, "modelo");
  fs.writeFileSync(path.join(publico, "index.html"), gerarHtml(fs.readFileSync(path.join(modelo, "index.html"), "utf8"), config));
  fs.copyFileSync(path.join(modelo, "app.js"), path.join(publico, "app.js"));
  fs.copyFileSync(path.join(modelo, "_headers"), path.join(publico, "_headers"));
  fs.writeFileSync(path.join(publico, "foto.jpg"), foto);
  if (config.cloudflare.tipo === "pages") {
    fs.writeFileSync(path.join(destino, "wrangler.jsonc"), gerarWranglerPages(config));
    fs.mkdirSync(path.join(destino, "functions", "api"), { recursive: true });
    fs.writeFileSync(path.join(destino, "functions", "api", "converter.js"), gerarFuncaoPages(config));
  } else {
    fs.writeFileSync(path.join(destino, "wrangler.jsonc"), gerarWranglerWorkers(config));
  }
  const dadosPublicacao = { conta: config.cloudflare.conta, tipo: config.cloudflare.tipo, nome: config.cloudflare.nome_projeto, account_id: config.cloudflare.account_id };
  fs.writeFileSync(path.join(destino, "publicar.json"), JSON.stringify(dadosPublicacao, null, 2) + "\n");
  return destino;
}

module.exports = { montar, lerConfig, gerarHtml, escaparHtml, ConfigInvalida };

if (require.main === module) {
  const [cliente, ...opcoes] = process.argv.slice(2);
  try {
    const destino = montar(cliente, { publicar: opcoes.includes("--publicar") });
    console.log(`Site de "${cliente}" montado em ${path.relative(process.cwd(), destino) || "."}`);
  } catch (e) {
    if (e instanceof ConfigInvalida) {
      console.error(`Erro na configuração de "${cliente}": ${e.message}`);
      process.exit(1);
    }
    throw e;
  }
}
