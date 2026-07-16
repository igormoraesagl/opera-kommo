// Conector MCP do Kommo (CRM) rodando em Cloudflare Workers.
// Implementa o transporte MCP "Streamable HTTP" de forma simples (JSON-RPC).
// Mesmo padrão do conector Z-API (WhatsApp).

const PROTOCOL_VERSION = "2024-11-05";

function kommoBase(env) {
  // Aceita tanto o subdominio sozinho quanto o dominio completo.
  const sub = (env.KOMMO_SUBDOMAIN || "").replace(/^https?:\/\//, "").replace(/\.kommo\.com.*$/, "");
  return `https://${sub}.kommo.com/api/v4`;
}

async function kommo(env, path, { method = "GET", body } = {}) {
  // Limpa o token de espaços/quebras de linha e de um eventual prefixo "Bearer ".
  const token = (env.KOMMO_TOKEN || "").trim().replace(/^Bearer\s+/i, "");
  const res = await fetch(`${kommoBase(env)}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  // 204 = sem conteúdo (ex.: busca sem resultados). Retorna vazio.
  if (res.status === 204) return null;

  const txt = await res.text();
  let data;
  try { data = JSON.parse(txt); } catch { data = txt; }
  if (!res.ok) {
    const detail = typeof data === "string" ? data : JSON.stringify(data);
    throw new Error(`Kommo ${res.status}: ${detail}`);
  }
  return data;
}

// ---- Helpers de formatação ----

function limparLead(l) {
  const contatos = (l._embedded?.contacts || []).map((c) => ({ id: c.id, nome: c.name }));
  return {
    id: l.id,
    nome: l.name,
    preco: l.price,
    pipeline_id: l.pipeline_id,
    status_id: l.status_id,
    responsavel_id: l.responsible_user_id,
    criado_em: l.created_at ? new Date(l.created_at * 1000).toISOString() : null,
    atualizado_em: l.updated_at ? new Date(l.updated_at * 1000).toISOString() : null,
    contatos,
  };
}

function limparContato(c) {
  const campos = {};
  for (const f of c.custom_fields_values || []) {
    campos[f.field_code || f.field_name] = (f.values || []).map((v) => v.value).join(", ");
  }
  return {
    id: c.id,
    nome: c.name,
    responsavel_id: c.responsible_user_id,
    campos,
  };
}

// Monta custom_fields_values de telefone/email para criação de contato.
function camposContato({ telefone, email }) {
  const cf = [];
  if (telefone) cf.push({ field_code: "PHONE", values: [{ value: String(telefone), enum_code: "WORK" }] });
  if (email) cf.push({ field_code: "EMAIL", values: [{ value: String(email), enum_code: "WORK" }] });
  return cf;
}

// ---- Definição das ferramentas ----
const TOOLS = [
  {
    name: "listar_funis",
    description:
      "Lista todos os funis (pipelines) e suas etapas (status). Use para descobrir os IDs de pipeline_id e status_id antes de criar ou mover leads.",
    inputSchema: { type: "object", properties: {} },
    handler: async (env) => {
      const data = await kommo(env, `/leads/pipelines`);
      const pipelines = (data?._embedded?.pipelines || []).map((p) => ({
        pipeline_id: p.id,
        nome: p.name,
        principal: p.is_main,
        etapas: (p._embedded?.statuses || [])
          .sort((a, b) => a.sort - b.sort)
          .map((s) => ({ status_id: s.id, nome: s.name })),
      }));
      return JSON.stringify(pipelines, null, 2);
    },
  },
  {
    name: "buscar_leads",
    description:
      "Lista/busca leads. Filtros opcionais: 'query' (texto livre: nome, telefone, etc), 'pipeline_id' e 'status_id' (use listar_funis para descobrir), 'limite' (padrão 25, máx 250). Retorna leads com seus contatos.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Texto livre de busca (nome, telefone, email...)" },
        pipeline_id: { type: "number", description: "Filtrar por funil" },
        status_id: { type: "number", description: "Filtrar por etapa" },
        limite: { type: "number", description: "Quantidade (padrão 25, máx 250)" },
      },
    },
    handler: async (env, { query, pipeline_id, status_id, limite }) => {
      const params = new URLSearchParams();
      params.set("limit", String(Math.min(limite || 25, 250)));
      params.set("with", "contacts");
      if (query) params.set("query", query);
      if (pipeline_id && status_id) {
        params.set("filter[statuses][0][pipeline_id]", String(pipeline_id));
        params.set("filter[statuses][0][status_id]", String(status_id));
      } else if (pipeline_id) {
        params.set("filter[pipeline_id]", String(pipeline_id));
      } else if (status_id) {
        params.set("filter[statuses][0][status_id]", String(status_id));
      }
      const data = await kommo(env, `/leads?${params.toString()}`);
      const leads = (data?._embedded?.leads || []).map(limparLead);
      if (!leads.length) return "Nenhum lead encontrado para esse filtro.";
      return JSON.stringify({ total: leads.length, leads }, null, 2);
    },
  },
  {
    name: "contar_leads",
    description:
      "Conta com precisão quantos leads existem num filtro, paginando toda a base (não fica limitado a 250). Filtros opcionais: 'pipeline_id', 'status_id', 'query'. Retorna a contagem total e a soma dos valores. Ideal para raio-x de funil.",
    inputSchema: {
      type: "object",
      properties: {
        pipeline_id: { type: "number" },
        status_id: { type: "number" },
        query: { type: "string" },
      },
    },
    handler: async (env, { pipeline_id, status_id, query }) => {
      let page = 1, count = 0, soma = 0;
      const MAX_PAGES = 100; // trava de segurança (25k leads)
      while (page <= MAX_PAGES) {
        const params = new URLSearchParams();
        params.set("limit", "250");
        params.set("page", String(page));
        if (query) params.set("query", query);
        if (pipeline_id && status_id) {
          params.set("filter[statuses][0][pipeline_id]", String(pipeline_id));
          params.set("filter[statuses][0][status_id]", String(status_id));
        } else if (pipeline_id) {
          params.set("filter[pipeline_id]", String(pipeline_id));
        } else if (status_id) {
          params.set("filter[statuses][0][status_id]", String(status_id));
        }
        const data = await kommo(env, `/leads?${params.toString()}`);
        const leads = data?._embedded?.leads || [];
        count += leads.length;
        soma += leads.reduce((s, l) => s + (l.price || 0), 0);
        if (leads.length < 250) break; // última página
        page++;
      }
      return JSON.stringify({ total: count, valor_total: soma, paginas_lidas: page }, null, 2);
    },
  },
  {
    name: "obter_lead",
    description: "Retorna os detalhes completos de um lead específico pelo ID, incluindo contatos vinculados.",
    inputSchema: {
      type: "object",
      properties: { lead_id: { type: "number", description: "ID do lead" } },
      required: ["lead_id"],
    },
    handler: async (env, { lead_id }) => {
      const l = await kommo(env, `/leads/${lead_id}?with=contacts`);
      return JSON.stringify(limparLead(l), null, 2);
    },
  },
  {
    name: "criar_lead",
    description:
      "Cria um novo lead. Informe 'nome' (obrigatório). Opcionais: 'preco', 'pipeline_id', 'status_id' (use listar_funis), 'responsavel_id', e dados de contato 'contato_nome'/'contato_telefone'/'contato_email' para já criar e vincular um contato.",
    inputSchema: {
      type: "object",
      properties: {
        nome: { type: "string", description: "Nome do lead/negócio" },
        preco: { type: "number", description: "Valor do negócio" },
        pipeline_id: { type: "number" },
        status_id: { type: "number" },
        responsavel_id: { type: "number" },
        contato_nome: { type: "string" },
        contato_telefone: { type: "string" },
        contato_email: { type: "string" },
      },
      required: ["nome"],
    },
    handler: async (env, a) => {
      const lead = { name: a.nome };
      if (a.preco != null) lead.price = a.preco;
      if (a.pipeline_id) lead.pipeline_id = a.pipeline_id;
      if (a.status_id) lead.status_id = a.status_id;
      if (a.responsavel_id) lead.responsible_user_id = a.responsavel_id;

      const temContato = a.contato_nome || a.contato_telefone || a.contato_email;
      if (temContato) {
        // Endpoint complex: cria lead + contato de uma vez.
        lead._embedded = {
          contacts: [
            {
              name: a.contato_nome || a.nome,
              custom_fields_values: camposContato({ telefone: a.contato_telefone, email: a.contato_email }),
            },
          ],
        };
        const data = await kommo(env, `/leads/complex`, { method: "POST", body: [lead] });
        const id = Array.isArray(data) ? data[0]?.id : data?._embedded?.leads?.[0]?.id;
        return `Lead criado ✅ (id: ${id})`;
      }

      const data = await kommo(env, `/leads`, { method: "POST", body: [lead] });
      const id = data?._embedded?.leads?.[0]?.id;
      return `Lead criado ✅ (id: ${id})`;
    },
  },
  {
    name: "mover_lead",
    description:
      "Move um lead para outra etapa do funil. Informe 'lead_id' e 'status_id' de destino (use listar_funis). Se for mudar de funil, informe também 'pipeline_id'.",
    inputSchema: {
      type: "object",
      properties: {
        lead_id: { type: "number" },
        status_id: { type: "number", description: "Etapa de destino" },
        pipeline_id: { type: "number", description: "Funil de destino (só se mudar de funil)" },
      },
      required: ["lead_id", "status_id"],
    },
    handler: async (env, { lead_id, status_id, pipeline_id }) => {
      const body = { status_id };
      if (pipeline_id) body.pipeline_id = pipeline_id;
      const l = await kommo(env, `/leads/${lead_id}`, { method: "PATCH", body });
      return `Lead ${lead_id} movido ✅ (status_id: ${l.status_id}, pipeline_id: ${l.pipeline_id})`;
    },
  },
  {
    name: "atualizar_lead",
    description:
      "Atualiza campos de um lead: 'nome', 'preco' e/ou 'responsavel_id'. Para mudar de etapa use mover_lead.",
    inputSchema: {
      type: "object",
      properties: {
        lead_id: { type: "number" },
        nome: { type: "string" },
        preco: { type: "number" },
        responsavel_id: { type: "number" },
      },
      required: ["lead_id"],
    },
    handler: async (env, { lead_id, nome, preco, responsavel_id }) => {
      const body = {};
      if (nome != null) body.name = nome;
      if (preco != null) body.price = preco;
      if (responsavel_id != null) body.responsible_user_id = responsavel_id;
      if (!Object.keys(body).length) return "Nada para atualizar.";
      const l = await kommo(env, `/leads/${lead_id}`, { method: "PATCH", body });
      return `Lead ${lead_id} atualizado ✅`;
    },
  },
  {
    name: "buscar_contato",
    description: "Busca contatos por texto (nome, telefone ou email). Retorna id, nome e campos.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Texto de busca" },
        limite: { type: "number", description: "Quantidade (padrão 25)" },
      },
      required: ["query"],
    },
    handler: async (env, { query, limite }) => {
      const params = new URLSearchParams();
      params.set("limit", String(Math.min(limite || 25, 250)));
      params.set("query", query);
      const data = await kommo(env, `/contacts?${params.toString()}`);
      const contatos = (data?._embedded?.contacts || []).map(limparContato);
      if (!contatos.length) return `Nenhum contato encontrado para "${query}".`;
      return JSON.stringify({ total: contatos.length, contatos }, null, 2);
    },
  },
  {
    name: "criar_contato",
    description: "Cria um contato. Informe 'nome' (obrigatório), e opcionalmente 'telefone' e 'email'.",
    inputSchema: {
      type: "object",
      properties: {
        nome: { type: "string" },
        telefone: { type: "string" },
        email: { type: "string" },
      },
      required: ["nome"],
    },
    handler: async (env, { nome, telefone, email }) => {
      const body = [{ name: nome, custom_fields_values: camposContato({ telefone, email }) }];
      const data = await kommo(env, `/contacts`, { method: "POST", body });
      const id = data?._embedded?.contacts?.[0]?.id;
      return `Contato criado ✅ (id: ${id})`;
    },
  },
  {
    name: "adicionar_nota",
    description: "Adiciona uma nota (comentário de texto) a um lead.",
    inputSchema: {
      type: "object",
      properties: {
        lead_id: { type: "number" },
        texto: { type: "string", description: "Conteúdo da nota" },
      },
      required: ["lead_id", "texto"],
    },
    handler: async (env, { lead_id, texto }) => {
      const body = [{ note_type: "common", params: { text: texto } }];
      await kommo(env, `/leads/${lead_id}/notes`, { method: "POST", body });
      return `Nota adicionada ao lead ${lead_id} ✅`;
    },
  },
  {
    name: "criar_tarefa",
    description:
      "Cria uma tarefa vinculada a um lead. Informe 'lead_id', 'texto' e 'prazo_em_horas' (quantas horas a partir de agora; padrão 24). Opcional 'responsavel_id'.",
    inputSchema: {
      type: "object",
      properties: {
        lead_id: { type: "number" },
        texto: { type: "string", description: "Descrição da tarefa" },
        prazo_em_horas: { type: "number", description: "Prazo em horas a partir de agora (padrão 24)" },
        responsavel_id: { type: "number" },
      },
      required: ["lead_id", "texto"],
    },
    handler: async (env, { lead_id, texto, prazo_em_horas, responsavel_id }) => {
      const horas = prazo_em_horas || 24;
      const complete_till = Math.floor(Date.now() / 1000) + horas * 3600;
      const tarefa = { text: texto, entity_id: lead_id, entity_type: "leads", complete_till };
      if (responsavel_id) tarefa.responsible_user_id = responsavel_id;
      const data = await kommo(env, `/tasks`, { method: "POST", body: [tarefa] });
      const id = data?._embedded?.tasks?.[0]?.id;
      return `Tarefa criada no lead ${lead_id} ✅ (id: ${id})`;
    },
  },
  {
    name: "listar_usuarios",
    description: "Lista os usuários da conta Kommo (id, nome, email). Use os IDs como responsavel_id.",
    inputSchema: { type: "object", properties: {} },
    handler: async (env) => {
      const data = await kommo(env, `/users`);
      const usuarios = (data?._embedded?.users || []).map((u) => ({ id: u.id, nome: u.name, email: u.email }));
      return JSON.stringify(usuarios, null, 2);
    },
  },
];

// ---- Tratamento JSON-RPC do MCP ----
async function handleRpc(env, msg) {
  const { id, method, params } = msg;

  // Notificações (sem id) não retornam resposta.
  if (id === undefined || id === null) return null;

  try {
    if (method === "initialize") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: params?.protocolVersion || PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "kommo-crm", version: "1.0.0" },
        },
      };
    }

    if (method === "ping") return { jsonrpc: "2.0", id, result: {} };

    if (method === "tools/list") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          tools: TOOLS.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        },
      };
    }

    if (method === "tools/call") {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) {
        return { jsonrpc: "2.0", id, error: { code: -32602, message: `Ferramenta desconhecida: ${params?.name}` } };
      }
      try {
        const out = await tool.handler(env, params.arguments || {});
        return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: out }] } };
      } catch (e) {
        return {
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: `Erro: ${e.message}` }], isError: true },
        };
      }
    }

    return { jsonrpc: "2.0", id, error: { code: -32601, message: `Método não suportado: ${method}` } };
  } catch (e) {
    return { jsonrpc: "2.0", id, error: { code: -32603, message: String(e) } };
  }
}

// Consciencia de versao (puxada). O Worker checa o GitHub e avisa o DONO se
// estiver desatualizado. NAO manda nada pra ninguem: le so o arquivo VERSION do
// repo publico. E de proposito: mandar dado pra um servidor central contradiz a
// promessa de que o dado fica na conta do cliente.
const OPERA_VERSAO = "1.0.0";
async function statusVersao() {
  const repo = "opera-kommo";
  let ultima = null, atualizado = null, aviso;
  try {
    const r = await fetch(`https://raw.githubusercontent.com/igormoraesagl/${repo}/main/VERSION`, { cf: { cacheTtl: 3600 } });
    if (r.ok) { ultima = (await r.text()).trim(); atualizado = ultima === OPERA_VERSAO; }
  } catch (_) {}
  if (atualizado === false) {
    aviso = `Sua versao (${OPERA_VERSAO}) esta atras da ${ultima}. Reinstale pelo botao Deploy to Cloudflare do README para atualizar. Esta checagem le so o GitHub, nada e enviado a ninguem.`;
  }
  return { conector: repo, versao: OPERA_VERSAO, ultima, atualizado, aviso };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Healthcheck público
    if (request.method === "GET" && url.pathname === "/") {
      return new Response(JSON.stringify(await statusVersao(), null, 1), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // Endpoint MCP protegido por segredo no caminho: /<MCP_SECRET>/mcp
    const expected = `/${env.MCP_SECRET}/mcp`;
    if (url.pathname !== expected) {
      return new Response("Not found", { status: 404 });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Suporta requisição única ou batch.
    if (Array.isArray(body)) {
      const responses = (await Promise.all(body.map((m) => handleRpc(env, m)))).filter(Boolean);
      return new Response(JSON.stringify(responses), { headers: { "Content-Type": "application/json" } });
    }

    const response = await handleRpc(env, body);
    if (response === null) {
      return new Response(null, { status: 202 }); // notificação
    }
    return new Response(JSON.stringify(response), { headers: { "Content-Type": "application/json" } });
  },
};
