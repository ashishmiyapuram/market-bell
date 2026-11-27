import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import worker from './worker.js';
import { openDatabase } from './local-db.js';

const port = Number(process.env.PORT ?? 8080);
const origin = 'http://127.0.0.1:' + port;
const env = {
  DB: openDatabase(process.env.LOCAL_DB ?? 'tradingapp.sqlite'),
  APP_USERNAME: process.env.APP_USERNAME ?? 'demo',
  APP_PASSWORD: process.env.APP_PASSWORD ?? 'stock-demo',
  SESSION_SECRET: randomBytes(32).toString('hex'),
  TWELVE_DATA_API_KEY: process.env.TWELVE_DATA_API_KEY,
  UPSTOX_ANALYTICS_TOKEN: process.env.UPSTOX_ANALYTICS_TOKEN
};
const server = createServer(async (incoming, outgoing) => {
  try {
    const chunks = [];
    let length = 0;
    for await (const chunk of incoming) {
      length += chunk.length;
      if (length > 8192) {
        outgoing.writeHead(413).end('Request too large.');
        return;
      }
      chunks.push(chunk);
    }
    const method = incoming.method ?? 'GET';
    const request = new Request(origin + (incoming.url ?? '/'), {
      method, headers: incoming.headers,
      body: ['GET', 'HEAD'].includes(method) ? undefined : Buffer.concat(chunks)
    });
    const response = await worker.fetch(request, env);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error(error);
    outgoing.writeHead(500).end('The local server could not complete this request.');
  }
});
server.listen(port, '127.0.0.1', () => console.log('Market Bell: ' + origin));
