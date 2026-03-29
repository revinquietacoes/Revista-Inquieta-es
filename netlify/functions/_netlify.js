function wrapHttp(defaultHandler) {
  return async function handler(event) {
    try {
      const method = event?.httpMethod || 'GET'

      const protocol =
        event?.headers?.['x-forwarded-proto'] ||
        event?.headers?.['X-Forwarded-Proto'] ||
        'https'

      const host =
        event?.headers?.host ||
        event?.headers?.Host ||
        'localhost'

      const rawUrl =
        event?.rawUrl ||
        `${protocol}://${host}${event?.path || ''}${event?.rawQuery ? `?${event.rawQuery}` : ''}`

      const headers = new Headers()

      for (const [key, value] of Object.entries(event?.headers || {})) {
        if (Array.isArray(value)) {
          value.forEach((item) => headers.append(key, String(item)))
        } else if (value != null) {
          headers.set(key, String(value))
        }
      }

      const init = {
        method,
        headers
      }

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
          headers: {
            'content-type': 'application/json; charset=utf-8'
          },
          body: JSON.stringify(response ?? {})
        }
      }

      const outHeaders = {}
      response.headers.forEach((value, key) => {
        outHeaders[key] = value
      })

      const contentType = String(response.headers.get('content-type') || '').toLowerCase()

      const isBinary =
        contentType.includes('application/pdf') ||
        contentType.includes('application/octet-stream') ||
        contentType.includes('application/zip') ||
        contentType.includes('application/x-zip-compressed') ||
        contentType.includes('application/vnd.openxmlformats-officedocument') ||
        contentType.includes('application/msword') ||
        contentType.includes('application/vnd.ms-excel') ||
        contentType.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') ||
        contentType.includes('application/vnd.ms-powerpoint') ||
        contentType.includes('application/vnd.openxmlformats-officedocument.presentationml.presentation') ||
        contentType.startsWith('image/') ||
        contentType.startsWith('audio/') ||
        contentType.startsWith('video/')

      if (isBinary) {
        const arrayBuffer = await response.arrayBuffer()
        const buffer = Buffer.from(arrayBuffer)

        return {
          statusCode: response.status || 200,
          headers: outHeaders,
          isBase64Encoded: true,
          body: buffer.toString('base64')
        }
      }

      const bodyText = await response.text()

      return {
        statusCode: response.status || 200,
        headers: outHeaders,
        body: bodyText
      }
    } catch (error) {
      console.error('Erro em wrapHttp:', error)

      return {
        statusCode: 500,
        headers: {
          'content-type': 'application/json; charset=utf-8'
        },
        body: JSON.stringify({
          erro: 'Erro interno da função.',
          detalhe: error?.message || String(error)
        })
      }
    }
  }
}

module.exports = { wrapHttp }