const { wrapHttp } = require("./_netlify")

const main = async (req) => {
    try {
        const url = new URL(req.url)
        let key = url.searchParams.get("key")

        console.log("=== AVATAR FUNCTION START ===")
        console.log("Key recebida:", key)

        if (!key) {
            return new Response('Parâmetro "key" é obrigatório.', { status: 400 })
        }

        // Se a key não começar com "usuarios/", adicionar (compatibilidade)
        if (!key.startsWith("usuarios/")) {
            key = `usuarios/${key}`
        }

        console.log("Key normalizada:", key)

        // Obter credenciais do ambiente
        const siteID = process.env.NETLIFY_BLOBS_SITE_ID
        const token = process.env.NETLIFY_BLOBS_TOKEN
        const storeName = "revista-arquivos"

        if (!siteID || !token) {
            console.error("Variáveis de ambiente do Blobs não configuradas")
            return new Response('Configuração de armazenamento ausente.', { status: 500 })
        }

        // Montar URL da API REST do Netlify Blobs
        const blobUrl = `https://api.netlify.com/api/v1/sites/${siteID}/blobs/${storeName}/${encodeURIComponent(key)}`

        console.log("Buscando blob em:", blobUrl)

        const response = await fetch(blobUrl, {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${token}`
            }
        })

        if (!response.ok) {
            console.error(`Erro na API: ${response.status} ${response.statusText}`)
            return new Response('Avatar não encontrado.', { status: 404 })
        }

        const arrayBuffer = await response.arrayBuffer()
        const byteLength = arrayBuffer.byteLength
        console.log(`Blob obtido. Tamanho: ${byteLength} bytes`)

        if (byteLength === 0) {
            return new Response('Arquivo vazio.', { status: 404 })
        }

        // Determinar content-type
        let contentType = "image/jpeg"
        if (key.endsWith(".webp")) contentType = "image/webp"
        else if (key.endsWith(".png")) contentType = "image/png"
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
        console.error("Erro no avatar:", err)
        return new Response(`Erro interno: ${err.message}`, { status: 500 })
    }
}

exports.handler = wrapHttp(main)