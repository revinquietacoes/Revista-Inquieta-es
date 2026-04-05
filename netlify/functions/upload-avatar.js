const { getStore } = require("@netlify/blobs")
const Busboy = require("busboy")
const { sql } = require("./_db")

const store = getStore("revista-arquivos")

exports.handler = async (event) => {

if (event.httpMethod !== "POST") {
return { statusCode:405, body:"Método não permitido" }
}

try {

const busboy = Busboy({ headers:event.headers })

let usuario_id = null
let buffer = null
let mime = null
const chunks = []

await new Promise((resolve,reject)=>{

busboy.on("file",(name,file,info)=>{

mime = info.mimeType

file.on("data",d=>chunks.push(d))

file.on("end",()=>{
buffer = Buffer.concat(chunks)
})

})

busboy.on("field",(name,val)=>{
if(name==="usuario_id") usuario_id = val
})

busboy.on("finish",resolve)
busboy.on("error",reject)

const body = event.isBase64Encoded
? Buffer.from(event.body,"base64")
: Buffer.from(event.body)

busboy.end(body)

})

if(!usuario_id) throw new Error("Usuário não informado")
if(!buffer) throw new Error("Arquivo não recebido")
if(!mime.startsWith("image/")) throw new Error("Arquivo inválido")

if(buffer.length > 2 * 1024 * 1024){
throw new Error("Imagem maior que 2MB")
}

const key = `usuarios/${usuario_id}/avatar/avatar.webp`

/* remove avatar anterior do blob */

await store.delete(key).catch(()=>{})

/* salva novo avatar */

await store.set(key,buffer,{
contentType:"image/webp"
})

const url = `/.netlify/functions/arquivo?key=${encodeURIComponent(key)}`

/* remove registros antigos */

await sql`
DELETE FROM arquivos_publicacao
WHERE usuario_id = ${usuario_id}
AND categoria = 'avatar'
`

/* registra novo avatar */

await sql`
INSERT INTO arquivos_publicacao
(usuario_id,categoria,mime_type,blob_key,url_acesso,publico)
VALUES
(${usuario_id},'avatar','image/webp',${key},${url},true)
`

return {
statusCode:200,
body:JSON.stringify({
url: url + "&v=" + Date.now()
})
}

}catch(err){

console.error("ERRO AVATAR:",err)

return {
statusCode:500,
body:JSON.stringify({
erro: err.message
})
}

}

}