import { getStore } from "@netlify/blobs"
import Busboy from "busboy"

const MAX_FILE_SIZE = 2 * 1024 * 1024

export async function handler(event) {

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ erro: "Método não permitido" })
    }
  }

  try {

    const bb = Busboy({
      headers: event.headers,
      limits: { fileSize: MAX_FILE_SIZE }
    })

    let fileBuffer = null
    let fileName = ""
    let mimeType = ""
    let usuario_id = null

    const buffers = []

    await new Promise((resolve, reject) => {

      bb.on("file", (name, file, info) => {

        fileName = info.filename
        mimeType = info.mimeType

        file.on("data", (data) => {
          buffers.push(data)
        })

        file.on("limit", () => {
          reject(new Error("Arquivo maior que 2MB"))
        })

        file.on("end", () => {
          fileBuffer = Buffer.concat(buffers)
        })
      })

      bb.on("field", (name, value) => {
        if (name === "usuario_id") {
          usuario_id = value
        }
      })

      bb.on("finish", resolve)
      bb.on("error", reject)

      bb.end(Buffer.from(event.body, "base64"))
    })

    if (!fileBuffer) {
      throw new Error("Arquivo não enviado")
    }

    if (!usuario_id) {
      throw new Error("Usuário inválido")
    }

    if (!mimeType.startsWith("image/")) {
      throw new Error("Arquivo não é imagem")
    }

    const extension = mimeType.split("/")[1]

    const avatarName = `avatar-${usuario_id}.${extension}`

    let avatarUrl = ""

    try {

      const store = getStore("avatars")

      await store.set(avatarName, fileBuffer, {
        contentType: mimeType
      })

      avatarUrl = `/avatars/${avatarName}`

    } catch (err) {

      console.error("Blobs falhou:", err)

      return {
        statusCode: 500,
        body: JSON.stringify({
          erro: "Falha no armazenamento"
        })
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        mensagem: "Avatar enviado com sucesso",
        url: avatarUrl
      })
    }

  } catch (err) {

    return {
      statusCode: 400,
      body: JSON.stringify({
        erro: err.message
      })
    }

  }
}
<script>

  async function compressImage(file) {

  const img = await createImageBitmap(file)

  const canvas = document.createElement("canvas")

  const maxSize = 512

  let width = img.width
  let height = img.height

  if (width > height) {
    if (width > maxSize) {
      height *= maxSize / width
      width = maxSize
    }
  } else {
    if (height > maxSize) {
      width *= maxSize / height
      height = maxSize
    }
  }

  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext("2d")

  ctx.drawImage(img, 0, 0, width, height)

  return new Promise(resolve => {

    canvas.toBlob(blob => {

      const compressed = new File(
        [blob],
        file.name,
        { type: "image/jpeg" }
      )

      resolve(compressed)

    }, "image/jpeg", 0.8)

  })
}
document
.getElementById("form-avatar")
.addEventListener("submit", async (e) => {

  e.preventDefault()

  const fileInput = document.querySelector("#arquivo-avatar")

  const file = fileInput.files[0]

  if (!file) {
    alert("Selecione uma imagem")
    return
  }

  try {

    const compressed = await compressImage(file)

    const fd = new FormData()

    fd.append("arquivo", compressed)
    fd.append("usuario_id", user.id)

    const res = await fetch(
      "/.netlify/functions/upload-avatar",
      {
        method: "POST",
        headers: AppPanel.currentUserHeaders(),
        body: fd
      }
    )

    const data = await res.json()

    if (!res.ok) {
      throw new Error(data.erro)
    }

    // 🔥 atualiza avatar automaticamente
    const avatar = document.querySelector(".profile-avatar")

    avatar.src = data.url + "?t=" + Date.now()

    alert("Foto atualizada com sucesso")

  } catch (err) {

    alert(err.message)

  }

})
</script>