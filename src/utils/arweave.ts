import Arweave from "arweave";
import { JWKPublicInterface } from "arweave/node/lib/wallet";
import Logger from "@utils/logger";
import { relative } from "path";
import * as fs from "fs";

const { readFile } = fs.promises;

const relativeKeyPath = process.env.KEY_PATH
  ? relative(__dirname, process.env.KEY_PATH)
  : "./arweave.json";

const log = new Logger({
  level: Logger.Levels.debug,
  name: "arweave",
});

export async function init(keyfile?: string) {
  const client = new Arweave({
    host: "arweave.dev",
    port: 443,
    protocol: "https",
    timeout: 20000,
    logging: false,
    logger: (msg: any) => {
      if (new Error().stack?.includes("smartweave")) return;
      log.debug(msg);
    },
  });

  const jwk = await getJwk(keyfile);
  const walletAddr = await client.wallets.jwkToAddress(jwk!);
  const balance = client.ar.winstonToAr(
    await client.wallets.getBalance(walletAddr)
  );

  log.info(
    "Created Arweave instance:\n\t\t" +
      `addr    = ${walletAddr}\n\t\t` +
      `balance = ${parseFloat(balance).toFixed(3)} AR`
  );

  return { client, walletAddr, jwk };
}

let cachedJwk: JWKPublicInterface | undefined;
export async function getJwk(keyfile?: string) {
  if (!cachedJwk) {
    log.info(`Loading keyfile from: ${keyfile || relativeKeyPath}`);
    const potentialJwk = JSON.parse(
      await readFile(keyfile || relativeKeyPath, { encoding: "utf8" })
    );
    cachedJwk = potentialJwk;
  }
  return cachedJwk;
}
