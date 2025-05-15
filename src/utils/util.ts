import {IPayloadSchema} from '../schema/payload.ts'
import {logger} from './log.ts'

export function parseMessage(raw: string): IPayloadSchema | null {
  try {
    const payload = JSON.parse(raw) as IPayloadSchema

    // Validate message has required fields
    if (!payload.contentType || !payload.id) {
      logger.debug('Invalid message format:', raw)
      return null
    }

    return payload
  } catch (error) {
    logger.error('Failed to parse message:', error)
    return null
  }
}

export function stringifyMessage(message: IPayloadSchema): string {
  try { 
    return JSON.stringify(message)
  } catch (error) {
    logger.error('Failed to stringify message:', error)
    return ''
  }
}
