process.env.NODE_ENV = 'test'
process.env.JWT_SECRET ??= 'test-secret'
process.env.DATABASE_URL ??=
  'postgresql://postgres:postgres@localhost:5432/image_processing_test?schema=public'
process.env.UPLOADS_DIR = 'uploads-test'

const { default: app } = await import('./app.js')
const { config } = await import('./config.js')
const { prisma } = await import('./db/prisma.js')
const { default: jwt } = await import('jsonwebtoken')
const { default: sharp } = await import('sharp')
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rm, readFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import { once } from 'node:events'

let server
let baseUrl

const png32 = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#ff0000' } })
  .png()
  .toBuffer()

let aToken
let bToken
let aEmail
let bEmail
let aImageIds = []
let bImageId
let transformTargetId

test.before(async () => {
  server = app.listen(0)
  await once(server, 'listening')
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`

  await prisma.transformLog.deleteMany()
  await prisma.image.deleteMany()
  await prisma.user.deleteMany()
})

test.after(async () => {
  await new Promise(resolve => server.close(resolve))
  await prisma.$disconnect()
  await rm(path.resolve(config.uploadsDir), { recursive: true, force: true })
})

const api = async (route, options = {}) => {
  const res = await fetch(`${baseUrl}${route}`, options)
  const raw = await res.text()
  let body
  try {
    body = JSON.parse(raw)
  } catch {
    body = raw
  }
  return { status: res.status, headers: res.headers, body }
}

const authHeaders = token => ({ Authorization: `Bearer ${token}` })

const uploadImage = async (token, buffer, filename = 'foto.png', mime = 'image/png') => {
  const form = new FormData()
  form.append('image', new Blob([buffer], { type: mime }), filename)
  return api('/images', { method: 'POST', headers: authHeaders(token), body: form })
}

test('001 - POST /register crea usuario', async () => {
  aEmail = `ana-${Date.now()}@example.com`
  const res = await api('/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: aEmail.toUpperCase(), password: 'S3gura!2026' })
  })
  assert.equal(res.status, 201)
  assert.ok(res.body.id)
  assert.equal(res.body.email, aEmail.toLowerCase())
  assert.equal(res.body.password, undefined)

  const saved = await prisma.user.findUnique({ where: { email: aEmail } })
  assert.notEqual(saved.password, 'S3gura!2026')
})

test('001 - POST /register duplicado devuelve 409', async () => {
  const res = await api('/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: aEmail, password: 'OtraClave!99' })
  })
  assert.equal(res.status, 409)
  assert.equal(res.body.error, 'Email already registered')
})

test('001 - POST /register con password corta devuelve 400', async () => {
  const res = await api('/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'x@example.com', password: 'corta' })
  })
  assert.equal(res.status, 400)
  assert.equal(res.body.error, 'Invalid request')
  assert.deepEqual(res.body.details?.[0]?.path, ['password'])
})

test('001 - POST /login emite JWT verificable', async () => {
  const res = await api('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: aEmail, password: 'S3gura!2026' })
  })
  assert.equal(res.status, 200)
  assert.equal(res.body.expiresIn, '1h')

  const payload = jwt.verify(res.body.token, config.jwtSecret)
  assert.equal(payload.email, aEmail)
  aToken = res.body.token

  const bEmailRaw = `bruno-${Date.now()}@example.com`
  await api('/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: bEmailRaw, password: 'BrunoPass1' })
  })
  const resB = await api('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: bEmailRaw, password: 'BrunoPass1' })
  })
  bToken = resB.body.token
  bEmail = bEmailRaw
})

test('001 - POST /login credenciales inválidas devuelven 401 genérico', async () => {
  const wrongPassword = await api('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: aEmail, password: 'Incorrecta1' })
  })
  assert.equal(wrongPassword.status, 401)
  assert.equal(wrongPassword.body.error, 'Invalid credentials')

  const unknownUser = await api('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'no-existe@example.com', password: 'LoQueSea123' })
  })
  assert.equal(unknownUser.status, 401)
  assert.equal(unknownUser.body.error, wrongPassword.body.error)
})

test('001 - endpoint protegido sin token devuelve 401', async () => {
  const noHeader = await api('/images')
  assert.equal(noHeader.status, 401)
  assert.equal(noHeader.body.error, 'Unauthorized')

  const tampered = await api('/images', { headers: { Authorization: 'Bearer abc.def.ghi' } })
  assert.equal(tampered.status, 401)
})

test('002 - POST /images sube PNG válido y persiste metadatos reales', async () => {
  const res = await uploadImage(aToken, png32, 'mi foto.png')
  assert.equal(res.status, 201)

  assert.match(res.body.id, /^[0-9a-f-]{36}$/)
  assert.equal(res.body.filename, 'mi foto.png')
  assert.equal(res.body.mimeType, 'image/png')
  assert.equal(res.body.size, png32.byteLength)
  assert.equal(res.body.width, 32)
  assert.equal(res.body.height, 32)
  assert.equal(res.body.url, `/api/v1/images/${res.body.id}/file`)
  assert.ok(res.body.createdAt)

  const stored = await prisma.image.findUnique({ where: { id: res.body.id } })
  assert.equal(stored.userId, (jwt.decode(aToken)).sub)
  aImageIds.push(res.body.id)
})

test('002 - dos uploads idénticos generan ids distintos', async () => {
  const first = await uploadImage(aToken, png32)
  const second = await uploadImage(aToken, png32)
  assert.equal(first.status, 201)
  assert.equal(second.status, 201)
  assert.notEqual(first.body.id, second.body.id)
  aImageIds.push(first.body.id, second.body.id)
})

test('002 - POST /images sin campo file devuelve 400', async () => {
  const form = new FormData()
  form.append('otro', 'valor')
  const res = await api('/images', { method: 'POST', headers: authHeaders(aToken), body: form })
  assert.equal(res.status, 400)
  assert.equal(res.body.error, 'No image file provided')
})

test('002 - POST /images con contenido corrupto devuelve 400 Invalid image content', async () => {
  const res = await uploadImage(aToken, Buffer.from('esto no es una imagen'), 'fake.png')
  assert.equal(res.status, 400)
  assert.equal(res.body.error, 'Invalid image content')
})

test('004 - GET /images/:id devuelve detalle propio con variants vacío', async () => {
  const id = aImageIds[0]
  const res = await api(`/images/${id}`, { headers: authHeaders(aToken) })
  assert.equal(res.status, 200)
  assert.equal(res.body.id, id)
  assert.equal(res.body.url, `/api/v1/images/${id}/file`)
  assert.deepEqual(res.body.variants, {})
  assert.ok(res.body.createdAt)
})

test('004 - GET /images/:id ajeno o inexistente devuelve 404 idéntico', async () => {
  const foreign = await api(`/images/${aImageIds[0]}`, { headers: authHeaders(bToken) })
  assert.equal(foreign.status, 404)
  assert.equal(foreign.body.error, 'Image not found')

  const missing = await api('/images/00000000-0000-4000-8000-000000000000', {
    headers: authHeaders(aToken)
  })
  assert.equal(missing.status, 404)
  assert.equal(missing.body.error, foreign.body.error)
})

test('004 - GET /images/:id/file sirve el binario byte a byte', async () => {
  const id = aImageIds[0]
  const res = await fetch(`${baseUrl}/images/${id}/file`, { headers: authHeaders(aToken) })
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'image/png')
  assert.equal(res.headers.get('cache-control'), 'private, max-age=3600')

  const downloaded = Buffer.from(await res.arrayBuffer())
  assert.equal(Buffer.compare(downloaded, png32), 0)
})

test('004 - GET file con ?download=1 añade Content-Disposition', async () => {
  const id = aImageIds[0]
  const res = await fetch(`${baseUrl}/images/${id}/file?download=1`, {
    headers: authHeaders(aToken)
  })
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-disposition'), /^attachment; filename="[^"]+"$/)
})

test("004 - binario borrado del disco devuelve 404 'File missing'", async () => {
  const upload = await uploadImage(bToken, png32)
  assert.equal(upload.status, 201)
  bImageId = upload.body.id

  const stored = await prisma.image.findUnique({ where: { id: bImageId } })
  await unlink(path.resolve(config.uploadsDir, stored.storagePath))

  const res = await fetch(`${baseUrl}/images/${bImageId}/file`, { headers: authHeaders(bToken) })
  assert.equal(res.status, 404)
  assert.equal(await res.text(), JSON.stringify({ error: 'File missing' }))
})

test('005 - GET /images aplica defaults y aislamiento por usuario', async () => {
  const resA = await api('/images', { headers: authHeaders(aToken) })
  assert.equal(resA.status, 200)
  assert.equal(resA.body.pagination.page, 1)
  assert.equal(resA.body.pagination.limit, 10)
  assert.equal(resA.body.pagination.total, aImageIds.length)
  assert.equal(resA.body.data.length, Math.min(10, aImageIds.length))
  assert.ok(resA.body.data.every(item => !item.variants))

  const resB = await api('/images', { headers: authHeaders(bToken) })
  assert.equal(resB.body.pagination.total, 1)
  assert.equal(resB.body.data[0].id, bImageId)
  assert.ok(!resA.body.data.some(item => item.id === bImageId))
})

test('005 - orden descendente por createdAt', async () => {
  const last = await uploadImage(aToken, png32, 'ultima.png')
  assert.equal(last.status, 201)
  aImageIds.push(last.body.id)

  const res = await api('/images?page=1&limit=1', { headers: authHeaders(aToken) })
  assert.equal(res.body.data[0].id, last.body.id)
})

test('005 - paginación real con limit=2', async () => {
  const res = await api('/images?page=2&limit=2', { headers: authHeaders(aToken) })
  assert.equal(res.status, 200)
  assert.equal(res.body.pagination.limit, 2)
  assert.equal(res.body.pagination.total, aImageIds.length)
  assert.equal(res.body.pagination.totalPages, Math.ceil(aImageIds.length / 2))
  assert.equal(res.body.data.length, aImageIds.length > 2 ? Math.min(2, aImageIds.length - 2) : 0)
})

test('005 - página fuera de rango devuelve data vacía', async () => {
  const res = await api('/images?page=99&limit=10', { headers: authHeaders(aToken) })
  assert.equal(res.status, 200)
  assert.deepEqual(res.body.data, [])
  assert.equal(res.body.pagination.total, aImageIds.length)
})

test('005 - query inválida devuelve 400 con detalles de Zod', async () => {
  for (const query of ['limit=500', 'page=0', 'page=abc']) {
    const res = await api(`/images?${query}`, { headers: authHeaders(aToken) })
    assert.equal(res.status, 400, query)
    assert.equal(res.body.error, 'Invalid request')
    assert.ok(Array.isArray(res.body.details))
  }
})

test('003 - transform resize+webp crea variante determinista', async () => {
  transformTargetId = aImageIds[0]
  const transforms = { resize: { width: 16, height: 16, fit: 'cover' }, format: 'webp' }

  const storagePath = (await prisma.image.findUnique({ where: { id: transformTargetId } })).storagePath
  const bytesBefore = await readFile(path.resolve(config.uploadsDir, storagePath))

  const res = await api(`/images/${transformTargetId}/transform`, {
    method: 'POST',
    headers: { ...authHeaders(aToken), 'Content-Type': 'application/json' },
    body: JSON.stringify(transforms)
  })
  assert.equal(res.status, 201)
  assert.match(res.body.variantId, /^[0-9a-f]{8}$/)
  assert.equal(res.body.mimeType, 'image/webp')
  assert.equal(res.body.width, 16)
  assert.equal(res.body.height, 16)
  assert.ok(['resize', 'format'].every(op => res.body.appliedTransforms.includes(op)))

  const bytesAfter = await readFile(path.resolve(config.uploadsDir, storagePath))
  assert.equal(Buffer.compare(bytesBefore, bytesAfter), 0)

  const repeat = await api(`/images/${transformTargetId}/transform`, {
    method: 'POST',
    headers: { ...authHeaders(aToken), 'Content-Type': 'application/json' },
    body: JSON.stringify(transforms)
  })
  assert.equal(repeat.status, 201)
  assert.equal(repeat.body.variantId, res.body.variantId)

  const variantRes = await fetch(`${baseUrl}/images/${transformTargetId}/variants/${res.body.variantId}`, {
    headers: authHeaders(aToken)
  })
  assert.equal(variantRes.status, 200)
  assert.equal(variantRes.headers.get('content-type'), 'image/webp')
  const variantBytes = Buffer.from(await variantRes.arrayBuffer())
  assert.equal(variantBytes.byteLength, res.body.size)
})

test('003 - filtros combinados rotate+grayscale+sepia+format jpeg', async () => {
  const res = await api(`/images/${transformTargetId}/transform`, {
    method: 'POST',
    headers: { ...authHeaders(aToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ rotate: 90, filters: { grayscale: true, sepia: true }, format: 'jpeg' })
  })
  assert.equal(res.status, 201)
  assert.equal(res.body.mimeType, 'image/jpeg')
  assert.deepEqual([...res.body.appliedTransforms].sort(), ['filters', 'format', 'rotate'].sort())

  const stored = await prisma.image.findUnique({ where: { id: transformTargetId } })
  assert.ok(stored.variants[res.body.variantId])
})

test('003 - crop fuera de límites devuelve 400', async () => {
  const res = await api(`/images/${transformTargetId}/transform`, {
    method: 'POST',
    headers: { ...authHeaders(aToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ crop: { left: 10, top: 10, width: 500, height: 500 } })
  })
  assert.equal(res.status, 400)
  assert.equal(res.body.error, 'Crop out of bounds')
})

test('003 - rotate inválido y payload vacío devuelven 400', async () => {
  const badRotate = await api(`/images/${transformTargetId}/transform`, {
    method: 'POST',
    headers: { ...authHeaders(aToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ rotate: 45 })
  })
  assert.equal(badRotate.status, 400)

  const empty = await api(`/images/${transformTargetId}/transform`, {
    method: 'POST',
    headers: { ...authHeaders(aToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  })
  assert.equal(empty.status, 400)
  assert.ok(empty.body.details.some(d => d.message.includes('at least one transformation')))
})

test('003 - transformar imagen ajena o inexistente devuelve 404', async () => {
  const foreign = await api(`/images/${transformTargetId}/transform`, {
    method: 'POST',
    headers: { ...authHeaders(bToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ rotate: 90 })
  })
  assert.equal(foreign.status, 404)
  assert.equal(foreign.body.error, 'Image not found')

  const missing = await api('/images/00000000-0000-4000-8000-000000000000/transform', {
    method: 'POST',
    headers: { ...authHeaders(aToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ rotate: 90 })
  })
  assert.equal(missing.status, 404)
})

test('003 - variante aparece en el detalle de la imagen', async () => {
  const detail = await api(`/images/${transformTargetId}`, { headers: authHeaders(aToken) })
  assert.equal(detail.status, 200)
  const entries = Object.entries(detail.body.variants)
  assert.ok(entries.length >= 2)
  for (const [variantId, meta] of entries) {
    assert.equal(meta.url, `/api/v1/images/${transformTargetId}/variants/${variantId}`)
    assert.ok(meta.mimeType.startsWith('image/'))
  }
})
