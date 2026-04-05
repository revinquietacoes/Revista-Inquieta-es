import { getStore } from "@netlify/blobs"
import Busboy from "busboy"

export async function handler(event) {

if(event.httpMethod !== "POST"){
return {
statusCode:405,
body:JSON.stringify({erro:"Método não permitido"})
}
}

try{

const busboy = Busboy({
headers:event.headers
})

let usuario_id=null
let mime=null
let buffer=null
const chunks=[]

await new Promise((resolve,reject)=>{

busboy.on("file",(name,file,info)=>{

mime=info.mimeType

file.on("data",data=>{
chunks.push(data)
})

file.on("end",()=>{
buffer=Buffer.concat(chunks)
})

})

busboy.on("field",(name,val)=>{
if(name==="usuario_id") usuario_id=val
})

busboy.on("finish",resolve)
busboy.on("error",reject)

const body = event.isBase64Encoded
? Buffer.from(event.body,"base64")
: Buffer.from(event.body)

busboy.end(body)

})

if(!buffer){
throw new Error("Arquivo não recebido")
}

if(!mime.startsWith("image/")){
throw new Error("Arquivo não é imagem")
}

if(buffer.length > 4 * 1024 * 1024){
throw new Error("Imagem maior que 4MB")
}

const filename=`avatar-${usuario_id}.webp`
const store=getStore("avatars")

await store.set(filename,buffer,{
contentType:"image/webp"
})

const version=Date.now()

return{
statusCode:200,
body:JSON.stringify({
url:`/avatars/${filename}?v=${version}`
})
}

}catch(err){

console.error("ERRO AVATAR:",err)

return{
statusCode:500,
body:JSON.stringify({
erro:"Falha no upload",
detalhe:err.message
})
}

}

}