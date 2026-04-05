const { getStore } = require('@netlify/blobs')

function clean(value) {
  return typeof value === 'string' ? value.trim() : value
}

function makeStore(name) {
  const siteID = clean(process.env.NETLIFY_BLOBS_SITE_ID || process.env.SITE_ID)
  const token = clean(process.env.NETLIFY_BLOBS_TOKEN)

  if (!siteID || !token) {
    throw new Error('Blobs manual config ausente: siteID/token')
  }

  return getStore(name, { siteID, token })
}

module.exports = { makeStore }