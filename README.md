# @ripstop/web

**Force update, kill switch, maintenance mode and remote config for web apps.**
Signed at the edge, verified in the browser, 6.5 KB gzipped.

[![npm](https://img.shields.io/npm/v/@ripstop/web.svg)](https://www.npmjs.com/package/@ripstop/web)
[![CI](https://github.com/ripstop-dev/ripstop-web/actions/workflows/ci.yaml/badge.svg)](https://github.com/ripstop-dev/ripstop-web/actions/workflows/ci.yaml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Install

```bash
npm install @ripstop/web
```

## Quickstart

```ts
import { Ripstop } from '@ripstop/web';

const ripstop = await Ripstop.init({
  apiKey: 'rs_pub_your_key',
  appVersion: __APP_VERSION__, // whatever your build injects
});

const decision = await ripstop.check();

switch (decision.type) {
  case 'kill':
    // This build has been withdrawn.
    break;
  case 'maintenance':
    // You are down on purpose. decision.endsAt is display-only.
    break;
  case 'force':
    // This tab is too old to keep talking to your API.
    location.reload();
    break;
  case 'soft':
    // A nudge. ripstop.snooze() records it and re-evaluates.
    break;
  case 'none':
    // Carry on.
    break;
}
```

## What `force` means on the web

On mobile it means "this binary is stale, go to the store". On the web there is
no store: a reload gets the latest code. So `force` here almost always means a
tab that has been open since before you shipped a breaking change, and the right
response is usually `location.reload()`.

That is also why the web SDK ships no prebuilt walls. On mobile, a full-screen
update wall is the same shape in every app. On the web it is a banner, a modal,
or a route — entirely yours. You get the decision and the copy you wrote in the
panel; the markup is your business.

## Remote config

Values ride in the same signed payload as the rules, so reading one costs no
extra request and cannot be out of step with them.

```ts
const checkout = ripstop.value('checkout_enabled', true);
const limit = ripstop.value('upload_limit', 10);
```

Always pass a fallback. On a first load with no network there is no payload yet
— that is the fail-open path working as intended.

## What it does when things break

| Situation | What your app does |
| --- | --- |
| Network unavailable | Uses the last **signed** payload from localStorage |
| No network, no cache | `none` — your app runs, unrestricted |
| Edge returns 5xx, or times out | Cache, then normal |
| Signature doesn't verify | Discarded. A forged payload can never kill your app |
| localStorage edited in devtools | Re-verified on read, so it grants nothing |
| Kill switch on, then network lost | The kill **stays**, until a fresh signed payload clears it |

The cache is re-verified every time it is read. This matters more on the web
than anywhere else: `localStorage` is two keystrokes away in devtools, so a
cache that were trusted would make the kill switch a polite request.

## Options

| | Default | |
| --- | --- | --- |
| `apiKey` | — | Your app's public SDK key. Safe to ship |
| `appVersion` | — | The build you are running; rules evaluate against it |
| `locale` | `en` | Which wall copy to resolve; falls back to `en` per key |
| `minFetchInterval` | 6 hours | How long a payload is fresh enough to skip the network |
| `timeoutMs` | 5000 | Fetch budget. After that, cache |
| `storage` | localStorage | Swap for `MemoryStorage`, sessionStorage, your own |
| `signingKeys` | pinned | Override for self-hosted deployments and tests |
| `fetchImpl` | global | Inject your own for tests or a proxy |

## SSR

`Ripstop.init` runs anywhere `fetch` exists. Without `localStorage` it falls
back to in-memory storage automatically, so a server render gets a decision and
simply doesn't persist a cache.

## Conformance

Every Ripstop SDK runs the same `vectors.json` — version ordering, evaluation
order, message fallback, snooze accounting, the fail-open state machine.
`npm test` runs it here. If this package and the reference implementation ever
disagree about a single comparison, CI goes red.

Full docs: **[ripstop.dev/docs/web](https://ripstop.dev/docs/web)**

## License

MIT
