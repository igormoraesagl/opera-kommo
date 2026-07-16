# Guia rápido · conectar o Kommo no seu Claude (sem terminal)

Objetivo: ter o Claude operando seu Kommo em menos de 15 minutos, clicando, sem
linha de comando. O conector sobe na SUA conta Cloudflare, então seu dado do CRM
fica com você, não passa por ninguém.

## Antes de começar
- Uma conta na Cloudflare (o plano grátis serve). Se não tem, crie em cloudflare.com, leva 2 minutos.
- Uma conta no GitHub (grátis). O botão guarda uma cópia do conector na sua mão.
- Acesso de administrador no seu Kommo.

## Passo 1 · Pegue suas credenciais do Kommo
1. Seu subdomínio: olhe o endereço do seu Kommo. Em `suaempresa.kommo.com`, o subdomínio é `suaempresa`.
2. Seu token: no Kommo, vá em Configurações, Integrações, crie uma integração privada e gere o token de acesso de longa duração. Guarde ele.
3. Crie um segredo pra URL: invente um texto longo e aleatório, com 32 caracteres ou mais, sem espaços. O gerador de senha do seu navegador serve. Esse é o seu MCP_SECRET, a senha do conector. Guarde ele.

## Passo 2 · Clique no botão e deixe a Cloudflare montar
1. Abra o README do conector Kommo e clique no botão "Deploy to Cloudflare".
2. Autorize: o botão conecta sua conta GitHub e sua conta Cloudflare, guarda uma cópia do código na sua conta e cria o Worker na sua Cloudflare.
3. Confirme o nome do Worker (pode deixar o sugerido) e siga. A Cloudflare publica sozinha, sem você digitar comando nenhum.

## Passo 3 · Cole as chaves no painel
1. No painel da Cloudflare, abra o Worker que subiu.
2. Vá em Settings, depois Variables and Secrets.
3. Adicione as 3 variáveis, cada uma como Secret: `MCP_SECRET`, `KOMMO_SUBDOMAIN` e `KOMMO_TOKEN`, com os valores do Passo 1.
4. Salve. A Cloudflare republica o Worker com as chaves.

## Passo 4 · Conecte no Claude
1. Ainda no painel, copie a URL pública do Worker (algo como `https://kommo-crm.seu-usuario.workers.dev`).
2. Acrescente no fim `/<seu MCP_SECRET>/mcp`. Fica: `https://kommo-crm.seu-usuario.workers.dev/SEU_SEGREDO/mcp`.
3. Nas configurações de conectores do Claude, adicione um conector por URL e cole essa URL.
4. Peça "liste meus funis do Kommo" pra confirmar que está no ar.

## Se der erro
- Conector não responde: confira se colou a URL inteira, com o `/<segredo>/mcp` no fim, e se o segredo bate com o que você pôs em Settings.
- "Não autorizado" do Kommo: o token venceu ou está errado. Gere outro no Kommo e troque em Settings, Variables.
- Subdomínio errado: use só o começo do endereço, sem `.kommo.com`.
- Prefere terminal? Existe um `template/deploy.sh` que faz o mesmo por linha de comando.

---
*Feito por Agências Lucrativas · Método AGL*
