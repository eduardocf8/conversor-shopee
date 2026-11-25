// Só aceita link https da própria Shopee (nunca "javascript:" ou outro site)
function ehLinkShopee(link) {
  try {
    const url = new URL(link);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" &&
      ["shopee.com.br", "shp.ee"].some((d) => host === d || host.endsWith("." + d));
  } catch (e) {
    return false;
  }
}

// Texto original do botão (vem da configuração do cliente, já no HTML)
const textoBotao = document.getElementById("btn").textContent;

async function converter() {
  const link = document.getElementById("link").value.trim();
  const btn = document.getElementById("btn");
  const erro = document.getElementById("erro");
  const resultado = document.getElementById("resultado");

  erro.classList.remove("mostrar");
  resultado.classList.remove("mostrar");

  if (!link) {
    erro.textContent = "Cole o link do produto primeiro.";
    erro.classList.add("mostrar");
    return;
  }

  btn.disabled = true;
  btn.textContent = "Gerando...";

  try {
    const resp = await fetch("/api/converter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ link: link }),
    });
    const dados = await resp.json();

    if (!resp.ok || dados.erro) {
      erro.textContent = dados.erro || "Algo deu errado. Tente de novo.";
      erro.classList.add("mostrar");
    } else if (!ehLinkShopee(dados.link)) {
      erro.textContent = "Algo deu errado. Tente de novo.";
      erro.classList.add("mostrar");
    } else {
      document.getElementById("linkBox").textContent = dados.link;
      document.getElementById("abrir").href = dados.link;
      resultado.classList.add("mostrar");
    }
  } catch (e) {
    erro.textContent = "Erro de conexão. Tente novamente.";
    erro.classList.add("mostrar");
  }

  btn.disabled = false;
  btn.textContent = textoBotao;
}

function copiar() {
  const texto = document.getElementById("linkBox").textContent;
  navigator.clipboard.writeText(texto);
  const btn = document.querySelector(".copiar");
  const original = btn.textContent;
  btn.textContent = "Copiado! ✓";
  setTimeout(() => { btn.textContent = original; }, 1500);
}

document.getElementById("btn").addEventListener("click", converter);
document.getElementById("copiar").addEventListener("click", copiar);
// Esconde a foto se ela não carregar (inclusive se já falhou antes deste script rodar)
const foto = document.querySelector(".foto");
function esconderFoto() { foto.style.display = "none"; }
foto.addEventListener("error", esconderFoto);
if (foto.complete && foto.naturalWidth === 0) esconderFoto();

// Permite gerar apertando Enter
document.getElementById("link").addEventListener("keypress", function(e) {
  if (e.key === "Enter") converter();
});

// ===== Sorteio (só existe na página dos clientes com sorteio ligado) =====
// As mesmas regras são conferidas de novo no servidor (src/sorteio.js).
const sorteioForm = document.getElementById("sorteioForm");
if (sorteioForm) {
  const campoNome = document.getElementById("sNome");
  const campoPedido = document.getElementById("sPedido");
  const campoWhats = document.getElementById("sWhats");
  const campoAceite = document.getElementById("sAceite");
  const botaoSorteio = document.getElementById("sBotao");
  const erroSorteio = document.getElementById("sErro");

  // Máscara de celular: (xx) xxxxx-xxxx, só números, no máximo 11
  function mascaraCelular(valor) {
    const n = valor.replace(/\D/g, "").slice(0, 11);
    if (n.length <= 2) return n.length ? `(${n}` : "";
    if (n.length <= 7) return `(${n.slice(0, 2)}) ${n.slice(2)}`;
    return `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`;
  }
  campoWhats.addEventListener("input", () => {
    campoWhats.value = mascaraCelular(campoWhats.value);
  });

  const nomeLimpo = () => campoNome.value.trim().replace(/\s+/g, " ");
  const pedidoLimpo = () => campoPedido.value.toUpperCase().replace(/[\s#-]/g, "");
  const whatsLimpo = () => campoWhats.value.replace(/\D/g, "");

  function validarSorteio() {
    const nome = nomeLimpo();
    if (nome.length < 5 || nome.split(" ").length < 2 || !/^[\p{L}\s'.-]+$/u.test(nome)) {
      return { campo: campoNome, erro: "Digite seu nome completo (nome e sobrenome)." };
    }
    if (!/^[A-Z0-9]{10,20}$/.test(pedidoLimpo())) {
      return { campo: campoPedido, erro: "Confira o número do pedido: ele tem letras e números, sem espaços." };
    }
    const whats = whatsLimpo();
    if (whats.length !== 11) {
      return { campo: campoWhats, erro: `O celular precisa ter 11 números com o DDD (você digitou ${whats.length}).` };
    }
    if (!/^[1-9][1-9]9\d{8}$/.test(whats)) {
      return { campo: campoWhats, erro: "Confira o celular: DDD + número começando com 9, ex: (11) 91234-5678." };
    }
    if (!campoAceite.checked) {
      return { campo: campoAceite, erro: "Marque a autorização para participar." };
    }
    return null;
  }

  function mostrarErroSorteio(mensagem, campo) {
    [campoNome, campoPedido, campoWhats].forEach((c) => c.classList.remove("invalido"));
    erroSorteio.textContent = mensagem;
    erroSorteio.classList.add("mostrar");
    if (campo && campo !== campoAceite) campo.classList.add("invalido");
    if (campo) campo.focus();
  }

  sorteioForm.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    erroSorteio.classList.remove("mostrar");
    const problema = validarSorteio();
    if (problema) return mostrarErroSorteio(problema.erro, problema.campo);

    const textoOriginal = botaoSorteio.textContent;
    botaoSorteio.disabled = true;
    botaoSorteio.textContent = "Enviando...";
    try {
      const resp = await fetch("/api/sorteio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: nomeLimpo(),
          pedido: pedidoLimpo(),
          whatsapp: whatsLimpo(),
          aceite: campoAceite.checked,
          site: document.getElementById("sSite").value,
        }),
      });
      const dados = await resp.json();
      if (!resp.ok || !dados.ok) {
        const campos = { nome: campoNome, pedido: campoPedido, whatsapp: campoWhats, aceite: campoAceite };
        mostrarErroSorteio(dados.erro || "Não consegui salvar agora. Tente de novo.", campos[dados.campo]);
      } else {
        const sucesso = document.createElement("p");
        sucesso.className = "sucesso";
        sucesso.textContent = `Pronto! O pedido ${dados.pedido || pedidoLimpo()} está participando do sorteio. Boa sorte! 🍀`;
        sorteioForm.replaceWith(sucesso);
        return;
      }
    } catch (e) {
      mostrarErroSorteio("Erro de conexão. Tente de novo.");
    }
    botaoSorteio.disabled = false;
    botaoSorteio.textContent = textoOriginal;
  });
}
