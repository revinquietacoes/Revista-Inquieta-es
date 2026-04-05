import { getStore } from "@netlify/blobs"
import Busboy from "busboy"

const MAX_SIZE = 3 * 1024 * 1024

export async function handler(event){

if(event.httpMethod!=="POST"){
return{
statusCode:405,
body:JSON.stringify({erro:"Método não permitido"})
}
}

try{

const bb=Busboy({
headers:event.headers,
limits:{fileSize:MAX_SIZE}
})

let buffer=null
let mime=null
let usuario_id=null

const chunks=[]

await new Promise((resolve,reject)=>{

bb.on("file",(name,file,info)=>{

mime=info.mimeType

file.on("data",d=>chunks.push(d))

file.on("limit",()=>reject(new Error("Arquivo muito grande")))

file.on("end",()=>buffer=Buffer.concat(chunks))

})

bb.on("field",(n,v)=>{
if(n==="usuario_id") usuario_id=v
})

bb.on("finish",resolve)
bb.on("error",reject)

bb.end(Buffer.from(event.body,"base64"))

})

if(!buffer) throw new Error("Arquivo não enviado")
if(!usuario_id) throw new Error("Usuário inválido")
if(!mime.startsWith("image/")) throw new Error("Arquivo não é imagem")

const filename=`avatar-${usuario_id}.jpg`

const store=getStore("avatars")

try{

await store.set(filename,buffer,{
contentType:"image/jpeg"
})

}catch(e){

console.error("Blobs falhou",e)

return{
statusCode:500,
body:JSON.stringify({erro:"Falha no armazenamento"})
}

}

return{
statusCode:200,
body:JSON.stringify({
mensagem:"Avatar enviado",
url:`/avatars/${filename}`
})
}

}catch(err){

return{
statusCode:400,
body:JSON.stringify({erro:err.message})
}

}

}