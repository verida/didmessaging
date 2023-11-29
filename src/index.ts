
import { Client, Context, Network } from '@verida/client-ts';
import { EnvironmentType, IMessaging } from '@verida/types';
import { AutoAccount } from '@verida/account-node';
import { Wallet } from 'ethers';
import PromptSync  from 'prompt-sync';
import { Command, Option } from 'commander';
import 'dotenv/config'
import * as fs from 'fs';


export default class DIDMessagingApp {
  veridaContext: Context | undefined;
  veridaAccount: AutoAccount | undefined;
  veridaMessaging: IMessaging | undefined;


  private async createDID() {
    const wallet = Wallet.createRandom();

    this.veridaAccount = new AutoAccount({
      privateKey: wallet.privateKey,
      environment: process.env.VERIDA_ENVIRONMENT as EnvironmentType,
      didClientConfig: {
        callType: 'web3',
        web3Config: {
          privateKey: process.env.POLYGON_PRIVATE_KEY,
          rpcUrl: process.env.RPC_URL,
        },
      },
    });

    this.veridaContext = await Network.connect({
      client: {
        environment: process.env.VERIDA_ENVIRONMENT as EnvironmentType,
      },
      account: this.veridaAccount,
      context: {
        name: "DID Message Sender",
      },
    });
  }

  private async connect() {
    this.veridaAccount = new AutoAccount({
      privateKey: process.env.PRIVATE_KEY,
      environment: process.env.VERIDA_ENVIRONMENT as EnvironmentType,
      didClientConfig: {
        callType: 'web3',
        web3Config: {
          privateKey: process.env.POLYGON_PRIVATE_KEY,
          rpcUrl: process.env.RPC_URL,
        }
      },
    });

    const client = new Client({
      environment: process.env.VERIDA_ENVIRONMENT as EnvironmentType
    })

    await client.connect(this.veridaAccount);


    this.veridaContext = await client.openContext("Verida Official Messages", true) as Context;

  }
  
  private keyPhraseToKey() {
    const prompt = PromptSync();
    const phrase = prompt("Please enter the seed phrase:");
    // const wallet = Wallet.fromPhrase(phrase) v6 syntax

    const wallet = Wallet.fromMnemonic(phrase)

    console.log("Private key:", wallet.privateKey);
  }

  private async sendMessage(didfile: string) {
    if (didfile) {
      const didlist = fs.readFileSync(didfile, 'utf-8');

      console.log("Connecting to Verida...")
      await this.connect();
      console.log("Getting messaging...")
      const messaging = await this.veridaContext.getMessaging();
  
      // set the subject
      const subject = "Message from Nick!"
      // we need to set it to the correct message type
      const messageType = "inbox/type/message"
  

      const data = {
        data: [{
          subject:subject,
          message:"test message"
        }]
      }    

      const dids = didlist.split(/\n/)

      for (let i = 0; i < dids.length; i++) {
        const config = {
          recipientContextName: "Verida: Vault",
          
          did: dids[i]
        }
    
        console.log(`Sending message ${i + 1}/${dids.length} to ${dids[i]}`);
        await messaging.send(dids[i], messageType, data, subject, config);
      }
  
      console.log("Messages sent.")
      console.log("Closing context...")
      await this.veridaContext.close();
      //await this.veridaContext.disconnect();
  
    }



    return;
  }

  
  public async main() {
    const program = new Command();
    program
      .description("Send messages to Verida DIDs")
      .option("-nd --newdid", "Create a new DID to send messages from")
      .option("-kp --keyphrase", "Get a private key from a key phrase")
      .option("-s --send", "Send a message")
      .addOption(new Option("-df --didfile <filename>", "File of DIDs to send to formatted one-per-line").preset("didfile.txt"))
      .parse(process.argv);
    
    const options = program.opts();
    
    console.log(options);
  
    if (options['newdid']) {
      await this.createDID();
    } else if (options['keyphrase']) {
      await this.keyPhraseToKey()
    } else if (options['send']) {
      await this.sendMessage(options['didfile'])
    }

    return
  }
}

const app = new DIDMessagingApp();
app.main();
