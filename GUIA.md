# Guia: criar o site de um cliente

Cada cliente recebe o próprio gerador de links Shopee, hospedado **na conta Cloudflare dele**, de graça.
Você monta e publica tudo daqui do GitHub, sem instalar nada no computador.

- O cliente só precisa: criar uma conta na Cloudflare e ter acesso à Open API de afiliados da Shopee.
- As credenciais da Shopee ficam guardadas só na conta Cloudflare do cliente; nunca passam por você nem pelo GitHub.
- Plano gratuito da Cloudflare: até 100 mil conversões por dia; abrir a página não conta.

---

## 1. Só uma vez: preparar o seu GitHub

1. Na **sua** conta Cloudflare (crie uma se não tiver), vá em **My Profile → API Tokens → Create Token**.
2. Use o modelo **"Edit Cloudflare Workers"**. Em *Account Resources*, escolha **All accounts**
   (assim o token funciona nas contas dos clientes que te convidarem). Crie e copie o token.
3. Aqui no GitHub: **Settings → Secrets and variables → Actions → New repository secret**
   - Nome: `CLOUDFLARE_API_TOKEN`
   - Valor: o token copiado.
4. Ative a verificação em duas etapas (2FA) no GitHub e na Cloudflare. Seu token publica sites de clientes.

---

## 2. Para cada cliente novo

### 2.1 O que pedir ao cliente

| Item | Observação |
|---|---|
| Conta de afiliado Shopee **com acesso à Open API** | Ele pede no portal de afiliados (Open API). Sem isso o site não funciona; confirme antes de fechar a venda. |
| Foto de perfil | Quadrada de preferência. Será reduzida para JPG de até 1 MB (ex: 400×400 px). |
| Nome / @ e textos | Título, subtítulo, texto do botão. |
| Cores | Principal, escura (botão ao passar o mouse) e fundo, no formato `#RRGGBB`. |
| Faixa "Restam poucos cupons" | Ligada ou desligada (e o texto, se ligada). Só ligue se for verdade. |
| Sub ID | Rótulo pra ele rastrear as vendas do site no painel da Shopee (só letras e números). Padrão: `site`. |

### 2.2 O cliente cria a conta Cloudflare e te convida

Mande pra ele estes passos:

1. Criar conta grátis em <https://dash.cloudflare.com/sign-up> e ativar 2FA.
2. No painel, abrir **Workers & Pages** uma vez e escolher o subdomínio `workers.dev`
   (vira o endereço do site, ex: `fulana.workers.dev`).
3. **Manage Account → Members → Invite**: convidar o seu e-mail com a função **Administrator**.
4. Te mandar o **Account ID** (aparece na página inicial da conta, no lado direito, ou na URL do painel: 32 letras/números).

### 2.3 Você cria a pasta do cliente

1. Aqui no GitHub, copie a pasta `clientes/exemplo/` para `clientes/<nome-do-cliente>/`
   (nome em minúsculas, sem espaço, ex: `fulana`).
   Pelo site do GitHub: *Add file → Create new file* com o nome `clientes/fulana/config.json`
   e cole o conteúdo do `config.json` de exemplo; depois *Add file → Upload files* pra mandar a `foto.jpg` na mesma pasta.
2. Edite o `config.json`:

```jsonc
{
  "nome": "fulana",                         // aparece como texto alternativo da foto
  "titulo": "Gerador de Links Shopee • fulana",
  "subtitulo": "Cupom exclusivo • cole seu link e ganhe desconto",
  "descricao": "Texto que aparece quando o link é compartilhado (WhatsApp, Instagram...)",
  "texto_botao": "💰 Gerar link com desconto",
  "mostrar_faixa_cupons": false,            // true = mostra a faixa, false = esconde
  "texto_faixa_cupons": "🔥 Restam poucos cupons disponíveis hoje!",
  "cores": { "principal": "#ee4d2d", "escura": "#d73211", "fundo": "#fff5f2" },
  "sub_id": "site",
  "cloudflare": {
    "nome_worker": "link-fulana",           // vira o endereço: link-fulana.<subdominio>.workers.dev
    "account_id": "cole aqui o Account ID do cliente"
  }
}
```

(Os comentários `//` acima são só explicação: no arquivo de verdade não pode ter comentário.)

Se algo estiver errado (cor fora do formato, campo faltando, foto grande demais...), o passo seguinte
para e diz exatamente o que corrigir.

### 2.4 Publicar

1. Aba **Actions → Publicar site de cliente → Run workflow**.
2. Em *cliente*, digite o nome da pasta (ex: `fulana`) e clique em **Run workflow**.
3. Em 1–2 minutos fica verde. O endereço do site aparece no final do passo "Publica na Cloudflare".

### 2.5 O cliente coloca as credenciais da Shopee (só ele vê)

Faça junto com ele (chamada de vídeo, por exemplo), sem que ele te mande a Secret:

1. Painel da Cloudflare dele → **Workers & Pages** → o worker `link-fulana` → **Settings → Variables and Secrets → Add**.
2. Adicionar dois itens do tipo **Secret**:
   - `SHOPEE_APP_ID` = App ID da Open API da Shopee
   - `SHOPEE_SECRET` = Secret da Open API da Shopee
3. Salvar (**Deploy**).

### 2.6 Testar e entregar

1. Abrir o endereço do site, colar um link de produto (completo e um `br.shp.ee` do botão compartilhar) e gerar.
2. Tocar em **Abrir produto** e conferir que cai no produto certo.
3. O cliente te remove de **Members** (opcional, mas recomendado). Depois disso, pra atualizar o site dele
   você precisa ser convidado de novo.
4. Domínio próprio (opcional, pago pelo cliente): no worker → **Settings → Domains & Routes → Add → Custom domain**.

---

## 3. Atualizar o site de um cliente

Mudou texto, cor, foto ou saiu uma correção no modelo? Edite o que precisar e rode de novo
**Actions → Publicar site de cliente** com o nome dele. As credenciais da Shopee continuam lá
(publicar de novo não apaga os Secrets). Precisa estar como membro da conta dele.

## 4. Se algo der errado

- **"Credenciais não configuradas no servidor"**: faltam os Secrets do passo 2.5 (nomes exatos, tipo Secret).
- **"A Shopee não conseguiu gerar o link"**: veja o motivo em Workers & Pages → worker → **Logs**
  (procure `[converter] erro da Shopee`). Credencial errada ou conta sem acesso à Open API são os casos comuns.
- **Publicação falha com erro de autenticação**: você não é membro da conta do cliente, o token não tem
  "All accounts", ou o `account_id` está errado.
- **Publicação pede subdomínio workers.dev**: o cliente não fez o passo 2.2.2.

## 5. Para quem mexe no código

```
modelo/            página (index.html com {{MARCADORES}}, app.js, _headers com os cabeçalhos de segurança)
src/               Worker da Cloudflare (converter.js = o conversor)
clientes/<nome>/   config.json + foto.jpg de cada cliente
scripts/montar.js  junta modelo + cliente em dist/<nome>/ e gera o wrangler.jsonc
test/              testes (npm test)
```

- `npm test` roda todos os testes (segurança do conversor e do montador).
- `npm run dev` monta o cliente `exemplo` e roda localmente (crie `dist/exemplo/.dev.vars` com
  `SHOPEE_APP_ID=...` e `SHOPEE_SECRET=...` pra testar com credenciais de verdade).
- Os arquivos `index.html`, `app.js`, `foto.jpg`, `api/` e `vercel.json` na raiz são da versão antiga na Vercel;
  apague depois que o site da vegrassi estiver rodando na Cloudflare.
