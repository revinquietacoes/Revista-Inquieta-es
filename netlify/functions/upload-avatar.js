const Busboy = require("busboy")
const { makeStore } = require("./_blobs")

exports.handler = async (event) => {
    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-User-Id",
        "Access-Control-Max-Age": "86400"
    }

    if (event.httpMethod === "OPTIONS") {
        return { statusCode: 204, headers: corsHeaders, body: "" }
    }

    if (event.httpMethod !== "POST") {
        return {
            statusCode: 405,
            headers: corsHeaders,
            body: JSON.stringify({ erro: "Método não permitido" })
        }
    }

    try {
        const usuarioId = event.headers["x-user-id"]
        if (!usuarioId) {
            return {
                statusCode: 401,
                headers: corsHeaders,
                body: JSON.stringify({ erro: "Usuário não autenticado" })
            }
        }

        const busboy = Busboy({ headers: event.headers })
        let fileBuffer = null
        let mimeType = "image/webp"
        let originalName = null

        await new Promise((resolve, reject) => {
            busboy.on("file", (fieldname, file, info) => {
                mimeType = info.mimeType
                originalName = info.filename
                const chunks = []
                file.on("data", (chunk) => chunks.push(chunk))
                file.on("end", () => {
                    fileBuffer = Buffer.concat(chunks)
                    resolve()
                })
                file.on("error", reject)
            })
            busboy.on("error", reject)
            busboy.on("finish", () => resolve())
            busboy.end(Buffer.from(event.body, "base64"))
        })

        if (!fileBuffer) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ erro: "Arquivo não enviado" })
            }
        }

        // Determinar extensão
        let extension = "webp"
        if (mimeType === "image/jpeg") extension = "jpg"
        else if (mimeType === "image/png") extension = "png"
        else if (mimeType === "image/gif") extension = "gif"

        const timestamp = Date.now()
        const random = Math.random().toString(36).substring(2, 8)
        const key = `usuarios/${usuarioId}/avatar/${timestamp}-${random}.${extension}`

        // Usar makeStore do projeto (já configurado)
        const store = makeStore("revista-arquivos")

        await store.set(key, fileBuffer, {
            contentType: mimeType,
            public: true
        })

        console.log(`✅ Avatar salvo: ${key} (${fileBuffer.length} bytes)`)

        const avatarUrl = `/.netlify/functions/avatar?key=${encodeURIComponent(key)}`

        return {
            statusCode: 200,
            headers: {
                ...corsHeaders,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                sucesso: true,
                url: avatarUrl,
                key: key,
                mensagem: "Avatar salvo com sucesso!"
            })
        }
    } catch (err) {
        console.error("❌ Erro no upload:", err)
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                erro: "Erro interno",
                detalhe: err.message
            })
        }
    }
}