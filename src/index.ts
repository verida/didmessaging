import { Client, Context, Network } from '@verida/client-ts';
import { EnvironmentType, IMessaging } from '@verida/types';
import { AutoAccount } from '@verida/account-node';
import { Wallet } from 'ethers';
import PromptSync  from 'prompt-sync';
import { Command } from 'commander';
import 'dotenv/config'


export default class DIDMessagingApp {

  #veridaContext: Context | undefined;
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
    

    this.veridaContext = await client.openContext("DID Message Sender", true) as Context;

  }
  
  private keyPhraseToKey() {
    const prompt = PromptSync();
    const phrase = prompt("Please enter the seed phrase:");
    const wallet = Wallet.fromPhrase(phrase) 
    console.log("Private key:", wallet.privateKey);
  }

  private async sendMessage() {
    await this.connect();
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

    //onst toDID = "did:vda:testnet:0xf080913daa2f1F2F93dfF494a2F3E6e1A2e2C492";
    //const toDID = "did:vda:testnet:0xb362351168D370b174E0fD3Feec93C4E6d2938e2"
    const toDID = "did:vda:testnet:0x6Aef8B78D47316a61e10703d4dAe5F0a34516a3B"

    const config = {
      recipientContextName: "Verida: Vault",
      
      did: toDID
    }

    await messaging.send(toDID, messageType, data, subject, config);

    await this.veridaContext.close();

    return;
  }

  
  public async main() {
    const program = new Command();
    program
      .description("Send messages to Verida DIDs")
      .option("-nd --newdid", "Create a new DID to send messages from")
      .option("-kp --keyphrase", "Get a private key from a key phrase")
      .option("-s --send", "Send a message")
      .parse(process.argv);
    
    const options = program.opts();
    
    console.log(options);
  
    if (options['newdid']) {
      await this.createDID();
    } else if (options['keyphrase']) {
      await this.keyPhraseToKey()
    } else if (options['send']) {
      await this.sendMessage()
    }
 
  }
}

const app = new DIDMessagingApp();
app.main();
