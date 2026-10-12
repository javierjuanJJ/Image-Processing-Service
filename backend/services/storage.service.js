import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { config } from '../config.js'

/**
 * Storage service — abstraction over disk / S3 / Cloudflare R2 / Google Cloud Storage.
 *
 * All providers accept relative POSIX-style paths (forward slashes).
 * The controller and sharp service always work with relative keys;
 * each provider translates them to its native format internally.
 */

const joinKey = (...parts) => parts.join('/')

// ---------------------------------------------------------------------------
// Disk provider (local filesystem)
// ---------------------------------------------------------------------------

const diskProvider = {
  name: 'disk',

  async upload(relPath, buffer) {
    const absPath = path.resolve(config.uploadsDir, relPath)
    await mkdir(path.dirname(absPath), { recursive: true })
    await writeFile(absPath, buffer)
  },

  async download(relPath) {
    const absPath = path.resolve(config.uploadsDir, relPath)
    return readFile(absPath)
  },

  async delete(relPath) {
    const absPath = path.resolve(config.uploadsDir, relPath)
    await unlink(absPath)
  },

  async exists(relPath) {
    try {
      await this.download(relPath)
      return true
    } catch {
      return false
    }
  }
}

// ---------------------------------------------------------------------------
// S3 / Cloudflare R2 provider (AWS SDK v3)
// ---------------------------------------------------------------------------

let _s3Client = null

async function getS3Client() {
  if (_s3Client) return _s3Client

  const { S3Client } = await import('@aws-sdk/client-s3')

  const { provider: p, region, bucket, endpoint, accessKeyId, secretAccessKey } = config.storage

  _s3Client = new S3Client({
    region,
    endpoint: endpoint || undefined,
    forcePathStyle: p === 'r2' || endpoint ? true : undefined,
    credentials: accessKeyId && secretAccessKey
      ? { accessKeyId, secretAccessKey }
      : undefined
  })

  return _s3Client
}

const s3Provider = {
  name: 's3',

  async upload(relPath, buffer, contentType) {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3')
    const client = await getS3Client()
    await client.send(new PutObjectCommand({
      Bucket: config.storage.bucket,
      Key: relPath,
      Body: buffer,
      ContentType: contentType
    }))
  },

  async download(relPath) {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3')
    const client = await getS3Client()
    const res = await client.send(new GetObjectCommand({
      Bucket: config.storage.bucket,
      Key: relPath
    }))
    return Buffer.from(await res.Body.transformToByteArray())
  },

  async delete(relPath) {
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3')
    const client = await getS3Client()
    await client.send(new DeleteObjectCommand({
      Bucket: config.storage.bucket,
      Key: relPath
    }))
  },

  async exists(relPath) {
    const { HeadObjectCommand } = await import('@aws-sdk/client-s3')
    const client = await getS3Client()
    try {
      await client.send(new HeadObjectCommand({
        Bucket: config.storage.bucket,
        Key: relPath
      }))
      return true
    } catch {
      return false
    }
  }
}

// ---------------------------------------------------------------------------
// Google Cloud Storage provider
// ---------------------------------------------------------------------------

let _gcsStorage = null

async function getGcsStorage() {
  if (_gcsStorage) return _gcsStorage

  const { Storage } = await import('@google-cloud/storage')
  const { bucket, keyFilename } = config.storage

  _gcsStorage = keyFilename
    ? new Storage({ keyFilename })
    : new Storage()

  return _gcsStorage
}

const gcsProvider = {
  name: 'gcs',

  async upload(relPath, buffer, contentType) {
    const storage = await getGcsStorage()
    const file = storage.bucket(config.storage.bucket).file(relPath)
    await file.save(buffer, { contentType })
  },

  async download(relPath) {
    const storage = await getGcsStorage()
    const file = storage.bucket(config.storage.bucket).file(relPath)
    const [contents] = await file.download()
    return contents
  },

  async delete(relPath) {
    const storage = await getGcsStorage()
    const file = storage.bucket(config.storage.bucket).file(relPath)
    await file.delete()
  },

  async exists(relPath) {
    const storage = await getGcsStorage()
    const file = storage.bucket(config.storage.bucket).file(relPath)
    const [exists] = await file.exists()
    return exists
  }
}

// ---------------------------------------------------------------------------
// Factory — pick provider from config
// ---------------------------------------------------------------------------

const providers = {
  disk: diskProvider,
  s3: s3Provider,
  r2: s3Provider,   // Cloudflare R2 is S3-compatible
  gcs: gcsProvider
}

const provider = providers[config.storage.provider] ?? diskProvider

export const storageService = {
  get provider() {
    return provider.name
  },

  upload: (relPath, buffer, contentType) => provider.upload(relPath, buffer, contentType),
  download: (relPath) => provider.download(relPath),
  delete: (relPath) => provider.delete(relPath),
  exists: (relPath) => provider.exists(relPath),

  /** Helper: build a relative key from parts (always forward slashes) */
  key: joinKey
}
