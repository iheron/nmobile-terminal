import {FileType, MessageContentType} from './messageEnum'

export interface MediaOptions {
  fileExt: string
  fileType: FileType
  mediaDuration: number
  audioDuration: number
}

export interface PieceOptions {
  piece_index: number
  piece_total: number
  piece_parity: number
  piece_parent_type: string
  piece_bytes_length: number
  fileExt: string
  fileType: FileType
}

export interface PayloadOptions extends Partial<MediaOptions>, Partial<PieceOptions> {
  deviceId?: string
  profileVersion?: string
  deleteAfterSeconds?: number
  updateBurnAfterAt?: number
  deviceProfile?: string
}

export interface IPayloadSchema {
  id: string
  topic?: string
  groupId?: string
  content?: any
  contentType: MessageContentType
  timestamp?: number
  deviceId?: string
  options?: PayloadOptions
}
