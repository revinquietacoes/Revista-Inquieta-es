const { makeStore } = require("./_blobs")

exports.handler = async (event) => {
    try {
        console.log("=== AVATAR FUNCTION START ===")
        const key = event.queryStringParameters?.key

        if (!key) {
            return {
                statusCode: 400,
                body: "Parâmetro 'key' é obrigatório"
            }
        }

        // Normalizar key
        let normalizedKey = key
        if (!normalizedKey.startsWith("usuarios/")) {
            normalizedKey = `usuarios/${normalizedKey}`
        }

        console.log("Key normalizada:", normalizedKey)

        const store = makeStore("revista-arquivos")
        const blob = await store.get(normalizedKey, { type: "arrayBuffer" })

        if (!blob) {
            console.log("Blob não encontrado")
            return {
                statusCode: 404,
                body: "Avatar não encontrado"
            }
        }

        const byteLength = blob.byteLength || blob.length || 0
        console.log(`Blob encontrado. Tamanho: ${byteLength} bytes`)

        let contentType = "image/jpeg"
        if (normalizedKey.endsWith(".webp")) contentType = "image/webp"
        else if (normalizedKey.endsWith(".png")) contentType = "image/png"

        return {
            statusCode: 200,
            headers: {
                "Content-Type": contentType,
                "Cache-Control": "public, max-age=86400"
            },
            body: Buffer.from(blob).toString("base64"),
            isBase64Encoded: true
        }
    } catch (err) {
        console.error("Erro:", err)
        return {
            statusCode: 500,
            body: `Erro: ${err.message}`
        }
    }
}