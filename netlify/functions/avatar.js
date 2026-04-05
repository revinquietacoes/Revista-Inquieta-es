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

        const store = makeStore("arquivos")
        const blob = await store.get(key, { type: "arrayBuffer" })

        if (!blob) {
            return new Response('Avatar não encontrado.', { status: 404 })
        }

        const contentType = key.endsWith(".webp") ? "image/webp" : "image/jpeg"

        return new Response(blob, {
            status: 200,
            headers: {
                "Content-Type": contentType,
                "Cache-Control": "public, max-age=86400"
            }
        })
    } catch (err) {
        console.error("Erro ao servir avatar:", err)
        return new Response(`Erro interno: ${err.message}`, { status: 500 })
    }
}

exports.handler = wrapHttp(main)