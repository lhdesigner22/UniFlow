// Limite de tentativas (binding de Rate Limiting do Workers — `ratelimits` no
// wrangler.jsonc). Só nos pontos sensíveis, não na API toda (o app faz muitas
// leituras legítimas por causa do tempo real):
//   LOGIN_LIMITER  — entrar com o Google, por IP;
//   SECRET_LIMITER — ver/copiar senha (Cofre e VLANs) e pedir ticket de download, por pessoa.
// O limite é contado por local da Cloudflare (aproximado) — serve pra frear
// força bruta e robô, não como contagem exata. O log de auditoria continua
// sendo a vigilância fina (aviso de 10 senhas em 10 min).
// Sem o binding (teste local no Node) não limita nada.

export function rateLimit(binding, keyOf, message) {
  return async (c, next) => {
    const limiter = c.env[binding]
    if (limiter) {
      const { success } = await limiter.limit({ key: keyOf(c) })
      if (!success) return c.json({ error: message }, 429)
    }
    await next()
  }
}

export const byIp = c => c.req.header('CF-Connecting-IP') || 'local'
export const byUser = c => c.get('user')?.id || byIp(c)
