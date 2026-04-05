const Busboy = require("busboy");
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-User-Id",
        "Access-Control-Max-Age": "86400"
    };

    if (event.httpMethod === "OPTIONS") {
        return { statusCode: 204, headers: corsHeaders, body: "" };
    }

    if (event.httpMethod !== "POST") {
        return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ erro: "Método não permitido" }) };
    }

    try {
        const usuarioId = event.headers["x-user-id"];
        if (!usuarioId) {
            return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ erro: "Usuário não autenticado" }) };
        }

        const busboy = Busboy({ headers: event.headers });
        let fileBuffer = null;
        let mimeType = "image/webp";

        await new Promise((resolve, reject) => {
            busboy.on("file", (fieldname, file, info) => {
                mimeType = info.mimeType;
                const chunks = [];
                file.on("data", (chunk) => chunks.push(chunk));
                file.on("end", () => {
                    fileBuffer = Buffer.concat(chunks);
                    resolve();
                });
                file.on("error", reject);
            });
            busboy.on("error", reject);
            busboy.on("finish", () => resolve());
            busboy.end(Buffer.from(event.body, "base64"));
        });

        if (!fileBuffer) {
            return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ erro: "Arquivo não enviado" }) };
        }

        let extension = "webp";
        if (mimeType === "image/jpeg") extension = "jpg";
        else if (mimeType === "image/png") extension = "png";
        else if (mimeType === "image/gif") extension = "gif";

        const fileName = `${usuarioId}-${Date.now()}.${extension}`;
        const filePath = `${usuarioId}/${fileName}`;

        // Inicializa Supabase com a SERVICE_ROLE_KEY (para ter permissão de escrita)
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // você precisará criar essa variável
        if (!supabaseUrl || !supabaseServiceKey) {
            throw new Error("Variáveis SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não definidas");
        }
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        // Upload para o bucket 'avatars'
        const { data: uploadData, error: uploadError } = await supabase.storage
            .from('avatars')
            .upload(filePath, fileBuffer, {
                contentType: mimeType,
                upsert: true
            });

        if (uploadError) throw new Error(`Erro no upload Supabase: ${uploadError.message}`);

        // Obter URL pública
        const { data: publicUrlData } = supabase.storage.from('avatars').getPublicUrl(filePath);
        const publicUrl = publicUrlData.publicUrl;

        // Atualizar o banco Neon com a URL (usando sua action.js ou diretamente via Neon)
        // Como você já tem uma função action.js que recebe update_profile, vamos chamá-la via fetch interno
        // Para evitar loop, você pode fazer uma chamada HTTP para sua própria função data/action ou atualizar diretamente o Neon.
        // Vou optar por atualizar diretamente o Neon (já que temos a conexão via _db.js)
        const { sql } = require('./_db');
        await sql`
            UPDATE usuarios
            SET foto_perfil_url = ${publicUrl},
                atualizado_em = CURRENT_TIMESTAMP
            WHERE id = ${Number(usuarioId)}
        `;

        console.log(`✅ Avatar salvo no Supabase: ${publicUrl}`);

        return {
            statusCode: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            body: JSON.stringify({
                sucesso: true,
                url: publicUrl,
                mensagem: "Avatar salvo com sucesso!"
            })
        };
    } catch (err) {
        console.error("❌ Erro no upload:", err);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ erro: "Erro interno", detalhe: err.message })
        };
    }
};