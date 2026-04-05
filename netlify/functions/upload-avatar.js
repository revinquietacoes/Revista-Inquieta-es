import Busboy from "busboy"
import { getStore } from "@netlify/blobs"
import pg from 'pg'

const { Pool } = pg

// Pool de conexões global (reutilizado entre chamadas)
let pool = null

function getDatabasePool() {
    if (!pool) {
        pool = new Pool({
            connectionString: process.env.NETLIFY_DATABASE_URL,
            ssl: {
                rejectUnauthorized: false // Necessário para Neon
            },
            max: 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 10000
        })

        // Tratar erros do pool
        pool.on('error', (err) => {
            console.error('Erro inesperado no pool do banco:', err)
        })
    }
    return pool
}

export async function handler(event) {
    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-User-Id",
        "Access-Control-Max-Age": "86400"
    }

    // OPTIONS preflight
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
        // Validar usuário
        const usuarioId = event.headers["x-user-id"]

        if (!usuarioId) {
            return {
                statusCode: 401,
                headers: corsHeaders,
                body: JSON.stringify({
                    erro: "Usuário não autenticado",
                    detalhe: "Header X-User-Id é obrigatório"
                })
            }
        }

        const usuarioIdNumber = parseInt(usuarioId)
        if (isNaN(usuarioIdNumber)) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({
                    erro: "ID de usuário inválido",
                    detalhe: "O ID deve ser um número"
                })
            }
        }

        // Processar upload do arquivo
        const busboy = Busboy({
            headers: event.headers,
            limits: { fileSize: 5 * 1024 * 1024 } // 5MB
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

            // Converter body
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

        if (!mimeType.startsWith("image/")) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({
                    erro: "Tipo de arquivo inválido",
                    detalhe: "Envie apenas imagens"
                })
            }
        }

        // Salvar no Netlify Blobs
        const store = getStore({
            name: "arquivos",
            siteID: process.env.NETLIFY_BLOBS_SITE_ID,
            token: process.env.NETLIFY_BLOBS_TOKEN
        })

        const timestamp = Date.now()
        const randomId = Math.random().toString(36).substring(2, 8)
        const key = `usuarios/${usuarioIdNumber}-${timestamp}-${randomId}.webp`

        await store.set(key, fileBuffer, {
            contentType: mimeType || "image/webp"
        })

        const baseUrl = process.env.SITE_URL || process.env.URL || `https://${event.headers.host}`
        const fotoUrl = `${baseUrl}/.netlify/blobs/arquivos/${key}`

        // Atualizar banco de dados (Neon)
        let dbAtualizado = false
        let colunaUsada = null

        try {
            const pool = getDatabasePool()
            client = await pool.connect()

            // Verificar se o usuário existe
            const checkQuery = 'SELECT id FROM usuarios WHERE id = $1'
            const checkResult = await client.query(checkQuery, [usuarioIdNumber])

            if (checkResult.rows.length === 0) {
                console.warn(`Usuário ${usuarioIdNumber} não encontrado`)
                throw new Error("Usuário não encontrado no banco")
            }

            // Verificar qual coluna de foto existe
            const columnQuery = `
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'usuarios' 
                AND column_name IN ('foto_perfil_url', 'avatar_url', 'foto_url')
                LIMIT 1
            `

            const columnResult = await client.query(columnQuery)

            if (columnResult.rows.length > 0) {
                colunaUsada = columnResult.rows[0].column_name
                const updateQuery = `UPDATE usuarios SET ${colunaUsada} = $1 WHERE id = $2`
                const updateResult = await client.query(updateQuery, [fotoUrl, usuarioIdNumber])

                if (updateResult.rowCount > 0) {
                    dbAtualizado = true
                    console.log(`Banco atualizado: usuário ${usuarioIdNumber}, coluna ${colunaUsada}`)
                }
            } else {
                // Se não existir coluna de foto, criar
                console.log("Coluna de foto não encontrada, criando...")
                const alterQuery = `
                    ALTER TABLE usuarios 
                    ADD COLUMN IF NOT EXISTS foto_perfil_url TEXT
                `
                await client.query(alterQuery)
                colunaUsada = "foto_perfil_url"

                const updateQuery = `UPDATE usuarios SET ${colunaUsada} = $1 WHERE id = $2`
                const updateResult = await client.query(updateQuery, [fotoUrl, usuarioIdNumber])

                if (updateResult.rowCount > 0) {
                    dbAtualizado = true
                    console.log(`Coluna criada e banco atualizado: usuário ${usuarioIdNumber}`)
                }
            }

        } catch (dbErr) {
            console.error("Erro no banco de dados:", dbErr)
            // Não falha o upload, apenas avisa
        } finally {
            if (client) {
                client.release()
            }
        }

        // Sucesso
        return {
            statusCode: 200,
            headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
                "Cache-Control": "no-cache"
            },
            body: JSON.stringify({
                sucesso: true,
                url: fotoUrl,
                db_atualizado: dbAtualizado,
                coluna_usada: colunaUsada,
                mensagem: dbAtualizado
                    ? "Avatar atualizado com sucesso!"
                    : "Avatar salvo, mas não foi possível vincular ao perfil",
                usuario_id: usuarioIdNumber
            })
        }

    } catch (err) {
        console.error("Erro fatal:", err)

        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                erro: "Erro interno no servidor",
                detalhes: process.env.NODE_ENV === "development" ? err.message : undefined
            })
        }
    }
}