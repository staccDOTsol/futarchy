import * as anchor from '@coral-xyz/anchor';
import {
  MPL_TOKEN_METADATA_PROGRAM_ID as UMI_MPL_TOKEN_METADATA_PROGRAM_ID,
} from '@metaplex-foundation/mpl-token-metadata';
import { toWeb3JsPublicKey } from '@metaplex-foundation/umi-web3js-adapters';
import {
  OpenBookV2Client,
  OrderType,
  PlaceOrderArgs,
  SelfTradeBehavior,
  Side,
} from '@openbook-dex/openbook-v2';
// @ts-ignore
import * as token from '@solana/spl-token-018';
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
} from '@solana/web3.js';

import { AutocratMigrator } from '../target/types/autocrat_migrator';
import { AutocratV0 } from '../target/types/autocrat_v0';
import {
  ConditionalVault,
  IDL as ConditionalVaultIDL,
} from '../target/types/conditional_vault';
import { OpenbookTwap } from '../tests/fixtures/openbook_twap';
import {
  fetchOnchainMetadataForMint,
  uploadOffchainMetadata,
} from './uploadOffchainMetadata';

const { BN, Program } = anchor;

const AutocratIDL: AutocratV0 = require("../target/idl/autocrat_v0.json");
const OpenbookTwapIDL: OpenbookTwap = require("../tests/fixtures/openbook_twap.json");
const AutocratMigratorIDL: AutocratMigrator = require("../target/idl/autocrat_migrator.json");

const AUTOCRAT_PROGRAM_ID = new PublicKey(
  "32j1FNhGvJhv6wzYiJ7yA1x253Xi61wmVx56dxLqwuTR"
);
const CONDITIONAL_VAULT_PROGRAM_ID = new PublicKey(
  "54wZyuZLTSbbEacEMGtVVkdmyyjYjXybV3MrC1kQ4Uw7"
);
const OPENBOOK_TWAP_PROGRAM_ID = new PublicKey(
  "TWAPrdhADy2aTKN5iFZtNnkQYXERD9NvKjPFVPMSCNN"
);
export const OPENBOOK_PROGRAM_ID = new PublicKey(
  "opnb2LAfJYbRMAHHvqjCwQxanZn7ReEHp1k81EohpZb"
);

export const META = new PublicKey(
  "EyiHKVZPNMyzDf1cjVwBBpnaiQKRR9nMnsCuXF7Fyqbe"
);
export const DEVNET_USDC = new PublicKey(
  "B9CZDrwg7d34MiPiWoUSmddriCtQB5eB2h9EUSDHt48b"
);
export const USDC = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
);
export const PROPH3t_PUBKEY = new PublicKey(
  "65U66fcYuNfqN12vzateJhZ4bgDuxFWN9gMwraeQKByg"
);
const autocrat_migRATOR_PROGRAM_ID = new PublicKey(
  "8bLjG4FFymvZYPNA7ALaNhEwoh7LEbJG3h2oPp1FwAYi"
);

const MPL_TOKEN_METADATA_PROGRAM_ID = toWeb3JsPublicKey(
  UMI_MPL_TOKEN_METADATA_PROGRAM_ID
);

const findMetaplexMetadataPda = async (mint: PublicKey) => {
  const [publicKey] = PublicKey.findProgramAddressSync(
    [
      anchor.utils.bytes.utf8.encode("metadata"),
      MPL_TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    MPL_TOKEN_METADATA_PROGRAM_ID
  );

  return publicKey;
};

export const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);

export const payer = provider.wallet["payer"];

export const autocratProgram = new Program<AutocratV0>(
  AutocratIDL,
  AUTOCRAT_PROGRAM_ID,
  provider
);

export const vaultProgram = new Program<ConditionalVault>(
  ConditionalVaultIDL,
  CONDITIONAL_VAULT_PROGRAM_ID,
  provider
);

export const openbook = new OpenBookV2Client(provider);
export const openbookTwap = new Program<OpenbookTwap>(
  OpenbookTwapIDL,
  OPENBOOK_TWAP_PROGRAM_ID,
  provider
);

export const migrator = new anchor.Program<AutocratMigrator>(
  AutocratMigratorIDL,
  autocrat_migRATOR_PROGRAM_ID,
  provider
);

export const [dao] = PublicKey.findProgramAddressSync(
  [anchor.utils.bytes.utf8.encode("sWWCACOTMICMIBMHAFTTWYGHMB")],
  autocratProgram.programId
);

export const [daoTreasury] = PublicKey.findProgramAddressSync(
  [dao.toBuffer()],
  autocratProgram.programId
);

async function createMint(
  mintAuthority: any,
  freezeAuthority: any,
  decimals: number,
  keypair = Keypair.generate()
): Promise<any> {
  return await token.createMint(
    provider.connection,
    payer,
    mintAuthority,
    freezeAuthority,
    decimals,
    keypair
  );
}

async function initializeVault(
  settlementAuthority: any,
  underlyingTokenMint: any,
  nonce: anchor.BN
): Promise<any> {
  const [vault] = PublicKey.findProgramAddressSync(
    [
      anchor.utils.bytes.utf8.encode("conditional_vault"),
      settlementAuthority.toBuffer(),
      underlyingTokenMint.toBuffer(),
      nonce.toBuffer("le", 8),
    ],
    vaultProgram.programId
  );

  if (
    (await vaultProgram.account.conditionalVault.fetchNullable(vault)) != null
  ) {
    return vault;
  }

  const vaultUnderlyingTokenAccount = await token.getAssociatedTokenAddress(
    underlyingTokenMint,
    vault,
    true
  );

  let conditionalOnFinalizeKP = Keypair.generate();
  let conditionalOnRevertKP = Keypair.generate();

  const { key: underlyingTokenMetadataKey, metadata: underlyingTokenMetadata } =
    await fetchOnchainMetadataForMint(underlyingTokenMint);

  console.log(
    `metadata for token = ${underlyingTokenMint.toBase58()}`,
    underlyingTokenMetadata
  );

  const conditionalOnFinalizeTokenMetadata = await findMetaplexMetadataPda(
    conditionalOnFinalizeKP.publicKey
  );
  const conditionalOnRevertTokenMetadata = await findMetaplexMetadataPda(
    conditionalOnRevertKP.publicKey
  );

  // pull off the least significant 32 bits representing the proposal count
  const proposalCount = nonce.and(new BN(1).shln(32).sub(new BN(1)));

  // create new json, take that and pipe into the instruction
  const { passTokenMetadataUri, faileTokenMetadataUri } =
    await uploadOffchainMetadata(proposalCount, underlyingTokenMetadata.symbol);

  const addMetadataToConditionalTokensIx = await vaultProgram.methods
    .addMetadataToConditionalTokens(
      proposalCount,
      passTokenMetadataUri,
      faileTokenMetadataUri
    )
    .accounts({
      payer: payer.publicKey,
      vault,
      underlyingTokenMint,
      underlyingTokenMetadata: underlyingTokenMetadataKey,
      conditionalOnFinalizeTokenMint: conditionalOnFinalizeKP.publicKey,
      conditionalOnRevertTokenMint: conditionalOnRevertKP.publicKey,
      conditionalOnFinalizeTokenMetadata,
      conditionalOnRevertTokenMetadata,
      tokenMetadataProgram: MPL_TOKEN_METADATA_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .instruction();

  await vaultProgram.methods
    .initializeConditionalVault(settlementAuthority, nonce)
    .accounts({
      vault,
      underlyingTokenMint,
      vaultUnderlyingTokenAccount,
      conditionalOnFinalizeTokenMint: conditionalOnFinalizeKP.publicKey,
      conditionalOnRevertTokenMint: conditionalOnRevertKP.publicKey,
      payer: payer.publicKey,
      tokenProgram: token.TOKEN_PROGRAM_ID,
      associatedTokenProgram: token.ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([conditionalOnFinalizeKP, conditionalOnRevertKP])
    .postInstructions([addMetadataToConditionalTokensIx])
    .rpc();

  //const storedVault = await vaultProgram.account.conditionalVault.fetch(
  //  vault
  //);
  //console.log(storedVault);

  return vault;
}

export async function initializeDAO(META: any, USDC: any) {
  await autocratProgram.methods
    .initializeDao()
    .accounts({
      dao,
      metaMint: META,
      usdcMint: USDC,
    })
    .rpc();
}

export async function fetchDao() {
  return autocratProgram.account.dao.fetch(dao);
}

// async function finalizeProposal(proposal: PublicKey) {
//   const storedProposal = await autocratProgram.account.proposal.fetch(proposal);
//   console.log(storedProposal)
//   const treasuryMetaAccount = await token.getOrCreateAssociatedTokenAccount(
//     provider.connection,
//     payer,
//     META,
//     daoTreasury,
//     true
//   );

//   const treasuryUsdcAccount = await token.getOrCreateAssociatedTokenAccount(
//     provider.connection,
//     payer,
//     USDC,
//     daoTreasury,
//     true
//   );

//   const newTreasuryMetaAccount = await token.getOrCreateAssociatedTokenAccount(
//     provider.connection,
//     payer,
//     META,
//     newDaoTreasury,
//     true
//   );

//   const newTreasuryUsdcAccount = await token.getOrCreateAssociatedTokenAccount(
//     provider.connection,
//     payer,
//     USDC,
//     newDaoTreasury,
//     true
//   );

//   const ix = await migrator.methods
//         .multiTransfer2()
//         .accounts({
//           authority: daoTreasury,
//           from0: treasuryMetaAccount.address,
//           to0: newTreasuryMetaAccount.address,
//           from1: treasuryUsdcAccount.address,
//           to1: newTreasuryUsdcAccount.address,
//           lamportReceiver: newDaoTreasury,
//         })
//         .instruction();

//   const instruction = {
//     programId: ix.programId,
//     accounts: ix.keys,
//     data: ix.data,
//   };

//   let tx = await autocratProgram.methods
//         .finalizeProposal()
//         .accounts({
//           proposal,
//           openbookTwapPassMarket: storedProposal.openbookTwapPassMarket,
//           openbookTwapFailMarket: storedProposal.openbookTwapFailMarket,
//           dao,
//           baseVault: storedProposal.baseVault,
//           quoteVault: storedProposal.quoteVault,
//           vaultProgram: vaultProgram.programId,
//           daoTreasury,
//         })
//         .remainingAccounts(
//           instruction.accounts
//             .concat({
//               pubkey: instruction.programId,
//               isWritable: false,
//               isSigner: false,
//             })
//             .map((meta) =>
//               meta.pubkey.equals(daoTreasury)
//                 ? { ...meta, isSigner: false }
//                 : meta
//             )
//         )
//         .rpc();

//     console.log("Proposal finalized", tx);
// }

export async function initializeProposal(
  instruction: any,
  proposalURL: string
) {
  const proposalKeypair = Keypair.generate();

  const storedDAO = await autocratProgram.account.dao.fetch(dao);
  console.log(storedDAO);

  // least signficant 32 bits of nonce are proposal number
  // most significant bit of nonce is 0 for base and 1 for quote

  let baseNonce = new BN(storedDAO.proposalCount);

  const baseVault = await initializeVault(daoTreasury, META, baseNonce);

  const quoteVault = await initializeVault(
    daoTreasury,
    USDC,
    baseNonce.or(new BN(1).shln(63))
  );

  const passBaseMint = (
    await vaultProgram.account.conditionalVault.fetch(baseVault)
  ).conditionalOnFinalizeTokenMint;
  const passQuoteMint = (
    await vaultProgram.account.conditionalVault.fetch(quoteVault)
  ).conditionalOnFinalizeTokenMint;

  const failBaseMint = (
    await vaultProgram.account.conditionalVault.fetch(baseVault)
  ).conditionalOnRevertTokenMint;
  const failQuoteMint = (
    await vaultProgram.account.conditionalVault.fetch(quoteVault)
  ).conditionalOnRevertTokenMint;

  let openbookPassMarketKP = Keypair.generate();
  // let openbookPassMarket = new PublicKey("HspxPoqFhAmurNGA1FxdeaUbRcZrv8FoR2vAsyYs3EGA");

  let [openbookTwapPassMarket] = PublicKey.findProgramAddressSync(
    [
      anchor.utils.bytes.utf8.encode("twap_market"),
      openbookPassMarketKP.publicKey.toBuffer(),
    ],
    openbookTwap.programId
  );

  let [passMarketInstructions, passMarketSigners] =
    await openbook.createMarketIx(
      payer.publicKey,
      `${baseNonce}pMETA/pUSDC`,
      passQuoteMint,
      passBaseMint,
      new BN(100),
      new BN(1e9),
      new BN(0),
      new BN(0),
      new BN(0),
      null,
      null,
      openbookTwapPassMarket,
      null,
      openbookTwapPassMarket,
      { confFilter: 0.1, maxStalenessSlots: 100 },
      openbookPassMarketKP,
      daoTreasury
    );

  const cuIx = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: 100,
  });

  let tx1 = new Transaction();
  tx1.add(...passMarketInstructions);
  tx1.add(cuIx);

  let blockhash = await provider.connection.getLatestBlockhash();
  tx1.recentBlockhash = blockhash.blockhash;

  tx1.sign(payer);

  const sig1 = await provider.sendAndConfirm(tx1, passMarketSigners);
  console.log("First market created:\n", sig1);

  let openbookFailMarketKP = Keypair.generate();

  let [openbookTwapFailMarket] = PublicKey.findProgramAddressSync(
    [
      anchor.utils.bytes.utf8.encode("twap_market"),
      openbookFailMarketKP.publicKey.toBuffer(),
    ],
    openbookTwap.programId
  );

  let openbookFailMarketIx = await openbook.createMarketIx(
    payer.publicKey,
    `${baseNonce}fMETA/fUSDC`,
    failQuoteMint,
    failBaseMint,
    new BN(100),
    new BN(1e9),
    new BN(0),
    new BN(0),
    new BN(0),
    null,
    null,
    openbookTwapFailMarket,
    null,
    openbookTwapFailMarket,
    { confFilter: 0.1, maxStalenessSlots: 100 },
    openbookFailMarketKP,
    daoTreasury
  );

  let tx = new Transaction();
  tx.add(...openbookFailMarketIx[0]);
  tx.add(cuIx);

  blockhash = await provider.connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash.blockhash;

  const marketSig2 = await provider.sendAndConfirm(tx, openbookFailMarketIx[1]);
  console.log("Second market created:\n", marketSig2);

  await autocratProgram.methods
    .initializeProposal(proposalURL, instruction)
    .preInstructions([
      await autocratProgram.account.proposal.createInstruction(
        proposalKeypair,
        1000
      ),
      await openbookTwap.methods
        .createTwapMarket(new BN(10_000))
        .accounts({
          market: openbookPassMarketKP.publicKey,
          twapMarket: openbookTwapPassMarket,
        })
        .instruction(),
      await openbookTwap.methods
        .createTwapMarket(new BN(10_000))
        .accounts({
          market: openbookFailMarketKP.publicKey,
          twapMarket: openbookTwapFailMarket,
        })
        .instruction(),
    ])
    .accounts({
      proposal: proposalKeypair.publicKey,
      dao,
      daoTreasury,
      quoteVault,
      baseVault,
      openbookPassMarket: openbookPassMarketKP.publicKey,
      openbookFailMarket: openbookFailMarketKP.publicKey,
      openbookTwapPassMarket,
      openbookTwapFailMarket,
      proposer: payer.publicKey,
    })
    .signers([proposalKeypair])
    .rpc();
}

async function placeOrdersOnBothSides(twapMarket: any) {
  let market = (await openbookTwap.account.twapMarket.fetch(twapMarket)).market;

  let buyArgs: PlaceOrderArgs = {
    side: Side.Bid,
    priceLots: new BN(9_000), // 1 USDC for 1 META
    maxBaseLots: new BN(10),
    maxQuoteLotsIncludingFees: new BN(10 * 1000_000), // 10 USDC
    clientOrderId: new BN(1),
    orderType: OrderType.Limit,
    expiryTimestamp: new BN(0),
    selfTradeBehavior: SelfTradeBehavior.DecrementTake,
    limit: 255,
  };

  let sellArgs: PlaceOrderArgs = {
    side: Side.Ask,
    priceLots: new BN(12_000), // 1.2 USDC for 1 META
    maxBaseLots: new BN(10),
    maxQuoteLotsIncludingFees: new BN(10 * 12_000),
    clientOrderId: new BN(2),
    orderType: OrderType.Limit,
    expiryTimestamp: new BN(0),
    selfTradeBehavior: SelfTradeBehavior.DecrementTake,
    limit: 255,
  };

  const storedMarket = await openbook.deserializeMarketAccount(market);
  let openOrdersAccount = new PublicKey(
    "CxDQ5RSYebF6mRLDrXYn1An7bawe6S3iyaU5rZBjz4Xs"
  );
  // let openOrdersAccount = await openbook.createOpenOrders(
  //   payer,
  //   market,
  //   new BN(1),
  //   "oo"
  // );
  // console.log(openOrdersAccount);
  // let openOrdersAccount = await openbook.createOpenOrders(market, new BN(4), "oo2");

  const userBaseAccount = await token.getOrCreateAssociatedTokenAccount(
    provider.connection,
    payer,
    storedMarket.baseMint,
    payer.publicKey
  );
  const userQuoteAccount = await token.getOrCreateAssociatedTokenAccount(
    provider.connection,
    payer,
    storedMarket.quoteMint,
    payer.publicKey
  );

  await openbookTwap.methods
    .placeOrder(buyArgs)
    .accounts({
      asks: storedMarket.asks,
      bids: storedMarket.bids,
      marketVault: storedMarket.marketQuoteVault,
      eventHeap: storedMarket.eventHeap,
      market,
      openOrdersAccount,
      userTokenAccount: userQuoteAccount.address,
      twapMarket,
      openbookProgram: OPENBOOK_PROGRAM_ID,
    })
    .rpc();

  await openbookTwap.methods
    .placeOrder(sellArgs)
    .accounts({
      asks: storedMarket.asks,
      bids: storedMarket.bids,
      marketVault: storedMarket.marketBaseVault,
      eventHeap: storedMarket.eventHeap,
      market,
      openOrdersAccount,
      userTokenAccount: userBaseAccount.address,
      twapMarket,
      openbookProgram: OPENBOOK_PROGRAM_ID,
    })
    .rpc();
}

async function placeTakeOrder(twapMarket: any) {
  let market = (await openbookTwap.account.twapMarket.fetch(twapMarket)).market;
  const storedMarket = await openbook.deserializeMarketAccount(market);

  const userBaseAccount = await token.getOrCreateAssociatedTokenAccount(
    provider.connection,
    payer,
    storedMarket.baseMint,
    payer.publicKey
  );
  const userQuoteAccount = await token.getOrCreateAssociatedTokenAccount(
    provider.connection,
    payer,
    storedMarket.quoteMint,
    payer.publicKey
  );

  let buyArgs: PlaceOrderArgs = {
    side: Side.Bid,
    priceLots: new BN(13_000), // 1 USDC for 1 META
    maxBaseLots: new BN(10000),
    maxQuoteLotsIncludingFees: new BN(1 * 13_000), // 10 USDC
    clientOrderId: new BN(1),
    orderType: OrderType.Market,
    expiryTimestamp: new BN(0),
    selfTradeBehavior: SelfTradeBehavior.DecrementTake,
    limit: 255,
  };

  console.log(
    "base balance before:",
    (await token.getAccount(provider.connection, userBaseAccount.address))
      .amount
  );
  console.log(
    "quote balance before",
    (await token.getAccount(provider.connection, userQuoteAccount.address))
      .amount
  );

  let tx = await openbookTwap.methods
    .placeTakeOrder(buyArgs)
    .accounts({
      asks: storedMarket.asks,
      bids: storedMarket.bids,
      eventHeap: storedMarket.eventHeap,
      market,
      marketAuthority: storedMarket.marketAuthority,
      marketBaseVault: storedMarket.marketBaseVault,
      marketQuoteVault: storedMarket.marketQuoteVault,
      userQuoteAccount: userQuoteAccount.address,
      userBaseAccount: userBaseAccount.address,
      twapMarket,
      openbookProgram: OPENBOOK_PROGRAM_ID,
    })
    .transaction();

  tx.feePayer = payer.publicKey;

  const sim = await provider.connection.simulateTransaction(tx, undefined, [
    userBaseAccount.address,
    userQuoteAccount.address,
  ]);
  // console.log(sim.value.accounts[0])
  const data = sim.value.accounts[0].data;
  const buf = Buffer.from(data[0], data[1] as BufferEncoding);

  console.log(
    token.unpackAccount(userBaseAccount.address, {
      data: Buffer.from(
        Buffer.from(
          sim.value.accounts[0].data[0],
          sim.value.accounts[0].data[1] as BufferEncoding
        )
      ),
      executable: false,
      lamports: 0,
      owner: token.TOKEN_PROGRAM_ID,
    }).amount
  );

  console.log(
    token.unpackAccount(userQuoteAccount.address, {
      data: Buffer.from(
        Buffer.from(
          sim.value.accounts[1].data[0],
          sim.value.accounts[1].data[1] as BufferEncoding
        )
      ),
      executable: false,
      lamports: 0,
      owner: token.TOKEN_PROGRAM_ID,
    }).amount
  );
}

export async function mintConditionalTokens(amount: number, vault: PublicKey) {
  const storedVault = await vaultProgram.account.conditionalVault.fetch(vault);

  // Setting default values for optional parameters
  const userUnderlyingTokenAccount = await getOrCreateAccount(
    storedVault.underlyingTokenMint
  );
  const userConditionalOnFinalizeTokenAccount = await getOrCreateAccount(
    storedVault.conditionalOnFinalizeTokenMint
  );
  const userConditionalOnRevertTokenAccount = await getOrCreateAccount(
    storedVault.conditionalOnRevertTokenMint
  );
  const vaultUnderlyingTokenAccount = storedVault.underlyingTokenAccount;

  const bnAmount = new anchor.BN(amount);

  // Mint conditional tokens
  await vaultProgram.methods
    .mintConditionalTokens(bnAmount)
    .accounts({
      authority: payer.publicKey,
      vault,
      vaultUnderlyingTokenAccount,
      userUnderlyingTokenAccount,
      userConditionalOnFinalizeTokenAccount,
      userConditionalOnRevertTokenAccount,
      conditionalOnFinalizeTokenMint:
        storedVault.conditionalOnFinalizeTokenMint,
      conditionalOnRevertTokenMint: storedVault.conditionalOnRevertTokenMint,
    })
    .signers([payer])
    .rpc();
}

async function getOrCreateAccount(mint: PublicKey) {
  return (
    await token.getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer,
      mint,
      payer.publicKey
    )
  ).address;
}
