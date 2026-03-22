const { makeStore } = require('./_blobs')
const { json, ensureSupportTables } = require('./_db')
const { wrapHttp } = require('./_netlify')

const main = async () => {
  try {
    await ensureSupportTables()

    const siteID = (process.env.NETLIFY_BLOBS_SITE_ID || process.env.SITE_ID || '').trim()
    const token = (process.env.NETLIFY_BLOBS_TOKEN || '').trim()

    const stores = {}

    for (const name of ['revista-arquivos', 'certificados-usuarios']) {
      try {
        const store = makeStore(name)
        const key = `health/${Date.now()}-${Math.random().toString(36).slice(2)}.txt`
        await store.set(key, Buffer.from('ok'))
        await store.delete(key)
        stores[name] = 'ok'
      } catch (e) {
        stores[name] = e.message
      }
    }

    return json({
      sucesso: true,
      stores,
      debug: {
        site_id_present: !!siteID,
        site_id_value: siteID,
        token_present: !!token,
        token_prefix: token ? `${token.slice(0, 4)}...` : null,
        token_length: token ? token.length : 0
      }
    })
  } catch (e) {
    return json({ erro: 'Falha no diagnóstico.', detalhe: e.message }, 500)
  }
}

exports.handler = wrapHttp(main)