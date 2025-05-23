import { parseStellarUri, TransactionStellarUri } from "@suncewallet/stellar-uri"
import axios, { AxiosPromise } from "axios"
import HttpError from "http-errors"
import { Networks, Transaction } from "@stellar/stellar-sdk"
import { URL } from "url"

import { database } from "../database"
import { hasSufficientSignatures } from "../lib/records"
import { getHorizon } from "../lib/stellar"
import { querySignatureRequestSignatures } from "../models/signature"
import {
  failSignatureRequest,
  querySignatureRequestByHash,
  SignatureRequestError,
  updateSignatureRequestStatus
} from "../models/signature-request"
import { queryAllSignatureRequestSourceAccounts } from "../models/source-account"
import { notifySignatureRequestUpdate } from "../notifications"
import { serializeSignatureRequestAndSigners } from "./query"
import { queryAllSignatureRequestSigners } from "../models/signer"

const dedupe = <T>(array: T[]): T[] => Array.from(new Set(array))

export async function submitTransaction(signatureRequestHash: string) {
  const signatureRequest = await querySignatureRequestByHash(database, signatureRequestHash)

  if (!signatureRequest) {
    throw HttpError(404, `Transaction not found: ${signatureRequestHash}`)
  }

  const signatures = await querySignatureRequestSignatures(database, signatureRequest.id)
  const sourceAccounts = await queryAllSignatureRequestSourceAccounts(database, signatureRequest.id)

  if (!(await hasSufficientSignatures(signatureRequest, sourceAccounts, signatures))) {
    throw HttpError(400, `Transaction is not yet sufficiently signed`)
  }

  const signers = await queryAllSignatureRequestSigners(database, signatureRequest.id)
  const signerAccountIDs = dedupe(signers.map(signer => signer.account_id))

  let submission: AxiosPromise<any>
  let submissionURL: string

  const uri = parseStellarUri(signatureRequest.source_req) as TransactionStellarUri

  const network = (uri.networkPassphrase || Networks.PUBLIC) as Networks
  const horizon = getHorizon(network)
  const transaction = new Transaction(uri.xdr, network)

  for (const signature of signatures) {
    const signer = signers.find(s => s.account_id === signature.signer_account_id)
    // only add signature if key_weight is greater 0
    if (signer && signer.key_weight > 0) {
      transaction.addSignature(signature.signer_account_id, signature.signature)
    }
  }

  if (uri.callback) {
    submissionURL = uri.callback.replace(/^url:/, "")
    submission = axios.post(
      submissionURL,
      `xdr=${encodeURIComponent(
        transaction
          .toEnvelope()
          .toXDR()
          .toString("base64")
      )}`,
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        maxContentLength: 1024 * 1024,
        timeout: 15_000,
        validateStatus: () => true
      }
    )
  } else {
    submissionURL = String(new URL("/transactions", String(horizon.serverURL)))
    submission = axios.post(
      submissionURL,
      `tx=${encodeURIComponent(
        transaction
          .toEnvelope()
          .toXDR()
          .toString("base64")
      )}`,
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        timeout: 15_000,
        validateStatus: () => true
      }
    )
  }

  try {
    const response = await submission

    if (response.status < 400) {
      await updateSignatureRequestStatus(database, signatureRequest.id, "submitted")
    } else {
      const error = Error(
        `Request to ${uri.callback || "horizon"} failed with status code ${response.status}`
      )
      await failSignatureRequest(database, signatureRequest.id, error)
    }

    // Mutate our local object, too, or the data in the response will be stale
    signatureRequest.status = "submitted"

    const serialized = await serializeSignatureRequestAndSigners(signatureRequest)
    await notifySignatureRequestUpdate(serialized, signerAccountIDs)

    return [response, submissionURL] as const
  } catch (error) {
    await failSignatureRequest(database, signatureRequest.id, error as SignatureRequestError)

    const serialized = await serializeSignatureRequestAndSigners(signatureRequest)
    await notifySignatureRequestUpdate(serialized, signerAccountIDs)

    throw error
  }
}
