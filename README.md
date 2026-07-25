<p align="center">
  <a href="https://ripstop.dev"><img src="https://ripstop.dev/mark.png" width="56" alt="Ripstop"></a>
</p>

<h1 align="center">Ripstop Web SDK</h1>

<p align="center">
  <a href="https://github.com/ripstop-dev/ripstop-web/actions/workflows/ci.yml"><img src="https://github.com/ripstop-dev/ripstop-web/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
</p>

<p align="center"><b>Remote config, update walls and maintenance mode for web apps. Signed at the edge, verified in the browser, 6.5 KB gzipped.</b></p>

## Installation

`@ripstop/web` is not on npm yet. Until it is, install straight from GitHub.
The package builds itself on install:

```bash
npm install github:ripstop-dev/ripstop-web
```

Once it is published this becomes the `npm install @ripstop/web` you expected.

## Quick start

```ts
import { Ripstop } from '@ripstop/web';

const ripstop = await Ripstop.init({
  apiKey: 'rs_pub_your_key',
  appVersion: __APP_VERSION__, // whatever your build injects
});

const decision = await ripstop.check();

switch (decision.type) {
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

`appVersion` is explicit here and always will be. The Swift and Flutter SDKs
read the installed version from the bundle, but a browser has no bundle and no
installed version to read. The only thing that knows which build is running is
the build itself, so it has to hand the string over. Every bundler can: Vite's
`define`, webpack's `DefinePlugin`, or an env var read at build time.

Pass a semantic version, not a commit SHA. The rules are ordered as semantic
versions, and anything that is not one is treated as no opinion, which lets the
app run rather than walling it, but also means your rules do nothing.

## What `force` means on the web

On mobile it means "this binary is stale, go to the store". On the web there is
no store: a reload gets the latest code. So `force` here almost always means a
tab that has been open since before you shipped a breaking change, and the right
response is usually `location.reload()`.

That is also why the web SDK ships no prebuilt walls. On mobile, a full-screen
update wall is the same shape in every app. On the web it is a banner, a modal,
or a route, entirely yours. You get the decision and the copy you wrote in the
panel; the markup is your business.

## Remote config

Values ride in the same signed payload as the rules, so reading one costs no
extra request and cannot be out of step with them.

```ts
const checkout = ripstop.value('checkout_enabled', true);
const limit = ripstop.value('upload_limit', 10);
```

Always pass a fallback. On a first load with no network there is no payload
yet. That is the fail-open path working as intended.

## API

| | Default | |
| --- | --- | --- |
| `apiKey` | required | Your app's public SDK key. Safe to ship |
| `appVersion` | required | The build you are running; rules evaluate against it |
| `locale` | `en` | Which wall copy to resolve; falls back to `en` per key |
| `minFetchInterval` | 6 hours | How long a payload is fresh enough to skip the network |
| `timeoutMs` | 5000 | Fetch budget. After that, cache |
| `storage` | localStorage | Swap for `MemoryStorage`, sessionStorage, your own |
| `signingKeys` | pinned | Override for self-hosted deployments and tests |
| `fetchImpl` | global | Inject your own for tests or a proxy |

## What it does when things break

| Situation | What your app does |
| --- | --- |
| Network unavailable | Uses the last **signed** payload from localStorage |
| No network, no cache | `none`, so your app runs unrestricted |
| Edge returns 5xx, or times out | Cache, then normal |
| Signature doesn't verify | Discarded. A forged payload can never wall your app |
| localStorage edited in devtools | Re-verified on read, so it grants nothing |
| Wall up, then network lost | The wall **stays**, until a fresh signed payload clears it |

The cache is re-verified every time it is read. This matters more on the web
than anywhere else: `localStorage` is two keystrokes away in devtools, so a
cache that were trusted would make every wall a polite request.

## SSR

`Ripstop.init` runs anywhere `fetch` exists. Without `localStorage` it falls
back to in-memory storage automatically, so a server render gets a decision and
simply doesn't persist a cache.

## Conformance

Every Ripstop SDK runs the same `vectors.json`: version ordering, evaluation
order, message fallback, snooze accounting, the fail-open state machine.
`npm test` runs it here. If this package and the reference implementation ever
disagree about a single comparison, CI goes red.

Full docs: **[ripstop.dev/docs/web](https://ripstop.dev/docs/web)**

## License

MIT
