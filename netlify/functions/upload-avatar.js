import Busboy from "busboy"
import { getStore } from "@netlify/blobs"

export async function handler(event) {

    try {

        console.log("SITE ID:", process.env.NETLIFY_BLOBS_SITE_ID)
        console.log("TOKEN:", process.env.NETLIFY_BLOBS_TOKEN ? "TOKEN OK" : "TOKEN MISSING")

        // Suportar OPTIONS para CORS
        if (event.httpMethod === "OPTIONS") {
            return {
                statusCode: 204,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "POST, OPTIONS",
                    "Access-Control-Allow-Headers": "Content-Type"
                }
            }
        }

        if (event.httpMethod !== "POST") {
            return { 
                statusCode: 405, 
                headers: { "Access-Control-Allow-Origin": "*" },
                body: "Method not allowed" 
            }
        }

        const busboy = Busboy({ headers: event.headers })

        let fileBuffer = null
        let mimeType = "image/webp"

        await new Promise((resolve, reject) => {

            busboy.on("file", (name, file, info) => {

                mimeType = info.mimeType

                const chunks = []

                file.on("data", d => chunks.push(d))

                file.on("end", () => {
                    fileBuffer = Buffer.concat(chunks)
                })

            })

            busboy.on("finish", resolve)
            busboy.on("error", reject)

            // CORREÇÃO: Verificar se event.body existe
            if (!event.body) {
                reject(new Error("Corpo da requisição vazio"))
                return
            }

            busboy.end(Buffer.from(event.body, "base64"))

        })

        if (!fileBuffer) {
            return {
                statusCode: 400,
                headers: { "Access-Control-Allow-Origin": "*" },
                body: JSON.stringify({ erro: "Arquivo não enviado" })
            }
        }

        // Validar tamanho do arquivo (ex: 5MB)
        const MAX_SIZE = 5 * 1024 * 1024 // 5MB
        if (fileBuffer.length > MAX_SIZE) {
            return {
                statusCode: 400,
                headers: { "Access-Control-Allow-Origin": "*" },
                body: JSON.stringify({ erro: "Arquivo muito grande. Máximo 5MB" })
            }
        }

        const store = getStore({
            name: "arquivos",
            siteID: process.env.NETLIFY_BLOBS_SITE_ID,
            token: process.env.NETLIFY_BLOBS_TOKEN
        })

        // CORREÇÃO: A key deve incluir a pasta "usuarios/"
        const timestamp = Date.now()
        const key = `usuarios/${timestamp}-avatar.webp`

        await store.set(key, fileBuffer, {
            contentType: mimeType || "image/webp"
        })

        // A URL precisa incluir o nome do store "arquivos" e a key completa
        const url = `${process.env.URL}/.netlify/blobs/arquivos/${key}`

        console.log("Upload concluído com sucesso:", { key, url, size: fileBuffer.length })

        return {
            statusCode: 200,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST, OPTIONS",
                "Cache-Control": "no-cache"
            },
            body: JSON.stringify({ 
                url: url,
                success: true,
                timestamp: timestamp
            })
        }

    } catch (err) {

        console.error("Erro detalhado:", err)

        return {
            statusCode: 500,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            },
            body: JSON.stringify({
                erro: err.message,
                details: err.stack
            })
        }

    }

}