function wrapHttp(defaultHandler) {
  return async function handler(event) {
    try {
      const method = event?.httpMethod || 'GET'
      const protocol =
        event?.headers?.['x-forwarded-proto'] ||
        event?.headers?.['X-Forwarded-Proto'] ||
        'https'
      const host = event?.headers?.host || event?.headers?.Host || 'localhost'
      const rawUrl = event?.rawUrl || `${protocol}://${host}${event?.path || ''}`

      const headers = new Headers()
      for (const [k, v] of Object.entries(event?.headers || {})) {
        if (Array.isArray(v)) {
          v.forEach((item) => headers.append(k, String(item)))
        } else if (v != null) {
          headers.set(k, String(v))
        }
      }

      const init = { method, headers }

      if (method !== 'GET' && method !== 'HEAD' && event?.body != null) {
        init.body = event.isBase64Encoded
          ? Buffer.from(event.body, 'base64')
          : event.body
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
      response.headers.forEach((value, key) => {
        outHeaders[key] = value
      })

      const bodyText = await response.text()

      return {
        statusCode: response.status || 200,
        headers: outHeaders,
        body: bodyText
      }
    } catch (error) {
      return {
        statusCode: 500,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          erro: 'Erro interno da função.',
          detalhe: error?.message || String(error)
        })
      }
    }
  }
}

module.exports = { wrapHttp }