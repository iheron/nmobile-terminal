import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Terminal } from '../src/services/terminal'
import { Wallet } from 'nkn-sdk'

describe('Terminal', () => {
    let terminal: Terminal

    // This runs before each test
    beforeEach(async () => {
        const wallet = new Wallet()
        terminal = new Terminal({
            seed: wallet.getSeed(),
            identifier: '',
            numSubClients: 4,
            originalClient: true,
        })
        await terminal.connect()
    })


    describe('connect', () => {
        it('should connect to the terminal', async () => {
            
        })
    })


})
