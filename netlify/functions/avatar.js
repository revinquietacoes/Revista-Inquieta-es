const { wrapHttp } = require("./_netlify")

const main = async (req) => {
    try {
        const url = new URL(req.url)
        let key = url.searchParams.get("key")

        if (!key) {
            return new Response('Parâmetro "key" é obrigatório.', { status: 400 })
        }

        // Garantir o prefixo "usuarios/"
        if (!key.startsWith("usuarios/")) {
            key = `usuarios/${key}`
        }

        console.log("🔑 Avatar solicitado:", key)

        const siteID = process.env.NETLIFY_BLOBS_SITE_ID
        const token = process.env.NETLIFY_BLOBS_TOKEN
        const storeName = "revista-arquivos"

        if (!siteID || !token) {
            console.error("❌ Variáveis de ambiente ausentes")
            return new Response('Configuração de armazenamento ausente.', { status: 500 })
        }

        const blobUrl = `https://api.netlify.com/api/v1/sites/${siteID}/blobs/${storeName}/${encodeURIComponent(key)}`

        const response = await fetch(blobUrl, {
            method: "GET",
            headers: { "Authorization": `Bearer ${token}` }
        })

        if (!response.ok) {
            console.error(`❌ Blob não encontrado: ${response.status}`)
            return new Response('Avatar não encontrado.', { status: 404 })
        }

        const arrayBuffer = await response.arrayBuffer()
        const byteLength = arrayBuffer.byteLength

        if (byteLength === 0) {
            console.error("⚠️ Blob está vazio!")
            return new Response('Arquivo vazio.', { status: 404 })
        }

        console.log(`✅ Avatar servido: ${byteLength} bytes`)

        let contentType = "image/jpeg"
        if (key.endsWith(".png")) contentType = "image/png"
        else if (key.endsWith(".gif")) contentType = "image/gif"
        else if (key.endsWith(".webp")) contentType = "image/webp"
        else if (key.endsWith(".jpg") || key.endsWith(".jpeg")) contentType = "image/jpeg"

        return new Response(arrayBuffer, {
            status: 200,
            headers: {
                "Content-Type": contentType,
                "Content-Length": String(byteLength),
                "Cache-Control": "public, max-age=86400"
            }
        })
    } catch (err) {
        console.error("❌ Erro fatal no avatar:", err)
        return new Response(`Erro interno: ${err.message}`, { status: 500 })
    }
}

exports.handler = wrapHttp(main)