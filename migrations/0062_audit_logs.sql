-- Logs de auditoria (Admin → Logs). Uma linha por acontecimento: quem, quando,
-- de onde (IP/navegador) e o quê. Só se escreve (não há rota de editar/apagar);
-- a limpeza automática por idade fica no cron (lib/audit.js → purgeAuditLogs).
--   category: 'vault' (Cofre de Senhas e senhas de Wi-Fi das VLANs — vigilância
--             reforçada, nunca apagado), 'change' (qualquer alteração no sistema),
--             'page' (tela aberta), 'auth' (entrada/saída), 'audit' (exportação dos logs)
--   severity: 'info' | 'warning' (revelou/copiou senha, acesso negado) | 'critical'
--   user_name/user_email: cópia do momento — o log continua legível se a pessoa sair.
-- Nunca guarda senha nem corpo de requisição.
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  user_id TEXT,
  user_name TEXT,
  user_email TEXT,
  category TEXT NOT NULL,
  action TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  method TEXT,
  path TEXT,
  status INTEGER,
  target_id TEXT,
  target_label TEXT,
  details TEXT,
  ip TEXT,
  user_agent TEXT
);

-- Lista (mais novo primeiro, paginada pelo id), filtros por área e por pessoa,
-- e as contagens do Cofre (alerta de muitas senhas reveladas em pouco tempo).
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_category ON audit_logs(category, id);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id, id);
CREATE INDEX IF NOT EXISTS idx_audit_user_action ON audit_logs(user_id, action, created_at);
