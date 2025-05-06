import { Horizon, Keypair, Networks, Transaction, xdr } from "@stellar/stellar-sdk"

import { horizonServers } from "../config"
import { getAccountTransactionThreshold } from "./threshold"

const dedupe = <T>(array: T[]) => [...new Set(array)]

const getSignerKey = (signer: Horizon.HorizonApi.AccountSigner): string => signer.key

export function getHorizon(networkPassphrase: Networks): Horizon.Server {
  switch (networkPassphrase) {
    case Networks.PUBLIC:
      return horizonServers.pubnet
    case Networks.TESTNET:
      return horizonServers.testnet
    default:
      throw new Error(`Unknown network passphrase: ${networkPassphrase}`)
  }
}

export function getAllSources(tx: Transaction) {
  return dedupe([
    tx.source,
    ...(tx.operations
      .map(operation => operation.source)
      .filter(source => Boolean(source)) as string[])
  ])
}

export function getAllSigners(accounts: Horizon.AccountResponse[]) {
  return accounts.reduce(
    (signers, sourceAccount) =>
      dedupe([
        ...signers,
        ...sourceAccount.signers
          .filter(signer => signer.weight > 0)
          .map(signer => getSignerKey(signer))
      ]),
    [] as string[]
  )
}

export function signatureMatchesPublicKey(
  signature: xdr.DecoratedSignature,
  publicKey: string
): boolean {
  const hint = signature.hint()
  const keypair = Keypair.fromPublicKey(publicKey)

  return hint.equals(keypair.signatureHint() as Buffer)
}

export function signatureIsSufficient(
  sourceAccounts: Horizon.AccountResponse[],
  transaction: Transaction,
  signaturePubKey: string
) {
  const results = sourceAccounts.map(sourceAccount => {
    const accountThreshold = getAccountTransactionThreshold(sourceAccount, transaction)
    const signer = sourceAccount.signers.find(signer => signer.key === signaturePubKey)

    if (!signer) {
      throw Error(`Invariant violation: No signer record for ${signaturePubKey}`)
    }
    return signer.weight >= accountThreshold
  })
  return results.every(result => result === true)
}

function containsSignature(haystack: xdr.DecoratedSignature[], needle: xdr.DecoratedSignature) {
  const bufferHaystack = haystack.map(signature => signature.toXDR())
  const bufferNeedle = needle.toXDR()
  return bufferHaystack.some(buffer => buffer.equals(bufferNeedle))
}

export function collateTransactionSignatures(
  network: Networks,
  tx: Transaction,
  additionalSignatures: xdr.DecoratedSignature[]
) {
  const base64TxXdr = tx
    .toEnvelope()
    .toXDR()
    .toString("base64")

  const collatedTx = new Transaction(base64TxXdr, network)

  const prevSignatures = tx.signatures
  const newSignatures = additionalSignatures.filter(
    signature => !containsSignature(prevSignatures, signature)
  )

  for (const newSignature of newSignatures) {
    collatedTx.signatures.push(newSignature)
  }

  return collatedTx
}
