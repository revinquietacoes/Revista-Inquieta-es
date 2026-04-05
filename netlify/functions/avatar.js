const { makeStore } = require("./_blobs")
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

        console.log("🔑 Key solicitada:", key)

        // Usar o store 'revista-arquivos'
        const store = makeStore("revista-arquivos")
        const blob = await store.get(key, { type: "arrayBuffer" })

        if (!blob) {
            console.log("❌ Blob não encontrado para a key:", key)
            return new Response('Avatar não encontrado.', { status: 404 })
        }

        const byteLength = blob.byteLength || blob.length || 0
        console.log(`✅ Blob encontrado. Tamanho: ${byteLength} bytes`)

        if (byteLength === 0) {
            console.log("⚠️ Blob está vazio!")
            return new Response('Arquivo vazio.', { status: 404 })
        }

        // Determinar o content-type pela extensão
        let contentType = "image/jpeg"
        if (key.endsWith(".webp")) contentType = "image/webp"
        else if (key.endsWith(".png")) contentType = "image/png"
        else if (key.endsWith(".jpg") || key.endsWith(".jpeg")) contentType = "image/jpeg"

        return new Response(blob, {
            status: 200,
            headers: {
                "Content-Type": contentType,
                "Content-Length": String(byteLength),
                "Cache-Control": "public, max-age=86400"
            }
        })
    } catch (err) {
        console.error("❌ Erro ao servir avatar:", err)
        return new Response(`Erro interno: ${err.message}`, { status: 500 })
    }
}

exports.handler = wrapHttp(main)