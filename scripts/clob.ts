import * as anchor from '@coral-xyz/anchor';

import {
  Clob,
  IDL as ClobIDL,
} from '../target/types/clob';

const { PublicKey, Keypair, SystemProgram } = anchor.web3;
const { BN, Program } = anchor;

const CLOB_PROGRAM_ID = new PublicKey(
  "8BnUecJAvKB7zCcwqhMiVWoqKWcw5S6PDCxWWEM2oxWA"
);

const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);

const clobProgram = new Program<Clob>(ClobIDL, CLOB_PROGRAM_ID, provider);

const [globalState] = PublicKey.findProgramAddressSync(
  [anchor.utils.bytes.utf8.encode("sWWCACOTMICMIBMHAFTTWYGHMB")],
  clobProgram.programId
);

async function main() {
  console.log(await clobProgram.account.globalState.fetch(globalState));
  //console.log(clobProgram);
  //console.log(provider.wallet.publicKey);
  //await initializeGlobalState(provider.wallet.publicKey);
}

async function initializeGlobalState(admin: any) {
  await clobProgram.methods
    .initializeGlobalState(admin)
    .accounts({
      globalState,
    })
    .rpc();
}

main();
