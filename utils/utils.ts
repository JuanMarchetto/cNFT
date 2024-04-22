import { getLeafAssetId } from "@metaplex-foundation/mpl-bubblegum";
import {
  SPL_NOOP_PROGRAM_ID,
  deserializeChangeLogEventV1,
} from "@solana/spl-account-compression";
import { Connection, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import base58 from "bs58";
import dotenv from "dotenv";
dotenv.config();

export async function extractAssetId(
  connection: Connection,
  txSignature: string,
  treeAddress: PublicKey,
  programId: PublicKey
) {
  const txInfo = await connection.getTransaction(txSignature, {
    maxSupportedTransactionVersion: 0,
  });

  const isProgramId = (instruction, programId) =>
    txInfo?.transaction.message.staticAccountKeys[
      instruction.programIdIndex
    ].toBase58() === programId;

  const relevantIndex =
    txInfo!.transaction.message.compiledInstructions.findIndex((instruction) =>
      isProgramId(instruction, programId.toBase58())
    );

  if (relevantIndex < 0) {
    return;
  }

  const relevantInnerInstructions =
    txInfo!.meta?.innerInstructions?.[relevantIndex].instructions;
  const relevantInnerIxs = relevantInnerInstructions.filter((instruction) =>
    isProgramId(instruction, SPL_NOOP_PROGRAM_ID.toBase58())
  );

  let assetIndex;
  for (let i = relevantInnerIxs.length - 1; i >= 0; i--) {
    try {
      const changeLogEvent = deserializeChangeLogEventV1(
        Buffer.from(base58.decode(relevantInnerIxs[i]?.data!))
      );
      assetIndex = changeLogEvent?.index;
      if (assetIndex !== undefined) {
        break;
      }
    } catch (__) {}
  }

  const assetId = await getLeafAssetId(treeAddress, new BN(assetIndex));
  return assetId;
}
