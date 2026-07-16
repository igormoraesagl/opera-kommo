# AGENTS.md · Conector Kommo CRM

## O que é
CONECTOR: Kommo CRM (API v4).
Deixa o Claude operar o CRM por comando: ler e contar leads, mover etapa do
funil, criar lead e contato, registrar nota e tarefa, ver usuários e funis.

## Credenciais que precisa
| Variável | O que é | Onde conseguir |
|---|---|---|
| MCP_SECRET | Segredo do caminho da URL | Automático (deploy.sh gera) |
| KOMMO_SUBDOMAIN | O subdomínio da sua conta Kommo | É o começo do seu endereço: em `suaempresa.kommo.com`, o subdomínio é `suaempresa`. Pode colar o domínio inteiro também. |
| KOMMO_TOKEN | Token de acesso de longa duração da API | No Kommo: Configurações, Integrações, crie uma integração privada e gere o token de longa duração. |

## Bindings
Nenhum. O Kommo não guarda estado no Worker.

## Como fazer deploy (um por cliente)
1. Entre em `mcps/kommo/template/`.
2. Rode `./deploy.sh <slug-do-cliente>` (ex.: `./deploy.sh agencia-do-joao`).
3. Cole o `KOMMO_SUBDOMAIN` e o `KOMMO_TOKEN` quando pedir.
4. Copie a URL final que termina em `/<segredo>/mcp`.

## Como conectar no Claude
1. Abra as configurações de conectores do Claude.
2. Adicione um conector por URL e cole a URL do MCP.
3. Teste pedindo "liste meus funis do Kommo" (chama `listar_funis`).

## Ferramentas (12)
- `listar_funis`: lista funis e etapas com seus IDs. Comece por ela.
- `buscar_leads`: busca leads por texto, funil ou etapa.
- `contar_leads`: conta a base inteira num filtro, sem limite de 250. Ideal pra raio-x de funil.
- `obter_lead`: detalhes de um lead pelo ID.
- `criar_lead`: cria lead, já com contato se informar.
- `mover_lead`: move o lead de etapa ou de funil.
- `atualizar_lead`: muda nome, preço ou responsável.
- `buscar_contato`: busca contatos por nome, telefone ou email.
- `criar_contato`: cria contato com telefone e email.
- `adicionar_nota`: registra uma nota no lead.
- `criar_tarefa`: cria tarefa com prazo no lead.
- `listar_usuarios`: lista os usuários da conta e seus IDs.

## Se der erro
- 404 ao conectar: a URL ou o segredo estão errados. Confira o `/<segredo>/mcp`.
- Erro 401 do Kommo: o KOMMO_TOKEN venceu ou está errado. Gere outro e rode `./deploy.sh` de novo.
- Subdomínio errado: use só o começo do endereço, sem `.kommo.com`.
- Logs: painel da Cloudflare, o Worker tem observability ligada.
