// src/services/terminal.ts
import { v4 as uuidV4 } from "uuid";

// src/utils/log.ts
import log from "loglevel";
if (process.env.NODE_ENV === "production") {
  log.setDefaultLevel("info");
} else {
  log.setDefaultLevel("trace");
}
var Logger = class {
  setLevel(level) {
    log.setLevel(level);
  }
  getLevel() {
    return log.getLevel();
  }
  trace(...msg) {
    log.trace(...msg);
  }
  debug(...msg) {
    log.debug(...msg);
  }
  info(...msg) {
    log.info(...msg);
  }
  warn(...msg) {
    log.warn(...msg);
  }
  error(...msg) {
    log.error(...msg);
  }
};
var logger = new Logger();

// src/services/terminal.ts
import yargs from "yargs";

// src/utils/util.ts
function parseMessage(raw) {
  try {
    const payload = JSON.parse(raw);
    if (!payload.contentType || !payload.id) {
      logger.debug("Invalid message format:", raw);
      return null;
    }
    return payload;
  } catch (error) {
    logger.error("Failed to parse message:", error);
    return null;
  }
}

// src/services/connect.ts
import { MultiClient } from "nkn-sdk";
var ConnectService = class {
  options;
  events;
  client;
  _connectStatus = "disconnected" /* Disconnected */;
  _waitConnected;
  constructor(options) {
    if (!options.seed) {
      throw new Error("Seed is required");
    }
    this.options = {
      seed: options.seed,
      identifier: options.identifier || "",
      numSubClients: options.numSubClients || 4,
      originalClient: options.originalClient || true
    };
    this.events = options;
  }
  async connect() {
    this._connectStatus = "connecting" /* Connecting */;
    this.client = new MultiClient(this.options);
    this._waitConnected = new Promise((resolve, reject) => {
      this.client.onConnect(({ node }) => {
        this._connectStatus = "connected" /* Connected */;
        this.events.onConnect?.(this.client.addr, node);
        resolve();
      });
      this.client.onConnectFailed(() => {
        this._connectStatus = "disconnected" /* Disconnected */;
        const error = new Error("Failed to connect");
        this.events.onError?.(error);
        reject(error);
      });
    });
    this.client.onMessage(async (message) => {
      this.events.onMessage?.(message);
    });
    await this.waitConnected;
    return this.client;
  }
  async disconnect() {
    await this.client.close();
    this._connectStatus = "disconnected" /* Disconnected */;
    this.events.onDisconnect?.();
  }
  get connectStatus() {
    return this._connectStatus;
  }
  get waitConnected() {
    return this._waitConnected;
  }
};

// src/services/terminal.ts
import * as fs from "fs";
import * as path from "path";
var Terminal = class {
  connectService;
  options;
  sendOptions = { noReply: true, msgHoldingSeconds: 864e4 };
  client;
  authorizedAddresses = /* @__PURE__ */ new Set();
  profile;
  constructor(options) {
    this.options = options || {};
    this.profile = options.profile;
    this.onMessage = this.onMessage?.bind(this);
    this.onConnect = this.onConnect?.bind(this);
    this.onDisconnect = this.onDisconnect?.bind(this);
    this.onError = this.onError?.bind(this);
    this.loadAuthorizedAddresses();
    this.connectService = new ConnectService({
      seed: this.options.seed,
      identifier: this.options.identifier || "",
      numSubClients: this.options.numSubClients || 4,
      originalClient: this.options.originalClient || true,
      onMessage: this.onMessage,
      onConnect: this.onConnect,
      onDisconnect: this.onDisconnect,
      onError: this.onError
    });
  }
  loadAuthorizedAddresses() {
    try {
      const authPath = this.options.authorizePath || path.join(process.cwd(), "authorized");
      if (fs.existsSync(authPath)) {
        const content = fs.readFileSync(authPath, "utf-8");
        const addresses = content.split("\n").map((addr) => addr.trim()).filter((addr) => addr.length > 0 && !addr.startsWith("#"));
        this.authorizedAddresses = new Set(addresses);
        logger.info(`Loaded ${this.authorizedAddresses.size} authorized addresses`);
      } else {
        const defaultContent = `# Authorized NKN client addresses
# One address per line
# Example addresses:
# 77dba12e1b8cb518ae1ea9b1d872098f1a19856abc4594601416adc65963df61`;
        fs.writeFileSync(authPath, defaultContent, "utf-8");
        logger.info(`Created authorized addresses file at ${authPath}`);
        const addresses = defaultContent.split("\n").map((addr) => addr.trim()).filter((addr) => addr.length > 0 && !addr.startsWith("#"));
        this.authorizedAddresses = new Set(addresses);
        logger.info(`Loaded ${this.authorizedAddresses.size} authorized addresses`);
      }
    } catch (error) {
      logger.error("Error loading authorized addresses:", error);
    }
  }
  async authorize(src) {
    if (this.authorizedAddresses.size === 0) {
      return false;
    }
    return this.authorizedAddresses.has(src);
  }
  async onConnect(addr, node) {
    logger.info(`Connected. Your terminal address is ${addr}`);
  }
  async onMessage(message) {
    logger.info(`Received message from ${message.src}: ${message.payload}`);
    await this.handleMessage(message.src, message.payload);
  }
  async onDisconnect() {
    logger.info("Disconnected from the terminal");
  }
  async onError(error) {
    logger.error("Error", error);
  }
  async handleMessage(src, raw) {
    try {
      if (typeof raw == "string") {
        const message = parseMessage(raw);
        if (!message) {
          logger.debug(`Invalid message format from ${src}`);
          return;
        }
        if (message.contentType === "receipt" /* receipt */ || message.contentType === "read" /* read */) {
          return;
        }
        if (message.contentType === "contact" /* contactProfile */) {
          logger.info(`Received contact profile from ${src}:`, raw);
          const avatar = fs.readFileSync(path.join(process.cwd(), this.profile.avatar));
          const avatarExt = this.profile.avatar_ext;
          const version = this.profile.version;
          const name = this.profile.name;
          await this.sendContactProfile(src, message.requestType, name, Buffer.from(avatar).toString("base64"), avatarExt, version);
          return;
        }
        try {
          await this.sendReceiptMessage(src, message.id);
          await this.sendReadMessage(src, message.id);
        } catch (error) {
          logger.error("Error sending receipt:", error);
        }
        if (message.contentType !== "text" /* text */) {
          return;
        }
        if (!await this.authorize(src)) {
          logger.info(`Permission denied for ${src}`);
          await this.sendErrorMessage(src, "Permission denied");
          return;
        }
        if (!message.content.startsWith("/")) {
          return;
        }
        logger.info(`Received command from ${src}: ${message.content}`);
        await this.handleCommand(message.content, src);
      }
    } catch (error) {
      logger.error("Error handling message:", error);
      try {
        await this.sendErrorMessage(src, "Internal server error");
      } catch (error2) {
        logger.error("Error sending error response:", error2);
      }
    }
  }
  async handleCommand(command, src) {
    try {
      const commandArgs = command.substring(1);
      const yargsConfig = this.options.yargs || {
        scriptName: "",
        usage: "/<command> [options]",
        help: true,
        helpAlias: "h",
        commands: []
      };
      const parser = yargs([]).scriptName(yargsConfig.scriptName || "").usage(yargsConfig.usage || "/<command> [options]").help(yargsConfig.help !== false).alias(yargsConfig.helpAlias || "h", "help");
      yargsConfig.commands.forEach((cmd) => {
        parser.command(cmd.name, cmd.description, (yargs2) => {
          if (cmd.builder) {
            return cmd.builder(yargs2, src, this);
          }
          return yargs2;
        }, async (argv) => {
          try {
            await cmd.handler(argv, src, this);
          } catch (error) {
            logger.error(`Error executing command ${cmd.name}:`, error);
            await this.sendErrorMessage(src, `Error executing command: ${error.message}`);
          }
        });
      });
      await parser.parse(commandArgs, (error, argv, output) => {
        if (error) {
          logger.error("Error parsing command:", error);
          this.sendErrorMessage(src, `Error: ${error.message}`);
          return;
        }
        if (output) {
          this.sendResultMessage(src, output);
          return;
        }
      });
      return parser.getHelp();
    } catch (error) {
      logger.error("Error processing command:", error);
      return `Error: ${error.message}. Type /help for available commands.`;
    }
  }
  async sendErrorMessage(src, message) {
    const data = {
      id: uuidV4(),
      contentType: "text" /* text */,
      content: `> \u26A0\uFE0F **Error**: ${message}`,
      timestamp: Date.now()
    };
    await this.client.send(src, JSON.stringify(data), this.sendOptions);
  }
  setLogLevel(level) {
    logger.setLevel(level);
  }
  async connect() {
    await this.connectService.connect();
    this.client = this.connectService.client;
  }
  async disconnect() {
    await this.connectService.disconnect();
    this.client = null;
  }
  async sendReceiptMessage(src, msgId) {
    const data = {
      id: uuidV4(),
      contentType: "receipt",
      targetID: msgId,
      timestamp: Date.now()
    };
    await this.client.send(src, JSON.stringify(data), this.sendOptions);
  }
  async sendReadMessage(src, msgId) {
    const data = {
      id: uuidV4(),
      contentType: "read",
      readIds: [msgId],
      timestamp: Date.now()
    };
    await this.client.send(src, JSON.stringify(data), this.sendOptions);
  }
  async sendResultMessage(src, message) {
    const data = {
      id: uuidV4(),
      contentType: "text",
      content: message,
      timestamp: Date.now()
    };
    await this.client.send(src, JSON.stringify(data), this.sendOptions);
  }
  async sendContactProfile(src, responseType, name, avatar, avatarExt, version) {
    const data = {
      id: uuidV4(),
      timestamp: Date.now(),
      contentType: "contact" /* contactProfile */,
      version,
      responseType
    };
    if (responseType == "full") {
      data.content = {
        name,
        avatar: {
          type: "base64",
          data: avatar,
          ext: avatarExt
        }
      };
    }
    await this.client.send(src, JSON.stringify(data), this.sendOptions);
  }
};
export {
  Terminal
};
//# sourceMappingURL=index.js.map