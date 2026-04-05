import Busboy from "busboy"
import { getStore } from "@netlify/blobs"
import pg from 'pg'

// Configurar conexão com Neon
const { Pool } = pg

// Criar pool de conexões (reutilizado entre chamadas)
let pool = null

function getDatabasePool() {
    if (!pool) {
        pool = new Pool({
            connectionString: process.env.NETLIFY_DATABASE_URL,
            ssl: {
                rejectUnauthorized: false // Necessário para Neon
            },
            max: 20, // Máximo de conexões
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 5000
        })
    }
    return pool
}

export async function handler(event) {

    // CORS headers
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
        // PEGAR O USUÁRIO DO HEADER
        const usuarioId = event.headers["x-user-id"]
        
        if (!usuarioId) {
            return {
                statusCode: 401,
                headers: corsHeaders,
                body: JSON.stringify({ 
                    erro: "Usuário não autenticado",
                    detalhes: "Header X-User-Id não fornecido"
                })
            }
        }

        // Validar se é número
        const usuarioIdNumber = parseInt(usuarioId)
        if (isNaN(usuarioIdNumber)) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ 
                    erro: "ID de usuário inválido",
                    detalhes: "O ID deve ser um número"
                })
            }
        }

        // PROCESSAR UPLOAD DO ARQUIVO
        const busboy = Busboy({ 
            headers: event.headers,
            limits: {
                fileSize: 5 * 1024 * 1024 // 5MB
            }
        })

        let fileBuffer = null
        let mimeType = "image/webp"
        let uploadError = null

        await new Promise((resolve, reject) => {
            busboy.on("file", (name, file, info) => {
                mimeType = info.mimeType
                const chunks = []
                
                file.on("data", d => chunks.push(d))
                
                file.on("end", () => {
                    fileBuffer = Buffer.concat(chunks)
                    resolve()
                })
                
                file.on("error", (err) => {
                    uploadError = err.message
                    reject(err)
                })
            })

            busboy.on("error", (err) => {
                uploadError = err.message
                reject(err)
            })

            busboy.on("finish", () => {
                resolve()
            })

            // Converter body para buffer
            const bodyBuffer = Buffer.from(event.body, "base64")
            busboy.end(bodyBuffer)
        })

        if (uploadError) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ erro: uploadError })
            }
        }

        if (!fileBuffer || fileBuffer.length === 0) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ 
                    erro: "Arquivo não enviado",
                    detalhes: "Nenhum dado recebido"
                })
            }
        }

        // Validar tipo de arquivo
        if (!mimeType.startsWith("image/")) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ 
                    erro: "Tipo de arquivo inválido",
                    detalhes: "Envie apenas imagens (JPG, PNG, GIF, WEBP)"
                })
            }
        }

        // SALVAR NO NETLIFY BLOBS
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

        const baseUrl = process.env.URL || `https://${event.headers.host}`
        const fotoUrl = `${baseUrl}/.netlify/blobs/arquivos/${key}`

        // ATUALIZAR NO NEON (PostgreSQL)
        let dbAtualizado = false
        let dbError = null
        
        try {
            const pool = getDatabasePool()
            client = await pool.connect()
            
            // Primeiro, verificar se o usuário existe
            const checkQuery = 'SELECT id FROM usuarios WHERE id = $1'
            const checkResult = await client.query(checkQuery, [usuarioIdNumber])
            
            if (checkResult.rows.length === 0) {
                throw new Error(`Usuário ${usuarioIdNumber} não encontrado no banco`)
            }
            
            // Tentar atualizar com diferentes nomes de coluna
            let updateQuery = ''
            let columnName = ''
            
            // Verificar qual coluna de foto existe
            const columnCheckQuery = `
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'usuarios' 
                AND column_name IN ('foto_perfil_url', 'avatar_url', 'foto_url', 'imagem_url')
            `
            
            const columnsResult = await client.query(columnCheckQuery)
            
            if (columnsResult.rows.length > 0) {
                // Usar a primeira coluna encontrada
                columnName = columnsResult.rows[0].column_name
                updateQuery = `UPDATE usuarios SET ${columnName} = $1 WHERE id = $2`
            } else {
                // Se nenhuma coluna existir, tentar criar
                console.log("Coluna de foto não encontrada, tentando criar...")
                const alterQuery = `
                    ALTER TABLE usuarios 
                    ADD COLUMN IF NOT EXISTS foto_perfil_url TEXT
                `
                await client.query(alterQuery)
                columnName = 'foto_perfil_url'
                updateQuery = `UPDATE usuarios SET ${columnName} = $1 WHERE id = $2`
            }
            
            // Executar update
            const updateResult = await client.query(updateQuery, [fotoUrl, usuarioIdNumber])
            
            if (updateResult.rowCount > 0) {
                dbAtualizado = true
                console.log(`Banco atualizado: usuário ${usuarioIdNumber}, coluna ${columnName}`)
            } else {
                dbError = "Usuário encontrado mas não foi possível atualizar"
            }
            
        } catch (err) {
            dbError = err.message
            console.error("Erro no banco de dados:", err)
        } finally {
            if (client) {
                client.release()
            }
        }

        // RESPOSTA FINAL
        return {
            statusCode: 200,
            headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
                "Cache-Control": "no-cache, no-store, must-revalidate"
            },
            body: JSON.stringify({
                sucesso: true,
                url: fotoUrl,
                db_atualizado: dbAtualizado,
                coluna_usada: columnName || null,
                aviso: dbError ? `Imagem salva mas não vinculada ao perfil: ${dbError}` : null,
                mensagem: dbAtualizado ? "Avatar atualizado com sucesso!" : "Avatar salvo, mas banco não atualizado"
            })
        }

    } catch (err) {
        console.error("Erro fatal:", err)
        
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                erro: "Erro interno no servidor",
                detalhes: process.env.NODE_ENV === "development" ? err.message : "Contate o administrador",
                stack: process.env.NODE_ENV === "development" ? err.stack : undefined
            })
        }
    }
}