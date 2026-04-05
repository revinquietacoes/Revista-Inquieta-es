import Busboy from "busboy"
import { getStore } from "@netlify/blobs"

export async function handler(event) {

    try {

        console.log("SITE ID:", process.env.NETLIFY_BLOBS_SITE_ID)
        console.log("TOKEN:", process.env.NETLIFY_BLOBS_TOKEN ? "TOKEN OK" : "TOKEN MISSING")

        if (event.httpMethod !== "POST") {
            return { statusCode: 405, body: "Method not allowed" }
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

            busboy.end(Buffer.from(event.body, "base64"))

        })

        if (!fileBuffer) {
            return {
                statusCode: 400,
                body: JSON.stringify({ erro: "Arquivo não enviado" })
            }
        }

        const store = getStore({
            name: "arquivos",
            siteID: process.env.NETLIFY_BLOBS_SITE_ID,
            token: process.env.NETLIFY_BLOBS_TOKEN
        })

        const key = `${Date.now()}-avatar.webp`

        await store.set(key, fileBuffer, {
            contentType: mimeType
        })

        const url = `${process.env.URL}/.netlify/blobs/usuarios/${key}`

        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url })
        }

    } catch (err) {

        console.error(err)

        return {
            statusCode: 500,
            body: JSON.stringify({
                erro: err.message
            })
        }

    }

}