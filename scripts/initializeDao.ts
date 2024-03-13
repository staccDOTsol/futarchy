import * as anchor from '@coral-xyz/anchor';

import { initializeDAO } from './main';

const { PublicKey, Keypair, SystemProgram } = anchor.web3;
const { BN, Program } = anchor;

const META = new PublicKey("EyiHKVZPNMyzDf1cjVwBBpnaiQKRR9nMnsCuXF7Fyqbe");
const USDC = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

async function main() {
    await initializeDAO(META, USDC);
}

main();
