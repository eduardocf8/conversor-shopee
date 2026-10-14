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
