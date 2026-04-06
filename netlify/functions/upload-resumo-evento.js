// netlify/functions/upload-resumo-evento.js

const { createClient } = require('@supabase/supabase-js');
const formidable = require('formidable');
const { createReadStream } = require('fs');
const path = require('path');

// Configuração do Supabase (variáveis de ambiente)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; // use service_role para bypass RLS no upload

// Inicializa cliente Supabase com chave de serviço (permite upload em qualquer bucket)
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Bucket destino
const BUCKET_NAME = 'resumos-de-eventos';

// Helper: extrai headers de autenticação do usuário (enviados pelo front-end)
function getUserFromHeaders(headers) {
  // O front-end envia os mesmos headers que o AppPanel.currentUserHeaders() produz
  // Exemplo: { authorization: 'Bearer ...', 'x-user-id': '...' }
  const authHeader = headers.authorization || headers.Authorization;
  const userId = headers['x-user-id'] || headers['X-User-Id'];
  
  if (!authHeader || !userId) {
    return null;
  }
  // Aqui você pode validar o token JWT se desejar (usando a chave do Supabase JWT)
  // Para simplificar, confiamos que o header x-user-id foi repassado corretamente pelo gateway
  return { id: parseInt(userId, 10), token: authHeader };
}

exports.handler = async (event) => {
  // 1. Verifica método
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Allow': 'POST' },
      body: JSON.stringify({ erro: 'Método não permitido. Use POST.' })
    };
  }

  // 2. Autenticação do usuário (baseada nos headers)
  const user = getUserFromHeaders(event.headers);
  if (!user || !user.id) {
    return {
      statusCode: 401,
      body: JSON.stringify({ erro: 'Usuário não autenticado.' })
    };
  }

  // 3. Processar o upload do arquivo com formidable
  const form = formidable({
    multiples: false,
    keepExtensions: true,
    maxFileSize: 10 * 1024 * 1024, // 10 MB
    filter: function ({ name, originalFilename, mimetype }) {
      // Aceita apenas .doc e .docx
      const ext = path.extname(originalFilename || '').toLowerCase();
      return (ext === '.doc' || ext === '.docx');
    }
  });

  try {
    const { fields, files } = await new Promise((resolve, reject) => {
      form.parse(event, (err, fields, files) => {
        if (err) reject(err);
        else resolve({ fields, files });
      });
    });

    const arquivo = files.arquivo;
    if (!arquivo) {
      return {
        statusCode: 400,
        body: JSON.stringify({ erro: 'Nenhum arquivo enviado no campo "arquivo".' })
      };
    }

    // 4. Gerar nome único no bucket
    const timestamp = Date.now();
    const nomeOriginal = arquivo.originalFilename || 'resumo.doc';
    const extensao = path.extname(nomeOriginal);
    const nomeBase = path.basename(nomeOriginal, extensao).replace(/[^a-zA-Z0-9]/g, '_');
    const nomeUnico = `resumos/${user.id}/${timestamp}_${nomeBase}${extensao}`;

    // 5. Fazer upload para o Supabase Storage
    const fileStream = createReadStream(arquivo.filepath);
    const { data, error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(nomeUnico, fileStream, {
        cacheControl: '3600',
        upsert: false,
        contentType: arquivo.mimetype || 'application/msword'
      });

    if (uploadError) {
      console.error('Erro no upload para Supabase:', uploadError);
      return {
        statusCode: 500,
        body: JSON.stringify({ erro: 'Falha ao enviar arquivo para o storage.', detalhe: uploadError.message })
      };
    }

    // 6. Obter URL pública do arquivo
    const { data: urlData } = supabase.storage.from(BUCKET_NAME).getPublicUrl(nomeUnico);
    const publicUrl = urlData.publicUrl;

    // 7. (Opcional) Salvar metadados no banco Neon via outra função ou diretamente aqui
    // Você pode chamar uma função separada para inserir na tabela resumos_eventos.
    // Exemplo via fetch para seu próprio endpoint (ou chamada direta ao banco)
    // Por simplicidade, retornamos a URL e o ID do usuário. O front-end enviará junto com a solicitação de certificado.

    return {
      statusCode: 200,
      body: JSON.stringify({
        sucesso: true,
        url: publicUrl,
        caminho: nomeUnico,
        nome_original: nomeOriginal
      })
    };
  } catch (err) {
    console.error('Erro no processamento:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ erro: 'Erro interno no servidor.', detalhe: err.message })
    };
  }
};