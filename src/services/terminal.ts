import {LogLevelDesc} from 'loglevel'
import {Message, MultiClient, MultiClientOptions} from 'nkn-sdk'
import {v4 as uuidV4} from 'uuid'
import {logger} from '../utils/log'
import yargs from 'yargs'
import {parseMessage} from '../utils/util'
import {ConnectService} from './connect'
import * as fs from 'fs'
import * as path from 'path'
import {MessageContentType} from '../schema/messageEnum'

export interface MessageSender {
  sendResultMessage(src: string, message: string): Promise<void>

  sendErrorMessage(src: string, message: string): Promise<void>

  sendReceiptMessage(src: string, msgId: string): Promise<void>

  sendReadMessage(src: string, msgId: string): Promise<void>
}

export interface CommandConfig {
  name: string
  description: string
  builder?: (yargs: any, src: string, sender: MessageSender) => any
  handler: (argv: any, src: string, sender: MessageSender) => Promise<void>
}

export interface YargsConfig {
  scriptName?: string
  usage?: string
  help?: boolean
  helpAlias?: string
  commands: CommandConfig[]
}

export interface TerminalOptions {
  authorizePath?: string
  yargs?: YargsConfig
}

export class Terminal implements MessageSender {
  private connectService: ConnectService
  private options: Partial<MultiClientOptions> & TerminalOptions
  private sendOptions = {noReply: true, msgHoldingSeconds: 8640000}
  public client: MultiClient
  private authorizedAddresses: Set<string> = new Set()

  constructor(options: Partial<MultiClientOptions> & TerminalOptions) {
    this.options = options || {}

    // Bind the callback methods to preserve this context
    this.onMessage = this.onMessage?.bind(this)
    this.onConnect = this.onConnect?.bind(this)
    this.onDisconnect = this.onDisconnect?.bind(this)
    this.onError = this.onError?.bind(this)

    // Load authorized addresses
    this.loadAuthorizedAddresses()

    this.connectService = new ConnectService({
      seed: this.options.seed,
      identifier: this.options.identifier || '',
      numSubClients: this.options.numSubClients || 4,
      originalClient: this.options.originalClient || true,
      onMessage: this.onMessage,
      onConnect: this.onConnect,
      onDisconnect: this.onDisconnect,
      onError: this.onError,
    })
  }

  private loadAuthorizedAddresses(): void {
    try {
      const authPath = this.options.authorizePath || path.join(process.cwd(), 'authorized')
      if (fs.existsSync(authPath)) {
        const content = fs.readFileSync(authPath, 'utf-8')
        const addresses = content.split('\n')
          .map(addr => addr.trim())
          .filter(addr => addr.length > 0 && !addr.startsWith('#'))
        this.authorizedAddresses = new Set(addresses)
        logger.info(`Loaded ${this.authorizedAddresses.size} authorized addresses`)
      } else {
        // Create authorized file with default content
        const defaultContent = `# Authorized NKN client addresses
# One address per line
# Example addresses:
# 77dba12e1b8cb518ae1ea9b1d872098f1a19856abc4594601416adc65963df61`
        fs.writeFileSync(authPath, defaultContent, 'utf-8')
        logger.info(`Created authorized addresses file at ${authPath}`)
        // Load the newly created file
        const addresses = defaultContent.split('\n')
          .map(addr => addr.trim())
          .filter(addr => addr.length > 0 && !addr.startsWith('#'))
        this.authorizedAddresses = new Set(addresses)
        logger.info(`Loaded ${this.authorizedAddresses.size} authorized addresses`)
      }
    } catch (error) {
      logger.error('Error loading authorized addresses:', error)
    }
  }

  private async authorize(src: string): Promise<boolean> {
    // If no authorized addresses are loaded, allow all
    if (this.authorizedAddresses.size === 0) {
      return false
    }
    return this.authorizedAddresses.has(src)
  }

  private async onConnect(addr: string, node: {
    addr: string,
    id: string,
    pubkey: string,
    rpcAddr: string,
    sdp: string
  }): Promise<void> {
    logger.info(`Connected. Your terminal address is ${addr}`)
  }

  private async onMessage(message: Message): Promise<void> {
    logger.info(`Received message from ${message.src}: ${message.payload}`)
    await this.handleMessage(message.src, message.payload)
  }

  private async onDisconnect(): Promise<void> {
    logger.info('Disconnected from the terminal')
  }

  private async onError(error: Error): Promise<void> {
    logger.error('Error', error)
  }

  private async handleMessage(src: string, raw: string | Uint8Array): Promise<void> {
    try {
      if (typeof raw == 'string') {
        // Parse the message
        const message = parseMessage(raw)

        if (!message) {
          // Invalid message format
          logger.debug(`Invalid message format from ${src}`)
          return
        }

        if (message.contentType === MessageContentType.receipt || message.contentType === MessageContentType.read) {
          return
        }

        // Send a receipt for the message
        try {
          await this.sendReceiptMessage(src, message.id)
          await this.sendReadMessage(src, message.id)
        } catch (error) {
          logger.error('Error sending receipt:', error)
        }

        if (message.contentType !== MessageContentType.text) {
          return
        }

        if (!(await this.authorize(src))) {
          logger.info(`Permission denied for ${src}`)
          await this.sendErrorMessage(src, 'Permission denied')
          return
        }

        if (!message.content.startsWith('/')) {
          return
        }
        logger.info(`Received command from ${src}: ${message.content}`)

        await this.handleCommand(message.content, src)

      }
    } catch (error) {
      logger.error('Error handling message:', error)
      try {
        await this.sendErrorMessage(src, 'Internal server error')
      } catch (error) {
        logger.error('Error sending error response:', error)
      }
    }
  }

  private async handleCommand(command: string, src: string): Promise<string> {
    try {
      // Parse the command string into arguments
      const commandArgs = command.substring(1)

      // Get yargs configuration or use defaults
      const yargsConfig = this.options.yargs || {
        scriptName: '',
        usage: '/<command> [options]',
        help: true,
        helpAlias: 'h',
        commands: [],
      }

      // Configure yargs parser
      const parser = yargs([])
        .scriptName(yargsConfig.scriptName || '')
        .usage(yargsConfig.usage || '/<command> [options]')
        .help(yargsConfig.help !== false)
        .alias(yargsConfig.helpAlias || 'h', 'help')

      // Add commands from configuration
      yargsConfig.commands.forEach(cmd => {
        parser.command(cmd.name, cmd.description, (yargs) => {
          if (cmd.builder) {
            return cmd.builder(yargs, src, this)
          }
          return yargs
        }, async (argv) => {
          try {
            await cmd.handler(argv, src, this)
          } catch (error) {
            logger.error(`Error executing command ${cmd.name}:`, error)
            await this.sendErrorMessage(src, `Error executing command: ${error.message}`)
          }
        })
      })

      // Parse the command
      await parser.parse(commandArgs, (error, argv, output) => {
        if (error) {
          logger.error('Error parsing command:', error)
          this.sendErrorMessage(src, `Error: ${error.message}`)
          return
        }
        if (output) {
          this.sendResultMessage(src, output)
          return
        }
      })

      // Return help text
      return parser.getHelp()
    } catch (error) {
      logger.error('Error processing command:', error)
      return `Error: ${error.message}. Type /help for available commands.`
    }
  }

  public async sendErrorMessage(src: string, message: string): Promise<void> {
    const data = {
      id: uuidV4(),
      contentType: MessageContentType.text,
      content: `> ⚠️ **Error**: ${message}`,
      timestamp: Date.now(),
    }
    await this.client.send(src, JSON.stringify(data), this.sendOptions)
  }

  public setLogLevel(level: LogLevelDesc): void {
    logger.setLevel(level)
  }

  public async connect(): Promise<void> {
    await this.connectService.connect()
    this.client = this.connectService.client
  }

  public async disconnect(): Promise<void> {
    await this.connectService.disconnect()
    this.client = null
  }

  public async sendReceiptMessage(src: string, msgId: string): Promise<void> {
    const data = {
      id: uuidV4(),
      contentType: 'receipt',
      targetID: msgId,
      timestamp: Date.now(),
    }
    await this.client.send(src, JSON.stringify(data), this.sendOptions)
  }

  public async sendReadMessage(src: string, msgId: string): Promise<void> {
    const data = {
      id: uuidV4(),
      contentType: 'read',
      readIds: [msgId],
      timestamp: Date.now(),
    }
    await this.client.send(src, JSON.stringify(data), this.sendOptions)
  }

  public async sendResultMessage(src: string, message: string): Promise<void> {
    const data = {
      id: uuidV4(),
      contentType: 'text',
      content: message,
      timestamp: Date.now(),
    }
    await this.client.send(src, JSON.stringify(data), this.sendOptions)
  }
}