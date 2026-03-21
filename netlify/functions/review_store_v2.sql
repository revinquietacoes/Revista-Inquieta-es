-- Tabela alternativa para teste do fluxo de parecer.
-- O anexo continua sendo salvo nas bolhas do Netlify por upload-material.js.
-- O formulário passa a gravar nesta tabela nova e, em paralelo, tenta espelhar na tabela antiga sem bloquear o envio.

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

INSERT INTO avaliacoes_v2 (
  designacao_id,
  submissao_id,
  parecerista_id,
  relevancia_academica,
  clareza_organizacao,
  consistencia_teorica,
  adequacao_metodologica,
  qualidade_redacao,
  contribuicao_relevante_area,
  comentario_autor,
  comentario_editor,
  parecer_final,
  tempo_avaliacao,
  devolutiva_url,
  devolutiva_doc_url,
  criado_em,
  atualizado_em
)
SELECT
  a.designacao_id,
  a.submissao_id,
  a.parecerista_id,
  a.relevancia_academica,
  a.clareza_organizacao,
  a.consistencia_teorica,
  a.adequacao_metodologica,
  a.qualidade_redacao,
  a.contribuicao_relevante_area,
  a.comentario_autor,
  a.comentario_editor,
  a.parecer_final,
  a.tempo_avaliacao,
  COALESCE(a.devolutiva_url, a.devolutiva_doc_url),
  COALESCE(a.devolutiva_doc_url, a.devolutiva_url),
  COALESCE(a.criado_em, CURRENT_TIMESTAMP),
  COALESCE(a.atualizado_em, a.updated_at, CURRENT_TIMESTAMP)
FROM avaliacoes a
WHERE a.designacao_id IS NOT NULL
ON CONFLICT (designacao_id) DO NOTHING;
