import { LogLevelDesc } from 'loglevel';
import { MultiClient, MultiClientOptions } from 'nkn-sdk';

interface MessageSender {
    sendResultMessage(src: string, message: string): Promise<void>;
    sendErrorMessage(src: string, message: string): Promise<void>;
    sendReceiptMessage(src: string, msgId: string): Promise<void>;
    sendReadMessage(src: string, msgId: string): Promise<void>;
}
interface CommandConfig {
    name: string;
    description: string;
    builder?: (yargs: any, src: string, sender: MessageSender) => any;
    handler: (argv: any, src: string, sender: MessageSender) => Promise<void>;
}
interface YargsConfig {
    scriptName?: string;
    usage?: string;
    help?: boolean;
    helpAlias?: string;
    commands: CommandConfig[];
}
interface TerminalOptions {
    authorizePath?: string;
    yargs?: YargsConfig;
}
interface ProfileOptions {
    avatar?: string;
    name?: string;
    avatar_ext?: string;
    version?: string;
}
declare class Terminal implements MessageSender {
    private connectService;
    private options;
    private sendOptions;
    client: MultiClient;
    private authorizedAddresses;
    private profile;
    constructor(options: Partial<MultiClientOptions> & TerminalOptions & {
        profile: ProfileOptions;
    });
    private loadAuthorizedAddresses;
    private authorize;
    private onConnect;
    private onMessage;
    private onDisconnect;
    private onError;
    private handleMessage;
    private handleCommand;
    sendErrorMessage(src: string, message: string): Promise<void>;
    setLogLevel(level: LogLevelDesc): void;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    sendReceiptMessage(src: string, msgId: string): Promise<void>;
    sendReadMessage(src: string, msgId: string): Promise<void>;
    sendResultMessage(src: string, message: string): Promise<void>;
    sendContactProfile(src: string, responseType: string, name: string, avatar: string, avatarExt: string, version: string): Promise<void>;
}

export { type CommandConfig, type MessageSender, type ProfileOptions, Terminal, type TerminalOptions, type YargsConfig };
