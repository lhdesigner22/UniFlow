-- Gestão → Cases de Sucesso: vitrine das entregas da TI no ano, feita para
-- apresentar à diretoria (antes → o que fizemos → resultado). Conteúdo
-- institucional: sem separação por departamento (todos com acesso à Gestão
-- veem). Ver server/src/routes/successCases.js.
CREATE TABLE IF NOT EXISTS success_cases (
  id TEXT PRIMARY KEY,
  year INTEGER NOT NULL,
  title TEXT NOT NULL,          -- título em linguagem simples
  pillar TEXT NOT NULL,         -- conectividade | seguranca | gestao | operacao
  headline TEXT,                -- uma frase curta para o cartão
  before_text TEXT,             -- como era antes
  solution_text TEXT,           -- o que a TI fez
  result_value TEXT,            -- número em destaque (ex: "−40%"), opcional
  result_label TEXT,            -- o que o número/resultado significa
  technical TEXT,               -- detalhe técnico (fica recolhido)
  status TEXT NOT NULL DEFAULT 'concluido', -- concluido | piloto | andamento
  completed_on TEXT,            -- YYYY-MM
  owner TEXT,                   -- responsáveis
  live_metric TEXT,             -- número ao vivo do UniFlow (opcional)
  order_index INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_success_cases_year ON success_cases(year, order_index);

CREATE TABLE IF NOT EXISTS success_case_photos (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  thumb TEXT NOT NULL,          -- miniatura (data URL)
  data TEXT NOT NULL,           -- foto grande (data URL), só sob demanda
  caption TEXT,                 -- ex: "Antes", "Depois"
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_success_case_photos_case ON success_case_photos(case_id, created_at);

-- Os 12 cases de 2026 (textos iniciais; o Luiz ajusta pela tela).
INSERT OR IGNORE INTO success_cases (id, year, title, pillar, headline, before_text, solution_text, result_label, technical, status, owner, live_metric, order_index) VALUES
('case-2026-wifi', 2026, 'Wi-Fi padronizado em todos os prédios', 'conectividade',
 'Um só padrão de Wi-Fi, gerenciado de um painel',
 'Duas marcas de equipamento (Ubiquiti e Ruckus), cada prédio de um jeito e gestão separada.',
 'Padronizamos os pontos de acesso e centralizamos o gerenciamento.',
 'Sinal mais estável e manutenção mais rápida', 'Padronização Ubiquiti × Ruckus.', 'concluido', 'Equipe de TI', NULL, 0),
('case-2026-anel', 2026, 'Prédios ligados por fibra em anel', 'conectividade',
 'Se um cabo romper, a internet encontra outro caminho',
 'Um único caminho de fibra: um rompimento deixava o prédio sem rede.',
 'Ligamos os prédios em anel óptico, com caminho alternativo.',
 'Rede redundante entre os prédios', 'Anel óptico.', 'concluido', 'Equipe de TI', NULL, 1),
('case-2026-dns', 2026, 'Navegação sob controle da TI', 'conectividade',
 'Internet mais rápida e com sites perigosos bloqueados',
 'A resolução de nomes dependia de serviços externos, sem controle da TI.',
 'Implantamos um servidor de DNS próprio.',
 'Mais controle e mais velocidade na navegação', 'Implantação de DNS.', 'concluido', 'Equipe de TI', NULL, 2),
('case-2026-vlan', 2026, 'Redes separadas por público', 'seguranca',
 'Alunos, administrativo e equipamentos em redes diferentes',
 'Todos na mesma rede: um problema em um computador podia afetar os outros.',
 'Separamos a rede em segmentos (VLANs) por tipo de uso.',
 'Um incidente fica contido no seu segmento', 'Segmentação de redes por VLAN.', 'concluido', 'Equipe de TI', NULL, 3),
('case-2026-wpa2', 2026, 'Wi-Fi dos alunos protegido', 'seguranca',
 'Rede dos alunos com senha e criptografia',
 'A rede dos alunos não tinha a proteção adequada.',
 'Ativamos a segurança WPA2 na rede dos alunos.',
 'Tráfego dos alunos criptografado', 'WPA2 no Wi-Fi da rede Alunos.', 'concluido', 'Equipe de TI', NULL, 4),
('case-2026-provas', 2026, 'Prova sem consulta à internet', 'seguranca',
 'Durante a prova, só o site da prova abre',
 'O aluno podia acessar qualquer site durante a prova no laboratório.',
 'Bloqueio de internet nos laboratórios liberando só a URL da prova.',
 'Validado no Laboratório 5 — próximo passo: expandir', 'Bloqueio de internet em provas (apenas a URL da prova liberada).', 'piloto', 'Equipe de TI', NULL, 5),
('case-2026-glpi', 2026, 'Pedidos à TI organizados', 'gestao',
 'Todo pedido registrado, com responsável e prazo',
 'Pedidos chegavam por vários canais, sem registro nem acompanhamento.',
 'Implantamos a ferramenta de chamados GLPI (ITSM).',
 'Atendimento medido e rastreável', 'Implantação do GLPI.', 'concluido', 'Equipe de TI', 'glpi_tickets', 6),
('case-2026-termos', 2026, 'Termos digitais', 'gestao',
 'Entrega de equipamento sem papel',
 'Termos de responsabilidade impressos, assinados e guardados em papel.',
 'Os termos passaram a ser digitais.',
 'Menos papel e documentos fáceis de encontrar', 'Termos digitais.', 'concluido', 'Equipe de TI', NULL, 7),
('case-2026-inventario', 2026, 'Inventário de TI', 'gestao',
 'Sabemos o que temos, onde está e com quem',
 'Não havia um levantamento completo dos equipamentos.',
 'Fizemos o inventário dos equipamentos de TI.',
 'Cada equipamento com local e responsável', 'Inventário de TI.', 'concluido', 'Equipe de TI', NULL, 8),
('case-2026-kits', 2026, 'Kits de equipamentos', 'operacao',
 'Equipamento pronto para a aula, sem improviso',
 'Os equipamentos eram separados e montados na hora.',
 'Montamos kits prontos para empréstimo.',
 'Atendimento mais rápido às salas', 'Kits de equipamentos.', 'concluido', 'Equipe de TI', 'loans_year', 9),
('case-2026-catracas', 2026, 'Servidor das catracas na UniFECAF', 'operacao',
 'O servidor das catracas agora é nosso e local',
 'O servidor das catracas não ficava aqui e a TI não conseguia administrá-lo.',
 'Trouxemos o servidor das catracas para dentro da UniFECAF.',
 'A própria TI administra o sistema de acesso', 'Servidor das catracas local.', 'concluido', 'Equipe de TI', NULL, 10),
('case-2026-uniflow', 2026, 'UniFlow', 'gestao',
 'Um sistema próprio para a gestão da TI',
 'Controles em planilhas e ferramentas soltas.',
 'Desenvolvemos o UniFlow: quadros, chamados, empréstimos, impressoras, insumos e incidentes num só lugar.',
 'Sem custo de servidor (plano gratuito)', 'Cloudflare Workers + D1, login Google.', 'concluido', 'Equipe de TI', 'uniflow_modules', 11);
