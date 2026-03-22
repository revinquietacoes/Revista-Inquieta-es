const { getStore } = require('@netlify/blobs')

function makeStore(name) {
  const siteID = process.env.NETLIFY_BLOBS_SITE_ID || process.env.SITE_ID
  const token = process.env.NETLIFY_BLOBS_TOKEN

  if (siteID && token) {
    return getStore(name, { siteID, token })
  }

  return getStore(name)
}

module.exports = { makeStore }