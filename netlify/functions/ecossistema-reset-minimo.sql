ALTER TABLE IF EXISTS usuarios ADD COLUMN IF NOT EXISTS ultimo_acesso_em TIMESTAMPTZ;
ALTER TABLE IF EXISTS usuarios ADD COLUMN IF NOT EXISTS online BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE IF EXISTS usuarios ADD COLUMN IF NOT EXISTS foto_perfil_url TEXT;
ALTER TABLE IF EXISTS usuarios ADD COLUMN IF NOT EXISTS foto_perfil_aprovada BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE IF EXISTS usuarios ADD COLUMN IF NOT EXISTS consentimento_foto_publica BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE IF EXISTS usuarios ADD COLUMN IF NOT EXISTS receber_noticias_email BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE IF EXISTS usuarios ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ativo';
ALTER TABLE IF EXISTS usuarios ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE IF EXISTS submissoes ADD COLUMN IF NOT EXISTS editor_responsavel_id BIGINT;
ALTER TABLE IF EXISTS submissoes ADD COLUMN IF NOT EXISTS editor_adjunto_id BIGINT;
ALTER TABLE IF EXISTS submissoes ADD COLUMN IF NOT EXISTS dossie_id BIGINT;
ALTER TABLE IF EXISTS submissoes ADD COLUMN IF NOT EXISTS prazo_final_avaliacao DATE;
ALTER TABLE IF EXISTS submissoes ADD COLUMN IF NOT EXISTS status_atualizado_em TIMESTAMPTZ;
ALTER TABLE IF EXISTS submissoes ADD COLUMN IF NOT EXISTS status_atualizado_por BIGINT;
ALTER TABLE IF EXISTS submissoes ADD COLUMN IF NOT EXISTS data_submissao TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE IF EXISTS submissoes ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'submetido';

CREATE TABLE IF NOT EXISTS arquivos_publicacao (
  id BIGSERIAL PRIMARY KEY,
  usuario_id BIGINT,
  submissao_id BIGINT,
  categoria TEXT NOT NULL,
  nome_original TEXT,
  mime_type TEXT,
  tamanho_bytes BIGINT,
  blob_key TEXT NOT NULL,
  blob_store TEXT NOT NULL DEFAULT 'revista-arquivos',
  url_acesso TEXT NOT NULL,
  publico BOOLEAN NOT NULL DEFAULT FALSE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_arquivos_publicacao_submissao_id ON arquivos_publicacao (submissao_id);

CREATE TABLE IF NOT EXISTS certificados_privados (
  id BIGSERIAL PRIMARY KEY,
  usuario_id BIGINT NOT NULL,
  enviado_por_usuario_id BIGINT,
  titulo TEXT NOT NULL,
  descricao TEXT,
  tipo TEXT NOT NULL DEFAULT 'evento',
  categoria TEXT NOT NULL DEFAULT 'certificado_evento',
  blob_key TEXT NOT NULL,
  nome_arquivo TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/pdf',
  tamanho_bytes BIGINT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_certificados_privados_usuario_id ON certificados_privados (usuario_id);

CREATE TABLE IF NOT EXISTS mensagens_internas (
  id BIGSERIAL PRIMARY KEY,
  remetente_id BIGINT NOT NULL,
  destinatario_id BIGINT NOT NULL,
  mensagem TEXT NOT NULL,
  anexo_url TEXT,
  anexo_nome TEXT,
  anexo_mime TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_mensagens_internas_conversa ON mensagens_internas (remetente_id, destinatario_id, criado_em DESC);
