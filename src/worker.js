// Ponto de entrada do Worker da Cloudflare.
// Só /api/* passa por aqui (ver "run_worker_first" no wrangler.jsonc gerado);
// a página, o app.js e a foto são servidos direto pela Cloudflare, com os
// cabeçalhos de segurança do arquivo modelo/_headers.

import { tratarConversao } from "./converter.js";

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/converter") {
      return tratarConversao(request, env);
    }
    if (pathname.startsWith("/api/")) {
      return new Response(JSON.stringify({ erro: "Não encontrado" }), {
        status: 404,
        headers: { "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff" },
      });
    }
    return env.ASSETS.fetch(request);
  },
};
