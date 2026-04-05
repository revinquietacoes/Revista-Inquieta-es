// Usando API REST do Netlify Blobs
function makeStore(name) {
    const siteID = process.env.NETLIFY_BLOBS_SITE_ID
    const token = process.env.NETLIFY_BLOBS_TOKEN

    if (!siteID || !token) {
        throw new Error('Blobs config ausente: siteID ou token')
    }

    const baseUrl = `https://api.netlify.com/api/v1/sites/${siteID}/blobs/${name}`

    return {
        async get(key, options = {}) {
            const url = `${baseUrl}/${encodeURIComponent(key)}`
            const response = await fetch(url, {
                headers: { 'Authorization': `Bearer ${token}` }
            })
            if (!response.ok) {
                if (response.status === 404) return null
                throw new Error(`Erro ao obter blob: ${response.status}`)
            }
            if (options.type === 'arrayBuffer') {
                return await response.arrayBuffer()
            }
            return await response.text()
        },
        async set(key, data, options = {}) {
            const url = `${baseUrl}/${encodeURIComponent(key)}`
            const response = await fetch(url, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': options.contentType || 'application/octet-stream'
                },
                body: data
            })
            if (!response.ok) {
                throw new Error(`Erro ao salvar blob: ${response.status}`)
            }
            return true
        },
        async delete(key) {
            const url = `${baseUrl}/${encodeURIComponent(key)}`
            const response = await fetch(url, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            })
            return response.ok
        }
    }
}

module.exports = { makeStore }