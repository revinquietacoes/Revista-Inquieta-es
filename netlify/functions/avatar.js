const { wrapHttp } = require("./_netlify")

const main = async (req) => {
    try {
        const url = new URL(req.url)
        let key = url.searchParams.get("key")

        if (!key) {
            return new Response('Parâmetro "key" é obrigatório.', { status: 400 })
        }

        // Se a key não começar com "usuarios/", adicionar (compatibilidade)
        if (!key.startsWith("usuarios/")) {
            key = `usuarios/${key}`
        }

        const siteID = process.env.NETLIFY_BLOBS_SITE_ID
        const token = process.env.NETLIFY_BLOBS_TOKEN
        const storeName = "revista-arquivos"

        if (!siteID || !token) {
            return new Response('Configuração de armazenamento ausente.', { status: 500 })
        }

        const blobUrl = `https://api.netlify.com/api/v1/sites/${siteID}/blobs/${storeName}/${encodeURIComponent(key)}`

        const response = await fetch(blobUrl, {
            method: "GET",
            headers: { "Authorization": `Bearer ${token}` }
        })

        if (!response.ok) {
            return new Response('Avatar não encontrado.', { status: 404 })
        }

        const arrayBuffer = await response.arrayBuffer()
        const byteLength = arrayBuffer.byteLength

        let contentType = "image/jpeg"
        if (key.endsWith(".webp")) contentType = "image/webp"
        else if (key.endsWith(".png")) contentType = "image/png"

        return new Response(arrayBuffer, {
            status: 200,
            headers: {
                "Content-Type": contentType,
                "Content-Length": String(byteLength),
                "Cache-Control": "public, max-age=86400"
            }
        })
    } catch (err) {
        console.error("Erro no avatar:", err)
        return new Response(`Erro interno: ${err.message}`, { status: 500 })
    }
}

exports.handler = wrapHttp(main)