const rewrite = (req, source, value) => {
  Object.defineProperty(req, source, {
    value,
    writable: true,
    enumerable: true,
    configurable: true
  })
}

export const validate = (schema, source = 'body') => (req, res, next) => {
  try {
    rewrite(req, source, schema.parse(req[source]))
    next()
  } catch (err) {
    return res.status(400).json({
      error: 'Invalid request',
      details: err.issues?.map(i => ({ path: i.path, message: i.message }))
    })
  }
}
