const { getStore } = require('@netlify/blobs')
const { json, ensureSupportTables, getAuthenticatedUserId, getUserById } = require('./_db')
const { wrapHttp } = require('./_netlify')

const main = async (req) => {
  try {
    await ensureSupportTables()
    const actorId = getAuthenticatedUserId(req)
    const actor = actorId ? await getUserById(actorId) : null
    const stores = {}
    for (const name of ['revista-arquivos', 'certificados-usuarios']) {
      try {
        const store = getStore(name)
        const key = `health/${Date.now()}-${Math.random().toString(36).slice(2)}.txt`
        await store.set(key, Buffer.from('ok'))
        await store.delete(key)
        stores[name] = 'ok'
      } catch (e) {
        stores[name] = e.message
      }
    }
    return json({ sucesso: true, actor, stores, env: {
      has_database: !!(process.env.NETLIFY_DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL),
      has_site_id: !!process.env.SITE_ID,
      has_blob_token: !!process.env.NETLIFY_BLOBS_CONTEXT
    } })
  } catch (e) {
    return json({ erro: 'Falha no diagnóstico.', detalhe: e.message }, 500)
  }
}

exports.handler = wrapHttp(main)
