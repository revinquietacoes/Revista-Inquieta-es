function wrapHttp(defaultHandler) {
  return async function handler(event) {
    try {
      const method = event?.httpMethod || 'GET'
      const protocol = event?.headers?.['x-forwarded-proto'] || 'https'
      const host = event?.headers?.host || 'localhost'
      const rawUrl = `${protocol}://${host}${event?.path || ''}${event?.rawQuery ? `?${event.rawQuery}` : ''}`
      const headers = new Headers()

      for (const [key, value] of Object.entries(event?.headers || {})) {
        if (value != null) headers.set(key, String(value))
      }

      const init = { method, headers }
      if (method !== 'GET' && method !== 'HEAD' && event?.body != null) {
        init.body = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : event.body
      }

      const req = new Request(rawUrl, init)
      const response = await defaultHandler(req, event)

      if (!(response instanceof Response)) {
        return {
          statusCode: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
          body: JSON.stringify(response ?? {})
        }
      }

      const outHeaders = {}
      response.headers.forEach((value, key) => { outHeaders[key] = value })

      const contentType = String(response.headers.get('content-type') || '').toLowerCase()
      const isBinary = contentType.startsWith('image/') || contentType.includes('application/')

      if (isBinary) {
        const arrayBuffer = await response.arrayBuffer()
        return {
          statusCode: response.status,
          headers: outHeaders,
          isBase64Encoded: true,
          body: Buffer.from(arrayBuffer).toString('base64')
        }
      }

      return {
        statusCode: response.status,
        headers: outHeaders,
        body: await response.text()
      }
    } catch (error) {
      return {
        statusCode: 500,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ erro: 'Erro interno da função.', detalhe: error.message })
      }
    }
  }
}

module.exports = { wrapHttp }