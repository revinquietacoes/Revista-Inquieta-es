import { getStore } from "@netlify/blobs"

export async function handler(event){

try{

if(event.httpMethod !== "POST"){
return {
statusCode:405,
body:"Método não permitido"
}
}

const store = getStore("arquivos")

const boundary = event.headers["content-type"].split("boundary=")[1]

const parts = event.body.split("--"+boundary)

let filePart = parts.find(p=>p.includes("filename="))

if(!filePart){
return {
statusCode:400,
body:JSON.stringify({erro:"Arquivo não enviado"})
}
}

const start = filePart.indexOf("\r\n\r\n") + 4
const end = filePart.lastIndexOf("\r\n")

const fileData = filePart.slice(start,end)

const buffer = Buffer.from(fileData,"binary")

const fileName =
"usuarios/" +
Date.now() +
"-avatar.webp"

await store.set(fileName,buffer,{
contentType:"image/webp"
})

const url = await store.getPublicURL(fileName)

return {
statusCode:200,
headers:{
"Content-Type":"application/json"
},
body:JSON.stringify({
url
})
}

}catch(err){

return {
statusCode:500,
body:JSON.stringify({
erro:err.message
})
}

}

}