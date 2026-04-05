const Busboy = require("busboy")
const { getStore } = require("@netlify/blobs")
const { Pool } = require("pg")

let pool = null

function getDatabasePool() {
    if (!pool) {
        pool = new Pool({
            connectionString: process.env.NETLIFY_DATABASE_URL,
            ssl: { rejectUnauthorized: false },
            max: 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 10000
        })
    }
    return pool
}

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

    let client = null
    
    try {
        const usuarioId = event.headers["x-user-id"]
        
        if (!usuarioId) {
            return {
                statusCode: 401,
                headers: corsHeaders,
                body: JSON.stringify({ erro: "Usuário não autenticado" })
            }
        }

        const busboy = Busboy({ 
            headers: event.headers,
            limits: { fileSize: 5 * 1024 * 1024 }
        })

        let fileBuffer = null
        let mimeType = "image/webp"

        await new Promise((resolve, reject) => {
            busboy.on("file", (name, file, info) => {
                mimeType = info.mimeType
                const chunks = []
                file.on("data", d => chunks.push(d))
                file.on("end", () => {
                    fileBuffer = Buffer.concat(chunks)
                    resolve()
                })
                file.on("error", reject)
            })
            busboy.on("error", reject)
            busboy.on("finish", () => resolve())
            
            const bodyBuffer = Buffer.from(event.body, "base64")
            busboy.end(bodyBuffer)
        })

        if (!fileBuffer || fileBuffer.length === 0) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ erro: "Arquivo não enviado" })
            }
        }

        const store = getStore({
            name: "arquivos",
            siteID: process.env.NETLIFY_BLOBS_SITE_ID,
            token: process.env.NETLIFY_BLOBS_TOKEN
        })

        const timestamp = Date.now()
        const key = `usuarios/${usuarioId}-${timestamp}.webp`

        await store.set(key, fileBuffer, {
            contentType: mimeType || "image/webp"
        })

        const baseUrl = process.env.URL || `https://${event.headers.host}`
        const fotoUrl = `${baseUrl}/.netlify/blobs/arquivos/${key}`

        // Tentar salvar no banco (opcional)
        let dbAtualizado = false
        try {
            const pool = getDatabasePool()
            client = await pool.connect()
            
            // Verificar qual coluna existe
            const columnQuery = `
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'usuarios' 
                AND column_name IN ('foto_perfil_url', 'avatar_url', 'foto_url')
                LIMIT 1
            `
            const columnResult = await client.query(columnQuery)
            
            if (columnResult.rows.length > 0) {
                const coluna = columnResult.rows[0].column_name
                await client.query(`UPDATE usuarios SET ${coluna} = $1 WHERE id = $2`, [fotoUrl, usuarioId])
                dbAtualizado = true
            }
        } catch (dbErr) {
            console.error("Erro no banco:", dbErr.message)
        } finally {
            if (client) client.release()
        }

        return {
            statusCode: 200,
            headers: {
                ...corsHeaders,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                sucesso: true,
                url: fotoUrl,
                db_atualizado: dbAtualizado,
                mensagem: "Avatar salvo com sucesso!"
            })
        }

    } catch (err) {
        console.error("Erro:", err)
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ 
                erro: "Erro interno",
                detalhes: err.message 
            })
        }
    }
}