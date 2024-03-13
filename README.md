# Futarchy Monorepo

![License BSLv1.1](https://img.shields.io/badge/License-BSLv1.1-lightgray.svg)

Monorepo that houses programs helpful for futarchy. A description of these programs
and what they do can be found at [docs.themetadao.org](https://docs.themetadao.org).

## Scripts

The scripts folder contains a few scripts that you can use to interact with the Meta-DAO.
Today, the only way to create proposals is via script. You can do this by modifying the 
`initializeProposal.ts` script and replacing its `pubkey`, `accounts`, and `data` with the
SVM instruction that you want to use in your proposal.

Then, run `anchor run propose --provider.cluster CLUSTER`, where `CLUSTER` is replaced with
either devnet, mainnet, or (recommended) an RPC URL.

## Deployments

| program           | tag | program ID                                  |
| ----------------- | --- | ------------------------------------------- |
| autocrat_v0       | v0.1| 32j1FNhGvJhv6wzYiJ7yA1x253Xi61wmVx56dxLqwuTR |
| autocrat_migrator | v0.1| 8bLjG4FFymvZYPNA7ALaNhEwoh7LEbJG3h2oPp1FwAYi |
| autocrat_v0       | v0  | meta3cxKzFBmWYgCVozmvCQAS3y9b3fGxrG9HkHL7Wi |
| conditional_vault | v0  | 54wZyuZLTSbbEacEMGtVVkdmyyjYjXybV3MrC1kQ4Uw7 |

All programs are immutable and verifiable, and have been verified with the OtterSec API.

The META token mint is EyiHKVZPNMyzDf1cjVwBBpnaiQKRR9nMnsCuXF7Fyqbe.

## Run Instructions

The run instructions are located in the [Run Instructions](RUN_INSTRUCTIONS.md) document.
