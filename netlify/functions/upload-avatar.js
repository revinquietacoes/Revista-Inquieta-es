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

        // Usar o makeStore do projeto (já configurado com siteID e token)
        const store = makeStore("arquivos")
        const timestamp = Date.now()
        const random = Math.random().toString(36).substring(2, 8)
        const key = `usuarios/${usuarioId}-${timestamp}-${random}.webp`

        await store.set(key, fileBuffer, { contentType: mimeType || "image/webp" })

        const baseUrl = process.env.URL || `https://${event.headers.host}`
        const fotoUrl = `${baseUrl}/.netlify/blobs/arquivos/${key}`

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
                detalhe: err.message,
                stack: process.env.NODE_ENV === "development" ? err.stack : undefined
            })
        }
    }
}