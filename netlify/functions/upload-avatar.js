const Busboy = require("busboy");

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

        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!supabaseUrl || !supabaseServiceKey) {
            throw new Error("Variáveis SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não definidas");
        }

        // Upload para o Supabase Storage via API REST
        const uploadUrl = `${supabaseUrl}/storage/v1/object/avatars/${filePath}`;
        const uploadResponse = await fetch(uploadUrl, {
            method: "PUT",
            headers: {
                "Authorization": `Bearer ${supabaseServiceKey}`,
                "Content-Type": mimeType
            },
            body: fileBuffer
        });

        if (!uploadResponse.ok) {
            const errorText = await uploadResponse.text();
            throw new Error(`Erro no upload Supabase: ${uploadResponse.status} - ${errorText}`);
        }

        // URL pública do arquivo
        const publicUrl = `${supabaseUrl}/storage/v1/object/public/avatars/${filePath}`;

        // Atualizar o banco Neon (usando sua função _db.js)
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