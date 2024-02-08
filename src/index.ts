
import { Client, Context, Network } from '@verida/client-ts';
import {DIDDocument} from '@verida/did-document'
import { EnvironmentType, IMessaging, IProfile } from '@verida/types';
import { AutoAccount } from '@verida/account-node';
import { getDIDs } from "@verida/vda-did-resolver";
import { Command, Option } from 'commander';
import 'dotenv/config'
import * as fs from 'fs';
import { createObjectCsvWriter } from 'csv-writer';

const VAULT_CONTEXT_NAME = "Verida: Vault"

export default class DIDMessagingApp {  
  veridaContext: Context | undefined;
  veridaClient: Client;
  veridaAccount: AutoAccount | undefined;
  veridaMessaging: IMessaging | undefined;

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

    this.veridaClient = new Client({
      environment: process.env.VERIDA_ENVIRONMENT as EnvironmentType
    })

    await this.veridaClient.connect(this.veridaAccount);
    this.veridaContext = await this.veridaClient.openContext(process.env.APP_TITLE, true) as Context;

  }

  private async listdids() {
    const CONTEXT_NAME = "Verida Missions";

    console.log("Connecting to Verida...")
    await this.connect();
    console.log("Connected")

    const dids = []

    const startFrom = 0
    const pageSize = 20
    const maxNumberDids = 1000

    let getMoreDids = true
    let pageStart = startFrom
    let endIndex = pageStart + maxNumberDids

    while (getMoreDids === true) {

      // we have to catch an exception and check the error message to see when there are no more dids
      try {
        const thisPageDids = await getDIDs(process.env.VERIDA_ENVIRONMENT as EnvironmentType, pageStart, pageSize)
        //console.log(thisPageDids)
        dids.push(...thisPageDids)
        pageStart = pageStart + pageSize;
        if (pageStart >= endIndex) {
          getMoreDids = false
        }
      } catch (err) {
        if (err instanceof Error) {
          if ("Failed to get list of active DIDs" === err.message) {
            // no more dids found
            getMoreDids = false
          } else {
            throw err
          }
        } else {
          throw err
        }
      }
    }

    const outputObjects: Array<{did: string, resolved: boolean, has_mission_context: boolean}> = []

    const promisesPageSize: number = 10;
    for (let page = 0; page < Math.ceil(dids.length / promisesPageSize); page++) {
      const startIdx = page * promisesPageSize;
      const endIdx = startIdx + promisesPageSize;
      const pageDids = dids.slice(startIdx, endIdx);

      console.log(`checking DIDs from ${startIdx} to ${endIdx}`)

      const promises: Promise<DIDDocument>[] = []
      pageDids.forEach((did) => {
        promises.push(  
          this.veridaClient.didClient.get(did)  
        );
      })

      const didMatchPattern = /did:[\w:-]+/;

      await Promise.allSettled(promises).then((results) =>
        results.forEach((result) => {
          if (result.status == "fulfilled") {
            let didDoc = result.value 
            let proof = didDoc.locateContextProof(CONTEXT_NAME)
            if (proof) {

              outputObjects.push({did: didDoc.id, resolved: true, has_mission_context: true})
            } else {
              //console.log(`${didDoc.id} does not have a context for ${CONTEXT_NAME}`)
              outputObjects.push({did: didDoc.id, resolved: true, has_mission_context: false})
            }
          } else {
            //console.log(result.reason.message)

            const match = result.reason.message.match(didMatchPattern);
            if (match) {
              const did = match[0];
              outputObjects.push({did: did, resolved: false, has_mission_context: false})
            } else {
              console.log(result.reason)
            }
          }
        }),
      );
    }

    const csvFilePath = `dids-${startFrom}-to-${endIndex}.csv`;
    const csvWriter = createObjectCsvWriter({
      path: csvFilePath,
      header: [
        { id: 'did', title: 'DID' },
        { id: 'resolved', title: 'DID_Resolved' },
        { id: 'has_mission_context', title: 'Has_Mission_Context'}
      ],
    });

    await csvWriter.writeRecords(outputObjects)

    console.log(`DIDs saved to ${csvFilePath}`)

    await this.veridaContext.close();
  }

  private async sendMessage(didfile: string, messagefile: string) {
    if (didfile && messagefile) {
      const didlist = fs.readFileSync(didfile, 'utf-8');
      const messageDetails = JSON.parse(fs.readFileSync(messagefile, 'utf-8'));
      console.log(messageDetails)

      console.log("Connecting to Verida...")
      await this.connect();
      console.log("Getting messaging...")
      const messaging = await this.veridaContext.getMessaging();
  
      // we need to set it to the correct message type
      const messageType = "inbox/type/message"
  
      const data = {
        data: [messageDetails]
      }    

      const dids = didlist.split(/\n/)

      const errorLogFilePath = `message_send_errors_${Date.now()}.csv`;
      const csvWriter = createObjectCsvWriter({
        path: errorLogFilePath,
        append: true,
        header: [
          { id: 'did', title: 'DID' },
          { id: 'errorMessage', title: 'Error_Message' },
        ],
      });

      let numAttemptedSends = 0
      let numSuccessfulSends = 0
      let numFailuredSends = 0;

      try {

        for (let i = 0; i < dids.length; i++) {
          numAttemptedSends++;
          const config = {
            recipientContextName: VAULT_CONTEXT_NAME,
            did: dids[i]
          };
      
          console.log(`Sending message ${i + 1}/${dids.length} to ${dids[i]}`);
          try {
            await messaging.send(dids[i], messageType, data, messageDetails['subject'], config);
            numSuccessfulSends++;
          } catch (err) {
            numFailuredSends++;
            if (err instanceof Error) {
  
              // There are a set of known errors that we should just log and continue for
              const knownErrorMessageRegExs = [
                /Database \(inbox_item \/ .*\) not found on https:.*/,
                /Expired refresh token/,
                /.*Recipient does not have an inbox for that context \(Verida: Vault\)/,
                /No endpoints specified/
              ]
  
              let errorHandled = false;
              for (const regEx of knownErrorMessageRegExs) {
                const match = err.message.match(regEx);
                if (match) {

                  const error: {did: string, errorMessage: string} = {
                    did: dids[i],
                    errorMessage: err.message
                  }

                  await csvWriter.writeRecords([error])

                  errorHandled = true;
                  break
                }
              }
  
              if (!errorHandled) {
                // this is an error we don't know
                throw err
              }
  
            } else {
              // not an Error being thrown
              throw err;
            }
          }
        }
      } finally {
        console.log(`${numAttemptedSends} message sends attempts, of which ${numSuccessfulSends} were successful and ${numFailuredSends} failed.`)
    
        console.log(`Errors saved to ${errorLogFilePath}`)
  
      }
      console.log("Messages sent.")
      console.log("Closing context...")
      await this.veridaContext.close();
    }
    return;
  }

  
  public async main() {
    const program = new Command();
    program
      .description("Send messages to Verida DIDs")
      .option("-s --send", "Send a message")
      .option("-l --listdids", "List all DIDs")
      .addOption(new Option("-df --didfile <filename>", "File of DIDs to send to formatted one-per-line").preset("didfile.txt"))
      .addOption(new Option("-mf --messagefile <filename>", "JSON file with the message to send. Format defined by the Verida Inbox Message Schema"))
      .parse(process.argv);
    
    const options = program.opts();
    
    console.log(options);
  
    if (options['send']) {
      await this.sendMessage(options['didfile'], options['messagefile'])
    } else if (options['listdids']) {
      await this.listdids()
    }

    return
  }

}

const app = new DIDMessagingApp();
app.main();
