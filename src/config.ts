import { parseEnv } from "envfefe"
import { defaultTo, isFailure, parseBoolean, parseNumber, pipe, string } from "fefe"
import { Keypair, Horizon } from "@stellar/stellar-sdk"

export type Config = ReturnType<typeof getConfig>

function getConfig() {
  const parsedConfigEnv = parseEnv({
    baseUrl: string(),
    pgdatabase: string(),
    pghost: string(),
    pgpassword: string(),
    pguser: string(),
    horizon: string(),
    horizonTestnet: string(),
    port: pipe(defaultTo(string(), "3000")).pipe(parseNumber()),
    serveStellarToml: pipe(defaultTo(string(), "false")).pipe(parseBoolean()),
    signingSecretKey: string(),
    txMaxTtl: defaultTo(string(), "30d")
  })

  if (isFailure(parsedConfigEnv)) {
    throw new Error(parsedConfigEnv.left.type)
  }

  const parsedConfig = parsedConfigEnv.right

  return {
    ...parsedConfig,
    signingKeypair: Keypair.fromSecret(parsedConfig.signingSecretKey)
  }
}

const config = getConfig()

export default config

export const horizonServers = {
  pubnet: new Horizon.Server(config.horizon),
  testnet: new Horizon.Server(config.horizonTestnet)
}
