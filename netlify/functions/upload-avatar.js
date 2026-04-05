<!DOCTYPE html>
<html lang="pt-BR">

<head>

<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">

<title>Perfil</title>

<link rel="stylesheet" href="../css/painel-base.css">

<style>

.avatar-box-panel{
display:flex;
flex-direction:column;
align-items:center;
gap:12px;
}

.profile-avatar{
width:140px;
height:140px;
border-radius:50%;
object-fit:cover;
border:3px solid #ddd;
}

#msg-avatar{
font-size:13px;
color:#555;
}

</style>

</head>

<body>

<aside class="panel">

<div class="avatar-box-panel">

<img
id="avatar-img"
class="profile-avatar"
src="../assets/avatares/avatar-padrao.png"
alt="Avatar"
/>

<input
type="file"
id="avatar-input"
accept="image/*"
hidden
/>

<button
type="button"
id="avatar-btn"
class="btn btn-secondary">
Alterar foto
</button>

<div id="msg-avatar"></div>

</div>

</aside>

<script src="../js/painel-base.js"></script>

<script>

document.addEventListener("DOMContentLoaded", async () => {

const avatarImg = document.getElementById("avatar-img")
const avatarInput = document.getElementById("avatar-input")
const avatarBtn = document.getElementById("avatar-btn")
const msg = document.getElementById("msg-avatar")

/* abrir seletor */

avatarBtn.addEventListener("click", () => {

avatarInput.click()

})

/* selecionar imagem */

avatarInput.addEventListener("change", async () => {

const file = avatarInput.files[0]

if(!file) return

if(!file.type.startsWith("image/")){
msg.textContent = "Selecione uma imagem válida."
return
}

msg.textContent = "Preparando imagem..."

const compressed = await compressImage(file)

/* preview */

avatarImg.src = URL.createObjectURL(compressed)

msg.textContent = "Enviando..."

await uploadAvatar(compressed)

})

/* compressão da imagem */

async function compressImage(file){

const img = await createImageBitmap(file)

const canvas = document.createElement("canvas")
const ctx = canvas.getContext("2d")

const max = 512

let w = img.width
let h = img.height

if(w > h){

if(w > max){
h *= max / w
w = max
}

}else{

if(h > max){
w *= max / h
h = max
}

}

canvas.width = w
canvas.height = h

ctx.drawImage(img,0,0,w,h)

return new Promise(resolve=>{

canvas.toBlob(blob=>{

resolve(new File([blob],"avatar.webp",{type:"image/webp"}))

},"image/webp",0.82)

})

}

/* upload do avatar */

async function uploadAvatar(file){

try{

const user = await AppPanel.apiData("me")
const usuario = user.usuario

const fd = new FormData()

fd.append("arquivo",file)
fd.append("usuario_id",usuario.id)

const r = await fetch("/.netlify/functions/upload-avatar",{
method:"POST",
headers: AppPanel.currentUserHeaders(),
body: fd
})

const data = await r.json()

if(!r.ok){
throw new Error(data.erro || "Erro no upload")
}

/* atualizar avatar */

avatarImg.src = data.url

msg.textContent = "Foto atualizada com sucesso."

}catch(err){

msg.textContent = err.message

}

}

})

</script>

</body>
</html>