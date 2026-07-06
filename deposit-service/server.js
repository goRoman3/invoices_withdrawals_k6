import Fastify from 'fastify';
import TronWeb from 'tronweb';

const fastify = Fastify({ logger: true });

const PORT = process.env.PORT || 8099;
const FULL_HOST = process.env.FULL_HOST || 'https://api.shasta.trongrid.io';
const TRON_PRIVATE_KEY = process.env.TRON_PRIVATE_KEY;
const TRON_PRO_API_KEY = process.env.TRON_PRO_API_KEY; 
const TOKEN_CONTRACT = process.env.TOKEN_CONTRACT;     // TRC20 contract
const TOKEN_DECIMALS = parseInt(process.env.TOKEN_DECIMALS || '6', 10);


const DRY_RUN = /^1|true|yes$/i.test(process.env.DRY_RUN || '');

if (!DRY_RUN && (!TRON_PRIVATE_KEY || !TOKEN_CONTRACT)) {
  console.error('Missing TRON_PRIVATE_KEY or TOKEN_CONTRACT in env');
  process.exit(1);
}

let tronWeb = null;
if (!DRY_RUN) {
  tronWeb = new TronWeb({
    fullHost: FULL_HOST,
    privateKey: TRON_PRIVATE_KEY,
    headers: TRON_PRO_API_KEY ? { 'TRON-PRO-API-KEY': TRON_PRO_API_KEY } : undefined,
  });
}



process.on('unhandledRejection', (err) => fastify.log.error({ err }, 'unhandledRejection'));
process.on('uncaughtException', (err) => fastify.log.error({ err }, 'uncaughtException'));

fastify.get('/health', async () => ({ ok: true }));

fastify.addHook('onRequest', async (req, _reply) => {
  if (req.method === 'POST' && req.url === '/deposit') {
    fastify.log.info({ body: req.body }, 'incoming deposit request');
  }
});

async function sendToken(toAddress, amount) {
  const isAddr = tronWeb.isAddress(toAddress);
  if (!isAddr) {
    const e = new Error('Invalid TRON address');
    e.statusCode = 400;
    throw e;
  }
  const scaled = BigInt(Math.round(Number(amount) * 10 ** TOKEN_DECIMALS)).toString();

  if (DRY_RUN) return `dryrun_${Date.now()}`;

  const contract = await tronWeb.contract().at(TOKEN_CONTRACT);
  const tx = await contract.methods.transfer(toAddress, scaled).send();
  return tx; // tx id
}

fastify.post('/deposit', async (req, reply) => {
  try {
    const { toAddress, amount } = req.body || {};
    if (!toAddress || amount === undefined || amount === null) {
      return reply.code(400).send({ error: 'toAddress and amount are required' });
    }
    const txId = await sendToken(toAddress, amount);
    return reply.code(200).send({ toAddress, amount, txId, dryRun: DRY_RUN });
  } catch (e) {
    const code = e.statusCode || 500;
    fastify.log.error({ err: e }, 'deposit failed');
    return reply.code(code).send({ error: e.message || 'internal error' });
  }
});

fastify.listen({ port: PORT, host: '0.0.0.0' })
  .then(() => fastify.log.info(`deposit-service listening on ${PORT}`))
  .catch(err => { fastify.log.error(err); process.exit(1); });
