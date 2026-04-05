import Busboy from "busboy"
import { getStore } from "@netlify/blobs"

export async function handler(event) {

try {

if (event.httpMethod !== "POST") {
return {
statusCode: 405,
body: "Method not allowed"
}
}

const busboy = Busboy({
headers: event.headers
})

let fileBuffer = null
let mimeType = "image/webp"

await new Promise((resolve, reject) => {

busboy.on("file", (fieldname, file, info) => {

mimeType = info.mimeType

const chunks = []

file.on("data", data => chunks.push(data))

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
body: JSON.stringify({ erro: "Nenhum arquivo recebido" })
}
}

/* usa credenciais do ambiente */

const store = getStore({
name: "arquivos",
siteID: process.env.NETLIFY_BLOBS_SITE_ID,
token: process.env.NETLIFY_BLOBS_TOKEN
})

const key = `usuarios/${Date.now()}-avatar.webp`

await store.set(key, fileBuffer, {
contentType: mimeType
})

const url = await store.getPublicURL(key)

return {
statusCode: 200,
headers: {
"Content-Type": "application/json"
},
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