import Log from "@utils/logger";
import Arweave from "arweave";
import { JWKInterface } from "arweave/node/lib/wallet";
import { Database } from "sqlite";
import { query } from "@utils/gql";
import txQuery from "../queries/tx.gql";
import {
  TokenInstance,
  saveOrder,
  getSellOrders,
  getBuyOrders,
} from "@utils/database";
import { interactWrite } from "smartweave";

const log = new Log({
  level: Log.Levels.debug,
  name: "match",
});

async function sendConfirmation(
  client: Arweave,
  txId: string,
  received: string,
  jwk: JWKInterface
) {
  const confirmationTx = await client.createTransaction(
    {
      data: Math.random().toString().slice(-4),
    },
    jwk
  );

  confirmationTx.addTag("Exchange", "Verto");
  confirmationTx.addTag("Type", "Confirmation");
  confirmationTx.addTag("Match", txId);
  confirmationTx.addTag("Received", received);

  await client.transactions.sign(confirmationTx, jwk);
  await client.transactions.post(confirmationTx);
}

export async function match(
  client: Arweave,
  txId: string,
  jwk: JWKInterface,
  db: Database
) {
  const tx = (
    await query({
      query: txQuery,
      variables: {
        txID: txId,
      },
    })
  ).data.transaction;

  const opcode = tx.tags.find((tag: any) => tag.name === "Type")?.value!;

  let amnt =
    opcode === "Buy"
      ? parseFloat(tx.quantity.ar)
      : JSON.parse(tx.tags.find((tag: any) => tag.name === "Input")?.value!)[
          "qty"
        ];
  let received = 0;
  const tokenTag = opcode === "Buy" ? "Token" : "Contract";
  const token = tx.tags.find((tag: any) => tag.name === tokenTag)?.value!;
  const ticker = JSON.parse(
    (
      await client.transactions.getData(token, {
        decode: true,
        string: true,
      })
    ).toString()
  )["ticker"];

  let rate = tx.tags.find((tag: any) => tag.name === "Rate")?.value!;

  log.info(`Received trade.\n\t\ttxId = ${txId}\n\t\topCode = ${opcode}`);

  const tokenEntry: TokenInstance = {
    txID: txId,
    amnt,
    rate,
    addr: tx.owner.address,
    type: opcode,
    createdAt: new Date(),
    received,
  };
  await saveOrder(db, token, tokenEntry);

  if (opcode === "Buy") {
    const orders = await getSellOrders(db, token);
    for (const order of orders) {
      if (!order.rate) continue;
      const pstAmount = Math.floor(amnt * order.rate);
      if (order.amnt >= pstAmount) {
        const arTx = await client.createTransaction(
          {
            target: order.addr,
            quantity: client.ar.arToWinston(amnt.toString()),
          },
          jwk
        );
        await client.transactions.sign(arTx, jwk);
        await client.transactions.post(arTx);

        const smartweaveInput = {
          function: "transfer",
          target: tx.owner.address,
          qty: pstAmount,
        };
        const pstTx = await interactWrite(client, jwk, token, smartweaveInput);

        log.info(
          "Matched!" +
            `\n\t\tSent ${amnt} AR to ${order.addr}` +
            `\n\t\ttxId = ${arTx.id}` +
            "\n" +
            `\n\t\tSent ${pstAmount} ${ticker} to ${tx.owner.address}` +
            `\n\t\ttxId = ${pstTx}`
        );

        if (order.amnt === pstAmount) {
          /**
           * Delete an order.
           * NOTE: Table names are not subject to sql injections.
           */
          await db.run(`DELETE FROM "${token}" WHERE txID = ?`, [order.txID]);
          await sendConfirmation(
            client,
            order.txID,
            `${order.received + amnt} AR`,
            jwk
          );
        } else {
          /**
           * Update an order.
           * NOTE: Table names are not subject to sql injections
           */
          await db.run(
            `UPDATE "${token}" SET amnt = ?, received = ? WHERE txID = ?`,
            [order.amnt - pstAmount, order.received + amnt, order.txID]
          );
        }
        /**
         * Delete an order.
         * NOTE: Table names are not subject to sql injections
         */
        await db.run(`DELETE FROM "${token}" WHERE txID = ?`, [txId]);
        await sendConfirmation(
          client,
          txId,
          `${received + pstAmount} ${ticker}`,
          jwk
        );

        return;
      } else {
        const arTx = await client.createTransaction(
          {
            target: order.addr,
            quantity: client.ar.arToWinston(
              (order.amnt / order.rate).toString()
            ),
          },
          jwk
        );
        await client.transactions.sign(arTx, jwk);
        await client.transactions.post(arTx);

        const smartweaveInput = {
          function: "transfer",
          target: tx.owner.address,
          qty: Math.floor(order.amnt),
        };
        const pstTx = await interactWrite(client, jwk, token, smartweaveInput);

        log.info(
          "Matched!" +
            `\n\t\tSent ${order.amnt / order.rate} AR to ${order.addr}` +
            `\n\t\ttxId = ${arTx.id}` +
            "\n" +
            `\n\t\tSent ${Math.floor(order.amnt)} ${ticker} to ${
              tx.owner.address
            }` +
            `\n\t\ttxId = ${pstTx}`
        );
        /**
         * Update an order.
         * NOTE: Table names are not subject to sql injections
         */
        await db.run(
          `UPDATE "${token}" SET amnt = ?, received = ? WHERE txID = ?`,
          [
            amnt - order.amnt / order.rate,
            received + Math.floor(order.amnt),
            txId,
          ]
        );
        amnt -= order.amnt / order.rate;
        received += Math.floor(order.amnt);
        /**
         * Delete an order.
         * NOTE: Table names are not subject to sql injections
         */
        await db.run(`DELETE FROM "${token}" WHERE txID = ?`, [order.txID]);
        await sendConfirmation(
          client,
          order.txID,
          `${order.received + order.amnt / order.rate} AR`,
          jwk
        );
      }
    }
  } else if (opcode === "Sell") {
    const orders = await getBuyOrders(db, token);
    for (const order of orders) {
      if (order.amnt >= amnt / rate) {
        const arTx = await client.createTransaction(
          {
            target: tx.owner.address,
            quantity: client.ar.arToWinston((amnt / rate).toString()),
          },
          jwk
        );
        await client.transactions.sign(arTx, jwk);
        await client.transactions.post(arTx);

        const smartweaveInput = {
          function: "transfer",
          target: order.addr,
          qty: Math.floor(amnt),
        };
        const pstTx = await interactWrite(client, jwk, token, smartweaveInput);

        log.info(
          "Matched!" +
            `\n\t\tSent ${amnt / rate} AR to ${tx.owner.address}` +
            `\n\t\ttxId = ${arTx.id}` +
            "\n" +
            `\n\t\tSent ${Math.floor(amnt)} ${ticker} to ${order.addr}` +
            `\n\t\ttxId = ${pstTx}`
        );

        if (order.amnt === amnt / rate) {
          /**
           * Delete an order.
           * NOTE: Table names are not subject to sql injections
           */
          await db.run(`DELETE FROM "${token}" WHERE txID = ?`, [order.txID]);
          await sendConfirmation(
            client,
            order.txID,
            `${order.received + Math.floor(amnt)} ${ticker}`,
            jwk
          );
        } else {
          /**
           * Update an order.
           * NOTE: Table names are not subject to sql injections
           */
          await db.run(
            `UPDATE "${token}" SET amnt = ?, received = ? WHERE txID = ?`,
            [
              order.amnt - amnt / rate,
              order.received + Math.floor(amnt),
              order.txID,
            ]
          );
        }
        await db.run(`DELETE FROM "${token}" WHERE txID = ?`, [txId]);
        await sendConfirmation(
          client,
          txId,
          `${received + amnt / rate} AR`,
          jwk
        );

        return;
      } else {
        const arTx = await client.createTransaction(
          {
            target: tx.owner.address,
            quantity: client.ar.arToWinston(order.amnt.toString()),
          },
          jwk
        );
        await client.transactions.sign(arTx, jwk);
        await client.transactions.post(arTx);

        const smartweaveInput = {
          function: "transfer",
          target: order.addr,
          qty: Math.floor(order.amnt * rate),
        };
        const pstTx = await interactWrite(client, jwk, token, smartweaveInput);

        log.info(
          "Matched!" +
            `\n\t\tSent ${order.amnt} AR to ${tx.owner.address}` +
            `\n\t\ttxId = ${arTx.id}` +
            "\n" +
            `\n\t\tSent ${Math.floor(order.amnt * rate)} ${ticker} to ${
              order.addr
            }` +
            `\n\t\ttxId = ${pstTx}`
        );
        /**
         * Update an order.
         * NOTE: Table names are not subject to sql injections
         */
        await db.run(
          `UPDATE "${token}" SET amnt = ?, received = ? WHERE txID = ?`,
          [amnt - Math.floor(order.amnt * rate), received + order.amnt, txId]
        );
        amnt -= Math.floor(order.amnt * rate);
        received += order.amnt;
        /**
         * Delete an order.
         * NOTE: Table names are not subject to sql injections
         */
        await db.run(`DELETE FROM "${token}" WHERE txID = ?`, [order.txID]);
        await sendConfirmation(
          client,
          order.txID,
          `${order.received + Math.floor(order.amnt * rate)} ${ticker}`,
          jwk
        );
      }
    }
  } else {
    log.error(`Invalid trade opCode.`);
  }
}
