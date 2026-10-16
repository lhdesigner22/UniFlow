-- Segmentação de VLANs por local (Gestão → Segmentação de VLANs). `site`:
-- 'matriz' (prédios G5 e SEDE) ou 'administrativo'. Só o ESQUEMA vai aqui —
-- os dados (inclusive as senhas de Wi-Fi) são carregados fora do repositório.
CREATE TABLE IF NOT EXISTS vlan_networks (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  site TEXT NOT NULL,
  segment TEXT NOT NULL,            -- 'docente' | 'discente'
  name TEXT NOT NULL,
  vlan_id INTEGER NOT NULL,
  network TEXT,
  mask TEXT,
  gateway TEXT,
  broadcast TEXT,
  dhcp_range TEXT,
  usable_ips INTEGER,
  order_index INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_vlan_networks_site ON vlan_networks(site, segment, order_index);

CREATE TABLE IF NOT EXISTS vlan_ssids (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  site TEXT NOT NULL,
  ssid TEXT NOT NULL,
  password TEXT,
  vlan_id TEXT,                     -- texto: algumas linhas não têm VLAN ("-")
  note TEXT,
  order_index INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_vlan_ssids_site ON vlan_ssids(site, order_index);
