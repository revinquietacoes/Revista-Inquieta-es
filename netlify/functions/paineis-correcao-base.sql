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

ALTER TABLE IF EXISTS designacoes_avaliacao ADD COLUMN IF NOT EXISTS editor_id BIGINT;
ALTER TABLE IF EXISTS designacoes_avaliacao ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'convite_enviado';
ALTER TABLE IF EXISTS designacoes_avaliacao ADD COLUMN IF NOT EXISTS prazo_resposta DATE;
ALTER TABLE IF EXISTS designacoes_avaliacao ADD COLUMN IF NOT EXISTS prazo_parecer DATE;
ALTER TABLE IF EXISTS designacoes_avaliacao ADD COLUMN IF NOT EXISTS dias_adicionais INTEGER NOT NULL DEFAULT 0;
ALTER TABLE IF EXISTS designacoes_avaliacao ADD COLUMN IF NOT EXISTS mensagem_convite TEXT;
ALTER TABLE IF EXISTS designacoes_avaliacao ADD COLUMN IF NOT EXISTS criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE IF EXISTS designacoes_avaliacao ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE IF EXISTS avaliacoes ADD COLUMN IF NOT EXISTS designacao_id BIGINT;
ALTER TABLE IF EXISTS avaliacoes ADD COLUMN IF NOT EXISTS comentario_autor TEXT;
ALTER TABLE IF EXISTS avaliacoes ADD COLUMN IF NOT EXISTS comentario_editor TEXT;
ALTER TABLE IF EXISTS avaliacoes ADD COLUMN IF NOT EXISTS parecer_final TEXT;
ALTER TABLE IF EXISTS avaliacoes ADD COLUMN IF NOT EXISTS tempo_avaliacao TEXT;
ALTER TABLE IF EXISTS avaliacoes ADD COLUMN IF NOT EXISTS devolutiva_url TEXT;
ALTER TABLE IF EXISTS avaliacoes ADD COLUMN IF NOT EXISTS devolutiva_doc_url TEXT;
ALTER TABLE IF EXISTS avaliacoes ADD COLUMN IF NOT EXISTS criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE IF EXISTS avaliacoes ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS contribuicoes_usuarios (
  usuario_id BIGINT PRIMARY KEY,
  total_submissoes INTEGER NOT NULL DEFAULT 0,
  total_avaliacoes INTEGER NOT NULL DEFAULT 0,
  total_dossies INTEGER NOT NULL DEFAULT 0,
  total_decisoes_editoriais INTEGER NOT NULL DEFAULT 0,
  observacoes TEXT,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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
CREATE INDEX IF NOT EXISTS idx_arquivos_publicacao_blob_key ON arquivos_publicacao (blob_key);
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

CREATE TABLE IF NOT EXISTS historico_status_submissoes (
  id BIGSERIAL PRIMARY KEY,
  submissao_id BIGINT NOT NULL,
  status_anterior TEXT,
  status_novo TEXT NOT NULL,
  observacao TEXT,
  atualizado_por BIGINT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_historico_status_submissoes_submissao_id ON historico_status_submissoes (submissao_id, criado_em DESC);

CREATE TABLE IF NOT EXISTS avaliacoes_v2 (
  id BIGSERIAL PRIMARY KEY,
  designacao_id BIGINT NOT NULL UNIQUE,
  submissao_id BIGINT NOT NULL,
  parecerista_id BIGINT NOT NULL,
  relevancia_academica TEXT,
  clareza_organizacao TEXT,
  consistencia_teorica TEXT,
  adequacao_metodologica TEXT,
  qualidade_redacao TEXT,
  contribuicao_relevante_area TEXT,
  comentario_autor TEXT,
  comentario_editor TEXT,
  parecer_final TEXT,
  tempo_avaliacao TEXT,
  devolutiva_url TEXT,
  devolutiva_doc_url TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_avaliacoes_v2_submissao_id ON avaliacoes_v2 (submissao_id);
CREATE INDEX IF NOT EXISTS idx_avaliacoes_v2_parecerista_id ON avaliacoes_v2 (parecerista_id);

CREATE OR REPLACE FUNCTION public.registrar_decisao_editorial_parecer(
  p_designacao_id BIGINT,
  p_editor_id BIGINT,
  p_decisao TEXT,
  p_observacao TEXT DEFAULT ''
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_submissao_id BIGINT;
BEGIN
  SELECT submissao_id INTO v_submissao_id
  FROM designacoes_avaliacao
  WHERE id = p_designacao_id
  LIMIT 1;

  IF v_submissao_id IS NULL THEN
    RAISE EXCEPTION 'Designação não encontrada.';
  END IF;

  UPDATE designacoes_avaliacao
  SET status = CASE
    WHEN p_decisao IN ('validado','aprovado','concluido') THEN 'concluido'
    WHEN p_decisao IN ('recusado','rejeitado') THEN 'recusado'
    ELSE COALESCE(status, 'concluido')
  END,
      atualizado_em = CURRENT_TIMESTAMP
  WHERE id = p_designacao_id;

  UPDATE submissoes
  SET status = CASE
    WHEN p_decisao IN ('aceito','aprovado') THEN 'aceito'
    WHEN p_decisao IN ('aceito_com_correcoes','correcoes_necessarias') THEN p_decisao
    WHEN p_decisao IN ('rejeitado','recusado') THEN 'rejeitado'
    ELSE COALESCE(status, 'em_avaliacao')
  END,
      status_atualizado_em = CURRENT_TIMESTAMP,
      status_atualizado_por = p_editor_id
  WHERE id = v_submissao_id;

  INSERT INTO historico_status_submissoes (submissao_id, status_anterior, status_novo, observacao, atualizado_por)
  VALUES (v_submissao_id, NULL, COALESCE(p_decisao, 'sem_decisao'), NULLIF(p_observacao, ''), p_editor_id);

  INSERT INTO contribuicoes_usuarios (usuario_id, total_decisoes_editoriais)
  VALUES (p_editor_id, 1)
  ON CONFLICT (usuario_id)
  DO UPDATE SET
    total_decisoes_editoriais = contribuicoes_usuarios.total_decisoes_editoriais + 1,
    atualizado_em = CURRENT_TIMESTAMP;
END;
$$;

CREATE OR REPLACE VIEW public.vw_fila_decisao_editorial AS
SELECT
  da.id AS designacao_id,
  da.submissao_id,
  da.parecerista_id,
  da.status AS designacao_status,
  da.prazo_parecer,
  da.dias_adicionais,
  da.criado_em AS designado_em,
  s.titulo,
  s.status AS submissao_status,
  s.secao,
  u.nome AS parecerista_nome,
  COALESCE(av2.parecer_final, av.parecer_final) AS parecer_final,
  COALESCE(av2.comentario_editor, av.comentario_editor) AS comentario_editor,
  COALESCE(av2.comentario_autor, av.comentario_autor) AS comentario_autor,
  COALESCE(av2.devolutiva_doc_url, av2.devolutiva_url, av.devolutiva_doc_url, av.devolutiva_url) AS devolutiva_url,
  COALESCE(av2.atualizado_em, av.atualizado_em, da.atualizado_em, da.criado_em) AS atualizado_em
FROM designacoes_avaliacao da
JOIN submissoes s ON s.id = da.submissao_id
LEFT JOIN usuarios u ON u.id = da.parecerista_id
LEFT JOIN avaliacoes_v2 av2 ON av2.designacao_id = da.id
LEFT JOIN avaliacoes av ON av.designacao_id = da.id
WHERE da.status IN ('aceito', 'em_andamento', 'concluido');
