import { parseStellarUri, TransactionStellarUri } from "@suncewallet/stellar-uri"
import { Pool } from "pg"
import { Horizon, Transaction, Networks } from "@stellar/stellar-sdk"
import { horizonServers } from "../../src/config"
import { createSignatureRequest, SignatureRequest } from "../../src/models/signature-request"
import { saveSignature } from "../../src/models/signature"
import { saveSigner } from "../../src/models/signer"
import { saveSourceAccount } from "../../src/models/source-account"

export { Pool }

export interface SignerSeed {
  account_id: string
  created_at?: string
  signature: string | null
  signature_request: string
}

interface Seed {
  request: Omit<SignatureRequest, "expires_at" | "source_req"> & {
    expires_at?: Date | null
    source_req?: string
  }
  signatures: Array<{
    signer: string
    xdr: string
  }>
}

export function seedSignatureRequests(database: Pool, seeds: Seed[]) {
  return Promise.all(
    seeds.map(async seed => {
      let sourceAccount: Horizon.AccountResponse
      let uri: TransactionStellarUri
      let tx: Transaction

      try {
        uri = parseStellarUri(seed.request.req) as TransactionStellarUri
        tx = new Transaction(uri.xdr, uri.networkPassphrase || Networks.TESTNET)
      } catch (error) {
        throw Error(`Error parsing Stellar URI or its transaction: ${error.message}`)
      }

      try {
        const horizon =
          uri.networkPassphrase === Networks.TESTNET
            ? horizonServers.testnet
            : horizonServers.pubnet
        sourceAccount = await horizon.loadAccount(tx.source)
      } catch (error) {
        const network = uri.networkPassphrase || Networks.PUBLIC
        console.error(error)
        throw Error(`Account does not exist on the network: ${tx.source} (${network})`)
      }

      const timeBounds = tx.timeBounds || { maxTime: String(Date.now() + 60_000) }

      const expiresAt =
        seed.request.expires_at || new Date(Number.parseInt(timeBounds.maxTime, 10) * 1000)

      const signatureRequest = await createSignatureRequest(database, {
        ...seed.request,
        expires_at: expiresAt,
        source_req: seed.request.source_req || seed.request.req
      })

      await saveSourceAccount(database, {
        signature_request: signatureRequest.id,
        account_id: tx.source,
        key_weight_threshold: sourceAccount.thresholds.high_threshold
      })

      for (const signer of sourceAccount.signers) {
        await saveSigner(database, {
          signature_request: signatureRequest.id,
          source_account_id: sourceAccount.id,
          account_id: signer.key,
          key_weight: signer.weight
        })
      }

      for (const signature of seed.signatures) {
        await saveSignature(database, {
          signature_request: signatureRequest.id,
          signature: signature.xdr,
          signer_account_id: signature.signer
        })
      }
    })
  )
}
