// Área do dono: confere a senha no servidor a cada ação (nada fica guardado no navegador)
const campoSenha = document.getElementById("senha");
const area = document.getElementById("area");
const msg = document.getElementById("msg");

function aviso(texto, tipo) {
  msg.textContent = texto;
  msg.className = `msg mostrar ${tipo}`;
}

async function chamar(acao, extra = {}) {
  return fetch("/api/sorteio-admin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ senha: campoSenha.value, acao, ...extra }),
  });
}

async function atualizarTotal() {
  const resp = await chamar("contar");
  const dados = await resp.json();
  if (!resp.ok) throw new Error(dados.erro || "Não consegui entrar.");
  document.getElementById("total").textContent = `${dados.total} inscrição(ões) até agora.`;
}

document.getElementById("entrar").addEventListener("click", async () => {
  msg.className = "msg";
  try {
    await atualizarTotal();
    area.classList.remove("escondido");
  } catch (e) {
    area.classList.add("escondido");
    aviso(e.message, "erro");
  }
});
campoSenha.addEventListener("keypress", (e) => {
  if (e.key === "Enter") document.getElementById("entrar").click();
});

document.getElementById("baixar").addEventListener("click", async () => {
  msg.className = "msg";
  const resp = await chamar("exportar");
  if (!resp.ok) {
    const dados = await resp.json().catch(() => ({}));
    return aviso(dados.erro || "Não consegui baixar.", "erro");
  }
  const arquivo = await resp.blob();
  const link = document.createElement("a");
  link.href = URL.createObjectURL(arquivo);
  link.download = `inscricoes-sorteio-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  aviso("Planilha baixada. Ela abre no Excel ou no Google Planilhas.", "ok");
});

document.getElementById("apagar").addEventListener("click", async () => {
  msg.className = "msg";
  const confirmacao = document.getElementById("confirmacao").value.trim();
  if (confirmacao !== "APAGAR") return aviso("Digite APAGAR no campo para confirmar.", "erro");
  const resp = await chamar("apagar", { confirmacao });
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok) return aviso(dados.erro || "Não consegui apagar.", "erro");
  document.getElementById("confirmacao").value = "";
  await atualizarTotal().catch(() => {});
  aviso("Todas as inscrições foram apagadas.", "ok");
});
