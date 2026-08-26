import amqplib from 'amqplib'
import { config } from '../config.js'

const QUEUE = 'image.transforms'

async function withChannel(fn) {
  const conn = await amqplib.connect(config.rabbitUrl)
  try {
    return await fn(conn)
  } finally {
    await conn.close()
  }
}

export const queueService = {
  publishTransform(payload) {
    return withChannel(async conn => {
      const ch = await conn.createChannel()
      await ch.assertQueue(QUEUE, { durable: true })
      ch.sendToQueue(QUEUE, Buffer.from(JSON.stringify(payload)), { persistent: true })
    })
  },

  async consume(onMessage) {
    const conn = await amqplib.connect(config.rabbitUrl)
    const ch = await conn.createChannel()
    await ch.assertQueue(QUEUE, { durable: true })
    ch.prefetch(1)
    ch.consume(QUEUE, msg => {
      if (!msg) return
      Promise.resolve()
        .then(() => onMessage(JSON.parse(msg.content.toString())))
        .then(() => ch.ack(msg))
        .catch(() => ch.nack(msg, false, false))
    })
    return { conn, channel: ch }
  }
}
