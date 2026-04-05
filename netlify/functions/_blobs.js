const { getStore } = require('@netlify/blobs')

function clean(value) {
  return typeof value === 'string' ? value.trim() : value
}

/**
 * Cria ou recupera um store de blobs com as credenciais do Netlify.
 * @param {string} name - Nome do store (ex: 'revista-arquivos', 'certificados-usuarios')
 * @returns {object} Store configurado
 */
function makeStore(name) {
  const siteID = clean(process.env.NETLIFY_BLOBS_SITE_ID || process.env.SITE_ID)
  const token = clean(process.env.NETLIFY_BLOBS_TOKEN)

  if (!siteID || !token) {
    throw new Error('Blobs manual config ausente: siteID/token')
  }

  // Para a versão 1.x do pacote @netlify/blobs
  return getStore(name, { siteID, token })
}

module.exports = { makeStore }