// Fábrica de acesso ao banco — D1 (Cloudflare) por baixo.
// Mantém o MESMO shape que as rotas já usam (prepare().get/all/run, scalar, batch),
// então nenhuma rota precisa mudar sua lógica SQL, só como recebe a instância `db`
// (antes: import direto do módulo; agora: criada por requisição a partir de c.env.DB,
// porque em Workers o binding só existe dentro do fetch/handler, não no escopo do módulo).
//
// Schema: não é mais criado aqui a cada boot — vive versionado em migrations/*.sql,
// aplicado com `npx wrangler d1 migrations apply uniflow`.

function prepare(env, sql) {
  return {
    async get(...args) {
      return await env.DB.prepare(sql).bind(...args.flat()).first()
    },
    async all(...args) {
      const r = await env.DB.prepare(sql).bind(...args.flat()).all()
      return r.results
    },
    async run(...args) {
      return await env.DB.prepare(sql).bind(...args.flat()).run()
    }
  }
}

async function scalar(env, sql, ...args) {
  const row = await env.DB.prepare(sql).bind(...args.flat()).raw()
  if (!row.length) return undefined
  return row[0][0]
}

// Transação atômica — mesma assinatura de antes: array de { sql, args }
async function batch(env, statements) {
  await env.DB.batch(statements.map(s => env.DB.prepare(s.sql).bind(...(s.args || []).flat())))
}

export function createDb(env) {
  return {
    prepare: (sql) => prepare(env, sql),
    scalar: (sql, ...args) => scalar(env, sql, ...args),
    batch: (statements) => batch(env, statements),
  }
}
