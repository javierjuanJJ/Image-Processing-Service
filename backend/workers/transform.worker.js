import { config } from '../config.js'
import { queueService } from '../services/queue.service.js'
import { sharpService } from '../services/sharp.service.js'
import { imageModel } from '../models/image.model.js'
import { transformModel } from '../models/transform.model.js'

await queueService.consume(async ({ logId, imageId, transforms }) => {
  const image = await imageModel.getById(imageId)
  if (!image) {
    await transformModel.markFailed(logId)
    return
  }
  try {
    const variantId = sharpService.variantIdFor(imageId, transforms)
    const existing = image.variants?.[variantId]
    const variant = existing ?? (await sharpService.buildVariant(image, transforms))
    await imageModel.addVariant({ imageId, variantId, variant })
    await transformModel.markDone(logId)
  } catch (err) {
    console.error(`transform ${logId} failed:`, err.message)
    await transformModel.markFailed(logId)
  }
})

console.log(`transform worker consuming on ${config.rabbitUrl} (queue: image.transforms)`)
