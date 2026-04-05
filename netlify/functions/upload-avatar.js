import Busboy from "busboy"
import { getStore } from "@netlify/blobs"

export async function handler(event) {

try {

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

/* conexão automática com Netlify Blobs */

const store = getStore("arquivos")

const key = `usuarios/${Date.now()}-avatar.webp`

await store.set(key, fileBuffer, {
contentType: mimeType
})

/* gerar URL pública */

const url = `https://${process.env.URL}/.netlify/blobs/${key}`

return {
statusCode: 200,
headers: { "Content-Type": "application/json" },
body: JSON.stringify({ url })
}

} catch (err) {

return {
statusCode: 500,
body: JSON.stringify({
erro: err.message
})
}

}

}