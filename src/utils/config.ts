import * as fs from "fs";
import { URL } from "url";
import Logger from "@utils/logger";

const log = new Logger({
  name: "config",
  level: Logger.Levels.debug,
});

const { readFile, writeFile } = fs.promises;

/**
 * Trading post API Server configuration
 */
export interface APIConfig {
  host: string;
  port: number;
}

/**
 * Trading post Genesis info
 */
export interface GenesisConfig {
  blockedTokens: string[];
  chain: Chain;
  tradeFee: number;
  version: string;
  publicURL: URL | string;
}

export interface Chain {
  [chain: string]: {
    addr: string;
    node?: string;
  };
}

/**
 * The Trading post configuration
 */
export interface TradingPostConfig {
  genesis: GenesisConfig;
  database: string;
  api: APIConfig;
}

/**
 * Basically a gtfo-if-not-valid utility for validating config
 * @param msg message to log while validating the verto configuration
 */
const logValidate = (msg: string) => {
  log.error(`Config validation failed: ${msg}`);
  process.exit(1);
};

/**
 * The trading post config that needs to be validated at runtime.
 * @param obj A don't-know-if-valid trading post configuration
 */
export function validateConfig(obj: TradingPostConfig) {
  obj.genesis.blockedTokens &&
    !obj.genesis.blockedTokens.every((i) => typeof i === "string") &&
    logValidate("tokens must be string and nothing else");
  obj.genesis.tradeFee &&
    typeof obj.genesis.tradeFee !== "number" &&
    logValidate("trade free must be of a valid integer");
  typeof obj.genesis.tradeFee !== "number" &&
    logValidate("database location must be a string");
  typeof obj.genesis.version !== "string" &&
    logValidate("version must be a string");
}

/**
 * Read the trading post config
 * @param loc Location of the config file
 */
export async function loadConfig(loc: string): Promise<TradingPostConfig> {
  try {
    let config: TradingPostConfig = JSON.parse(
      await readFile(loc, { encoding: "utf8" })
    );
    config = applyEnvironmentVariables(config);
    validateConfig(config);
    log.info(`Loaded config file from ${loc}`);
    return config;
  } catch (e) {
    log.error(`Failed to deserialize trading post config: ${e}`);
    process.exit(1);
  }
}

/**
 * Override config properties with their
 * corresponding environment variables, if set
 * @param config The config to apply the environment variables to
 */
function applyEnvironmentVariables(
  config: TradingPostConfig
): TradingPostConfig {
  if (config.genesis.chain?.ETH) {
    config.genesis.chain.ETH.addr =
      process.env.ETH_ADDRESS || config.genesis.chain.ETH.addr;
  }

  config.genesis.tradeFee =
    Number(process.env.TRADE_FEE) || config.genesis.tradeFee;
  config.genesis.publicURL = process.env.PUBLIC_URL || config.genesis.publicURL;

  return config;
}

/**
 * Write the trading post configuration to a json file
 * @param loc Location of the desired config file
 * @param config The trading post configuration
 */
export async function createConfig(loc: string, config: TradingPostConfig) {
  try {
    await writeFile(loc, JSON.stringify(config, null, 2), { encoding: "utf8" });
    log.info(`Created Verto configuration file at ${loc}`);
  } catch (e) {
    log.error(`Failed to write trading post config: ${e}`);
    process.exit(1);
  }
}
