# Guia: criar o site de um cliente

Cada cliente recebe o próprio gerador de links Shopee em `nomedocliente.pages.dev`, hospedado de graça
na **sua conta Cloudflare de clientes**. O cliente não precisa criar conta em lugar nenhum: ele te manda
os textos, a foto e as credenciais da Open API da Shopee, e você publica tudo daqui do GitHub.

- Plano gratuito da Cloudflare, somando **todos** os clientes da conta: até 100 mil conversões por dia
  (abrir a página não conta) e até **100 sites por conta**. Passou disso, crie outra conta de clientes.
- Os links saem com as credenciais **do cliente**, então a comissão vai pra ele.

---

## 1. Só uma vez: preparar as contas

Você tem duas contas Cloudflare, cada uma com o seu token no GitHub:

| Conta | Pra quê | Secret no GitHub | `"conta"` no config.json |
|---|---|---|---|
| Pessoal | vegrassi (e o que mais for seu) | `CLOUDFLARE_API_TOKEN` (já cadastrado) | `"pessoal"` |
| Clientes | sites vendidos | `CLOUDFLARE_API_TOKEN_CLIENTES` | `"clientes"` |

### 1.1 Proteger a conta de clientes

Ela vai guardar as credenciais de todos os clientes:

1. Ative a verificação em duas etapas (2FA): **My Profile → Authentication → Two-Factor Authentication**.
2. Use um e-mail e uma senha que você não usa em nenhum outro lugar.

### 1.2 Token da conta de clientes

Logado na **conta de clientes**:

1. **My Profile → API Tokens → Create Token → Create Custom Token**.
2. Nome: `GitHub - publicar sites`.
3. Permissions: **Account → Cloudflare Pages → Edit**.
4. Account Resources: **Include → (a conta de clientes)**.
5. **Continue to summary → Create Token** e copie o token (ele só aparece uma vez).
6. No GitHub: <https://github.com/eduardocf8/conversor-shopee/settings/secrets/actions> → **New repository secret**
   - Name: `CLOUDFLARE_API_TOKEN_CLIENTES`
   - Secret: o token copiado.
7. Anote o **Account ID** da conta de clientes (em **Workers & Pages**, no lado direito). Ele vai em todos os clientes.

---

## 2. Para cada cliente novo

### 2.1 O que pedir ao cliente

| Item | Observação |
|---|---|
| **App ID e Secret da Open API** da Shopee | Ele gera no portal de afiliados da Shopee (Open API). Sem acesso à Open API o site não funciona: confirme antes de fechar a venda. ⚠️ **Nunca peça nem aceite a senha de login da conta Shopee**: a Secret da Open API é outra coisa e só serve pra gerar links. |
| Foto de perfil | Quadrada de preferência. Vai como JPG de até 1 MB (ex: 400×400 px). |
| Nome / @ e textos | Título, subtítulo, texto do botão. |
| Cores | Principal, escura (botão ao passar o mouse) e fundo, no formato `#RRGGBB`. |
| Faixa "Restam poucos cupons" | Ligada ou desligada (e o texto, se ligada). Só ligue se for verdade. |
| Sub ID | Rótulo pra ele rastrear as vendas do site no painel da Shopee (só letras e números). Padrão: `site`. |

**Como receber a Secret:** peça pra ele mandar por um link de uso único, que some depois de aberto
(ex: <https://onetimesecret.com> ou Bitwarden Send), e não em texto no WhatsApp/e-mail.
Se mandar por mensagem mesmo assim, apague a mensagem depois de cadastrar (passo 2.4).

### 2.2 Criar a pasta do cliente

1. Aqui no GitHub, crie `clientes/<nome-do-cliente>/` copiando `clientes/exemplo/`
   (nome em minúsculas, sem espaço, ex: `fulana`).
   Pelo site do GitHub: *Add file → Create new file* com o nome `clientes/fulana/config.json`
   e cole o conteúdo do `config.json` de exemplo; depois *Add file → Upload files* pra mandar a `foto.jpg` na mesma pasta.
2. Edite o `config.json`:

```jsonc
{
  "nome": "fulana",                         // aparece como texto alternativo da foto
  "titulo": "Gerador de Links Shopee • fulana",  // nome longo? use "Gerador de Links Shopee\nFulana de Tal" (\n = quebra de linha)
  "subtitulo": "Cupom exclusivo • cole seu link e ganhe desconto",
  "descricao": "Texto que aparece quando o link é compartilhado (WhatsApp, Instagram...)",
  "texto_botao": "💰 Gerar link com desconto",
  "mostrar_faixa_cupons": false,            // true = mostra a faixa, false = esconde
  "texto_faixa_cupons": "🔥 Restam poucos cupons disponíveis hoje!",
  "cores": { "principal": "#ee4d2d", "escura": "#d73211", "fundo": "#fff5f2" },
  "fonte": "fredoka",                       // opcional: tire a linha pra usar a fonte padrão (disponíveis: fredoka)
  "sub_id": "site",
  "cloudflare": {
    "conta": "clientes",                    // "clientes" = conta de clientes | "pessoal" = sua conta
    "tipo": "pages",                        // "pages" = fulana.pages.dev
    "nome_projeto": "fulana",               // vira o endereço (minúsculas, números e hífen)
    "account_id": "Account ID da conta de clientes"
  }
}
```

(Os comentários `//` acima são só explicação: no arquivo de verdade não pode ter comentário.)

Se algo estiver errado (cor fora do formato, campo faltando, foto grande demais...), a publicação
para e diz exatamente o que corrigir.

### 2.3 Publicar

1. Aba **Actions → Publicar site de cliente → Run workflow**.
2. Em *cliente*, digite o nome da pasta (ex: `fulana`) e clique em **Run workflow**.
3. Em 1–2 minutos fica verde. O endereço aparece no final do passo "Publica na Cloudflare".
   - O nome `.pages.dev` é disputado com o mundo todo: se `fulana.pages.dev` já existir em outra conta,
     a Cloudflare acrescenta letras (ex: `fulana-3xk.pages.dev`). Se não gostar, troque o `nome_projeto`
     e publique de novo.

### 2.4 Cadastrar as credenciais da Shopee do cliente

1. Conta de clientes → **Workers & Pages** → projeto `fulana` → **Settings → Variables and Secrets → Add**,
   no ambiente **Production**.
2. Dois itens do tipo **Secret**:
   - `SHOPEE_APP_ID` = App ID do cliente
   - `SHOPEE_SECRET` = Secret do cliente
3. Salvar.
4. **Publicar de novo** (passo 2.3): no Pages, os Secrets só valem a partir da próxima publicação.
5. Apagar a mensagem/link em que você recebeu a Secret.

### 2.5 Testar e entregar

1. Abrir o endereço, colar um link de produto (completo e um `br.shp.ee` do botão compartilhar) e gerar.
2. Tocar em **Abrir produto** e conferir que cai no produto certo.
3. Mandar o endereço pro cliente colocar na bio.
4. Domínio próprio (opcional, pago pelo cliente): no projeto → **Custom domains**.

---

## 3. Atualizar o site de um cliente

Mudou texto, cor, foto ou saiu uma correção no modelo? Edite o que precisar e rode de novo
**Actions → Publicar site de cliente** com o nome dele. As credenciais continuam lá
(publicar de novo não apaga os Secrets).

- **Cliente trocou a Secret na Shopee**: atualize `SHOPEE_SECRET` no projeto (passo 2.4) e publique de novo.
- **Cliente cancelou**: apague o projeto na Cloudflare (**Settings → Delete project**), com isso as
  credenciais dele somem; e apague a pasta `clientes/<nome>/` aqui.
- **Cliente quer levar o site pra conta dele**: ele cria uma conta Cloudflare e te convida como membro
  (**Manage Account → Members → Invite**); troque `"conta"`/`"account_id"` no config dele, publique, ele cadastra
  as credenciais (passo 2.4) na conta dele, e você apaga o projeto da sua conta. (O token da conta de clientes
  só enxerga a conta de clientes; pra isso use um token com acesso à conta dele.)

## 4. Contrato com o cliente (sugestão de pontos)

- Venda única: por quanto tempo o site fica no ar (ex: por tempo indeterminado, sem garantia de prazo) e o que
  acontece se você parar de oferecer o serviço (aviso prévio + transferência do site pra conta dele).
- Você guarda o App ID e a Secret da Open API **só** pra gerar os links do site dele, e apaga se ele cancelar.
- Ele pode trocar a Secret na Shopee quando quiser (e te avisa, pra atualizar).
- Comissões e regras do programa de afiliados são entre ele e a Shopee.

## 5. Se algo der errado

- **"Credenciais não configuradas no servidor"**: faltam os Secrets do passo 2.4 (nomes exatos, tipo Secret,
  ambiente Production) ou faltou publicar de novo depois de cadastrar.
- **"A Shopee não conseguiu gerar o link"**: veja o motivo no projeto → deployment mais recente →
  **Functions → Real-time logs** (procure `[converter] erro da Shopee`). Credencial errada ou conta sem
  acesso à Open API são os casos comuns.
- **"Falta o secret CLOUDFLARE_API_TOKEN_CLIENTES"**: faça o passo 1.2.
- **Publicação falha com erro de autenticação**: `"conta"` errado no config, `account_id` errado, ou o token
  sem a permissão **Cloudflare Pages: Edit** na conta certa.

## 6. Para quem mexe no código

```
modelo/            página (index.html com {{MARCADORES}}, app.js, _headers com os cabeçalhos de segurança)
src/               conversor (converter.js) e entrada do Worker (worker.js, só no tipo "workers")
clientes/<nome>/   config.json + foto.jpg de cada cliente
scripts/montar.js  junta modelo + cliente em dist/<nome>/ (página, wrangler.jsonc e, no Pages, functions/)
test/              testes (npm test)
```

- Fonte nova: coloque os `.woff2` (subconjunto latin, licença livre como OFL) em `modelo/fontes/<nome>/` e
  cadastre em `FONTES` no `scripts/montar.js`. As fontes ficam hospedadas no próprio site (a política de
  segurança bloqueia fontes de fora, como Google Fonts).
- `npm test` roda todos os testes (segurança do conversor e do montador).
- `"tipo": "workers"` ainda funciona (endereço `nome.<conta>.workers.dev`, com limitador nativo por minuto),
  mas o padrão é `"pages"`.
- Os arquivos `index.html`, `app.js`, `foto.jpg`, `api/` e `vercel.json` na raiz são da versão antiga na Vercel
  (linkvegrassi.vercel.app); apague quando desligar a Vercel.
