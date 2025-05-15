import {Message, MultiClient, MultiClientOptions} from 'nkn-sdk'

export enum ConnectionStatus {
  Disconnected = 'disconnected',
  Connecting = 'connecting',
  Connected = 'connected'
}

export interface ConnectServiceEvents {
  onMessage: (message: Message) => Promise<void>
  onConnect: (addr: string, node: {
    addr: string,
    id: string,
    pubkey: string,
    rpcAddr: string,
    sdp: string
  }) => Promise<void>
  onDisconnect: () => Promise<void>
  onError: (error: Error) => Promise<void>
}

export class ConnectService {
  private options: MultiClientOptions
  private events: Partial<ConnectServiceEvents>
  public client: MultiClient
  private _connectStatus: ConnectionStatus = ConnectionStatus.Disconnected
  private _waitConnected: Promise<void>

  constructor(options: Partial<MultiClientOptions> & Partial<ConnectServiceEvents>) {
    if (!options.seed) {
      throw new Error('Seed is required')
    }
    this.options = {
      seed: options.seed,
      identifier: options.identifier || '',
      numSubClients: options.numSubClients || 4,
      originalClient: options.originalClient || true,
    }
    this.events = options
  }

  public async connect(): Promise<MultiClient> {
    this._connectStatus = ConnectionStatus.Connecting
    this.client = new MultiClient(this.options)

    this._waitConnected = new Promise((resolve, reject) => {
      this.client.onConnect(({node}) => {
        this._connectStatus = ConnectionStatus.Connected

        this.events.onConnect?.(this.client.addr, node)
        resolve()
      })

      this.client.onConnectFailed(() => {
        this._connectStatus = ConnectionStatus.Disconnected

        const error = new Error('Failed to connect')
        this.events.onError?.(error)
        reject(error)
      })
    })

    this.client.onMessage(async (message: Message) => {
      this.events.onMessage?.(message)
    })

    await this.waitConnected
    return this.client
  }

  public async disconnect(): Promise<void> {
    await this.client.close()
    this._connectStatus = ConnectionStatus.Disconnected
    this.events.onDisconnect?.()
  }

  public get connectStatus(): ConnectionStatus {
    return this._connectStatus
  }

  public get waitConnected(): Promise<void> {
    return this._waitConnected
  }
}