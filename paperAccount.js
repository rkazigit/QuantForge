/**
 * worker/paperAccount.js — one Durable Object per anonymous session = one paper account.
 *
 * Why a Durable Object: Workers are stateless and can be killed or duplicated at any time, so an
 * in-memory Map (as in server.js) would lose accounts constantly. A Durable Object gives each
 * session a single, strongly-consistent, persistent home, and its alarm() replaces the Node
 * server's setInterval for filling resting limit orders.
 */
import { DurableObject } from 'cloudflare:workers';
import {
  newPortfolio, submitOrder, cancelOrder, matchOpenOrders, snapshot, hasOpenOrders, HttpError,
} from '../shared/paper.js';
import { createYahoo } from './yahoo.js';

const ALARM_MS = 15_000;
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

export class PaperAccount extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.yahoo = createYahoo(env);
    this.getQuote = s => this.yahoo.fetchQuote(s);
    this.pf = null;
    this.chain = Promise.resolve();           // serialises requests: awaiting a quote would otherwise let two orders interleave
  }

  async load() {
    if (!this.pf) this.pf = (await this.ctx.storage.get('pf')) || newPortfolio();
    return this.pf;
  }
  async save() {
    this.pf.lastSeen = Date.now();
    await this.ctx.storage.put('pf', this.pf);
    if (hasOpenOrders(this.pf)) { if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + ALARM_MS); }
  }

  serial(fn) {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => {});
    return run;
  }

  async fetch(request) {
    return this.serial(async () => {
      const url = new URL(request.url), path = url.pathname, method = request.method;
      try {
        const pf = await this.load();

        if (method === 'GET' && path === '/portfolio') {
          await matchOpenOrders(pf, this.getQuote);                // lazy fill as well as the alarm
          await this.save();
          return json(await snapshot(pf, this.getQuote));
        }
        if (method === 'POST' && path === '/order') {
          let body; try { body = await request.json(); } catch { throw new HttpError(400, 'Invalid JSON body'); }
          const result = await submitOrder(pf, body, this.getQuote);
          await this.save();
          return json(result);
        }
        if (method === 'DELETE' && path.startsWith('/order/')) {
          const ok = cancelOrder(pf, decodeURIComponent(path.slice('/order/'.length)));
          await this.save();
          return ok ? json({ success: true }) : json({ error: 'Open order not found' }, 404);
        }
        if (method === 'DELETE' && path === '/portfolio') {
          this.pf = newPortfolio();
          await this.ctx.storage.deleteAlarm();
          await this.save();
          return json({ success: true, message: 'Portfolio reset to $100,000' });
        }
        return json({ error: 'Not found' }, 404);
      } catch (e) {
        return json({ error: e.message || 'Internal error' }, e instanceof HttpError || e.status ? e.status : 500);
      }
    });
  }

  /** Fires while limit orders are resting: fill whatever the market has reached. */
  async alarm() {
    await this.serial(async () => {
      const pf = await this.load();
      try { await matchOpenOrders(pf, this.getQuote); } catch { /* try again next alarm */ }
      this.pf = pf;
      await this.ctx.storage.put('pf', pf);
      if (hasOpenOrders(pf)) await this.ctx.storage.setAlarm(Date.now() + ALARM_MS);
    });
  }
}
