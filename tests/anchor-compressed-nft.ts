import * as anchor from "@project-serum/anchor"
import { AnchorCompressedNft } from "../target/types/anchor_compressed_nft"
import { Program } from "@project-serum/anchor"
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  clusterApiUrl,
  sendAndConfirmTransaction,
} from "@solana/web3.js"
import {
  ConcurrentMerkleTreeAccount,
  SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
  SPL_NOOP_PROGRAM_ID,
  ValidDepthSizePair,
  createAllocTreeIx,
} from "@solana/spl-account-compression"
import { PROGRAM_ID as BUBBLEGUM_PROGRAM_ID } from "@metaplex-foundation/mpl-bubblegum"
import {
  Metaplex,
  keypairIdentity,
  CreateNftOutput,
} from "@metaplex-foundation/js"
import { assert } from "chai"
import { PROGRAM_ID as TOKEN_METADATA_PROGRAM_ID } from "@metaplex-foundation/mpl-token-metadata"
import { extractAssetId } from "../utils/utils"

describe("cNFT Mint", () => {
  const provider = anchor.AnchorProvider.env()
  anchor.setProvider(provider)
  const wallet = provider.wallet as anchor.Wallet
  const program = anchor.workspace
    .AnchorCompressedNft as Program<AnchorCompressedNft>
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed")

  const metaplex = Metaplex.make(connection).use(keypairIdentity(wallet.payer))
  const merkleTree = Keypair.generate()
  const [treeAuthority] = PublicKey.findProgramAddressSync(
    [merkleTree.publicKey.toBuffer()],
    BUBBLEGUM_PROGRAM_ID
  )

  const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("AUTH")],
    program.programId
  )

  const [bubblegumSigner] = PublicKey.findProgramAddressSync(
    [Buffer.from("collection_cpi", "utf8")],
    BUBBLEGUM_PROGRAM_ID
  )

  const maxDepthSizePair: ValidDepthSizePair = {
    maxDepth: 14,
    maxBufferSize: 64,
  }
  const canopyDepth = maxDepthSizePair.maxDepth - 5

  const metadata = {
    uri: "https://arweave.net/ZS1RT_QpfseshEKFlQD7mpUYNoy5yR4CGYeZGDsSrlc",
    name: "SkyTrade",
    symbol: "SKY",
  }

  let collectionNft: CreateNftOutput
  let assetId: PublicKey

  before(async () => {
    collectionNft = await metaplex.nfts().create({
      uri: metadata.uri,
      name: metadata.name,
      sellerFeeBasisPoints: 0,
      isCollection: true,
    })

    await metaplex.nfts().update({
      nftOrSft: collectionNft.nft,
      updateAuthority: wallet.payer,
      newUpdateAuthority: pda,
    })

    const allocTreeIx = await createAllocTreeIx(
      connection,
      merkleTree.publicKey,
      wallet.publicKey,
      maxDepthSizePair,
      canopyDepth
    )

    const tx = new Transaction().add(allocTreeIx)

    const txSignature = await sendAndConfirmTransaction(
      connection,
      tx,
      [wallet.payer, merkleTree],
      {
        commitment: "confirmed",
      }
    )
    console.log(`https://explorer.solana.com/tx/${txSignature}?cluster=devnet`)
  })

  it("Create Tree", async () => {
    const txSignature = await program.methods
      .anchorCreateTree(
        maxDepthSizePair.maxDepth,
        maxDepthSizePair.maxBufferSize
      )
      .accounts({
        pda: pda,
        merkleTree: merkleTree.publicKey,
        treeAuthority: treeAuthority,
        logWrapper: SPL_NOOP_PROGRAM_ID,
        bubblegumProgram: BUBBLEGUM_PROGRAM_ID,
        compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
      })
      .rpc({ commitment: "confirmed", skipPreflight: true })
    console.log(`https://explorer.solana.com/tx/${txSignature}?cluster=devnet`)

    const treeAccount = await ConcurrentMerkleTreeAccount.fromAccountAddress(
      connection,
      merkleTree.publicKey
    )

    console.log({
      MaxBufferSize: treeAccount.getMaxBufferSize(),
      MaxDepth: treeAccount.getMaxDepth(),
      Tree_Authority: treeAccount.getAuthority().toString()
    })

    assert.strictEqual(
      treeAccount.getMaxBufferSize(),
      maxDepthSizePair.maxBufferSize
    )
    assert.strictEqual(treeAccount.getMaxDepth(), maxDepthSizePair.maxDepth)
    assert.isTrue(treeAccount.getAuthority().equals(treeAuthority))
  })

  it("Mint cNFT", async () => {
    const txSignature = await program.methods
      .mintCompressedNft()
      .accounts({
        pda: pda,
        merkleTree: merkleTree.publicKey,
        treeAuthority: treeAuthority,
        logWrapper: SPL_NOOP_PROGRAM_ID,
        bubblegumSigner: bubblegumSigner,
        bubblegumProgram: BUBBLEGUM_PROGRAM_ID,
        compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
        tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,

        collectionMint: collectionNft.mintAddress,
        collectionMetadata: collectionNft.metadataAddress,
        editionAccount: collectionNft.masterEditionAddress,
      })
      .rpc({ commitment: "confirmed", skipPreflight: true})
    console.log(`https://explorer.solana.com/tx/${txSignature}?cluster=devnet`)

    assetId = await extractAssetId(
      connection,
      txSignature,
      merkleTree.publicKey,
      program.programId
    )
  })
})
