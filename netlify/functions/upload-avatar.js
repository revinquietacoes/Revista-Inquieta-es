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
        console.log("=== UPLOAD-AVATAR INICIADO ===")
        const usuarioId = event.headers["x-user-id"]
        if (!usuarioId) {
            return {
                statusCode: 401,
                headers: corsHeaders,
                body: JSON.stringify({ erro: "Usuário não autenticado" })
            }
        }

        // Processar o multipart form
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

        if (!fileBuffer || fileBuffer.length === 0) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ erro: "Arquivo não enviado" })
            }
        }

        console.log(`Arquivo recebido: ${fileBuffer.length} bytes, tipo: ${mimeType}`)

        // Usar API REST do Netlify Blobs
        const siteID = process.env.NETLIFY_BLOBS_SITE_ID
        const token = process.env.NETLIFY_BLOBS_TOKEN
        const storeName = "arquivos"

        if (!siteID || !token) {
            throw new Error("Variáveis de ambiente do Blobs não configuradas")
        }

        const timestamp = Date.now()
        const random = Math.random().toString(36).substring(2, 8)
        const key = `usuarios/${usuarioId}-${timestamp}-${random}.webp`

        const blobUrl = `https://api.netlify.com/api/v1/sites/${siteID}/blobs/${storeName}/${key}`

        const uploadResponse = await fetch(blobUrl, {
            method: "PUT",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": mimeType || "image/webp"
            },
            body: fileBuffer
        })

        if (!uploadResponse.ok) {
            throw new Error(`Erro ao salvar blob: ${uploadResponse.status} ${uploadResponse.statusText}`)
        }

        const baseUrl = process.env.URL || `https://${event.headers.host}`
        const fotoUrl = `${baseUrl}/.netlify/blobs/${storeName}/${key}`

        console.log("Upload bem-sucedido. URL:", fotoUrl)

        return {
            statusCode: 200,
            headers: {
                ...corsHeaders,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                sucesso: true,
                url: fotoUrl,
                mensagem: "Avatar salvo com sucesso!"
            })
        }
    } catch (err) {
        console.error("ERRO NA FUNÇÃO:", err)
        console.error("STACK:", err.stack)
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                erro: "Erro interno do servidor",
                detalhe: err.message
            })
        }
    }
}