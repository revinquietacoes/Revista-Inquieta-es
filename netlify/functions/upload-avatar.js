const Busboy = require("busboy")

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

        await new Promise((resolve, reject) => {
            busboy.on("file", (fieldname, file, info) => {
                mimeType = info.mimeType
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
        // Chave simples: usuarioId-timestamp-random.ext
        const key = `${usuarioId}-${timestamp}-${random}.${extension}`

        const siteID = process.env.NETLIFY_BLOBS_SITE_ID
        const token = process.env.NETLIFY_BLOBS_TOKEN
        const storeName = "avatars"   // store exclusivo

        if (!siteID || !token) {
            throw new Error("Variáveis de ambiente do Blobs não configuradas")
        }

        const blobUrl = `https://api.netlify.com/api/v1/sites/${siteID}/blobs/${storeName}/${encodeURIComponent(key)}`

        const uploadResponse = await fetch(blobUrl, {
            method: "PUT",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": mimeType
            },
            body: fileBuffer
        })

        if (!uploadResponse.ok) {
            const errorText = await uploadResponse.text()
            throw new Error(`Erro ao salvar blob: ${uploadResponse.status} - ${errorText}`)
        }

        console.log(`✅ Avatar salvo em 'avatars': ${key} (${fileBuffer.length} bytes)`)

        // URL pública via função avatar (ainda usaremos a mesma função)
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