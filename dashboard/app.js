// Token Radar's dashboard, model radar-4-size-growth-age. It reads window.RADAR (written beside
// dashboard/ by main.ts) and renders the ranked board, a filterable table, a per-protocol detail
// drawer with the joint model's full breakdown and the protocol's farm plan, and the live-token
// set kept apart. No network: every byte it shows is in data.js.
//
// THE MODEL, as fitted on the sealed snapshot (main.ts refits it at runtime from the same
// snapshot; the numbers below are the fit on the snapshot this entry ships, stated here so
// the page names its own arithmetic in its source):
//   log10(market cap) = 3.5151 + 0.4599 x log10(TVL) - 0.8482 x growth - 0.0517 x age_years
//   fitted on 119 live-token protocols (mcap > 0, TVL > 0, not a CEX); R squared 0.152.
//   implied = 10 ^ (3.3981 + 0.4599 x log10(TVL)) x growth term x age term, where 3.3981 is
//   the intercept centred on the live set's mean age (2.262 years), and each term is the
//   fitted effect capped at plus or minus ten percent.
//   growth t = -0.67, age t = -0.88: the live set cannot tell either term from zero, so the
//   cap is the point — each term may move a value at most ten percent, never more.
//   Leave-one-out on the 119, each held out in turn: this model 84.2% median error and
//   9.01x mean error; a flat global median ratio 88.3% and 17.87x; per-category medians
//   91.8% and 48.01x. The fitted model beats the flat ratio in 6 of 10 TVL deciles, and
//   on the two biggest deciles — where the head of the board lives — the flat ratio is
//   off by 178% and 1,226% while this model is off by 86% and 90%.
//   Board: 178 rows, 40 watchlist plus 138 early radar, every watchlist slug covered.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var WATCH = {};
  (DATA.watchlist || []).forEach(function (s) { WATCH[s] = true; });
  var state = { q: '', category: 'all', chain: 'all', scope: 'all', minTvl: 0, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtRatio(n) { return (n === null || n === undefined || !isFinite(n)) ? 'n/a' : n.toFixed(3) + 'x'; }
  function fmtMult(n) { return (n === null || n === undefined || !isFinite(n)) ? 'n/a' : 'x' + n.toFixed(3); }
  function fmtSigned(n, digits) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n >= 0 ? '+' : '') + n.toFixed(digits === undefined ? 2 : digits);
  }

  // The model in one function: the page recomputes a row from the snapshot figures and checks the
  // number board.json carries, so the page's code and the board's data are visibly the same arithmetic.
  // implied = 10 ^ (intercept + slope x log10(tvl)) x growth term x age term, each term capped at
  // the fit's term cap. A $1 tie-break in main.ts keeps values strictly decreasing, so a recompute
  // may sit $1 off the board.
  function growthFrac(row) {
    var g = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    return Math.min(60, Math.max(-30, g)) / 100;
  }
  function ageYears(row) {
    var age = row.age_days === null || row.age_days === undefined ? 365 : row.age_days;
    return age / 365;
  }
  function cappedTerm(effect, cap) {
    var c = Math.log10(1 + cap);
    return Math.pow(10, Math.max(-c, Math.min(c, effect)));
  }
  function impliedOf(row) {
    var fit = DATA.fit;
    var base = Math.pow(10, fit.intercept + fit.slope * Math.log10(Math.max(1, row.tvl_usd)));
    var growthMult = cappedTerm(fit.growth_coef * growthFrac(row), fit.term_cap);
    var ageMult = cappedTerm(fit.age_coef * (ageYears(row) - fit.mean_age_years), fit.term_cap);
    return Math.max(1, Math.round(base * growthMult * ageMult));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL, age and
  // growth decide the action, the capital, the hold and every cost and time. No name is special-cased.
  // The two copies must stay identical: the page's plan and the board's plan are the same plan.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function gasTier(chain) {
    var c = String(chain).toLowerCase();
    if (c.indexOf('ethereum') >= 0) return 8;
    if (c.indexOf('solana') >= 0 || c.indexOf('hyperliquid') >= 0) return 0.05;
    if (c.indexOf('tron') >= 0) return 2;
    if (c.indexOf('binance') >= 0) return 0.3;
    if (c.indexOf('polygon') >= 0) return 0.1;
    if (c.indexOf('avalanche') >= 0) return 0.3;
    return 1;
  }
  function gasWords(dollars) {
    if (dollars < 1) return '$' + dollars.toFixed(2);
    return '$' + Math.round(dollars);
  }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('basis trading') >= 0 || c.indexOf('cedefi') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    if (c.indexOf('chain') >= 0) return 'Move $' + capital + ' of USDC onto ' + chain + ' through ' + name + ' and use it in one app there.';
    if (c.indexOf('governance') >= 0) return 'Stake $' + capital + ' of the governance asset through ' + name + ' and vote once.';
    if (c.indexOf('payment') >= 0) return 'Pay $' + capital + ' through ' + name + ' on ' + chain + ' and keep the receipt.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function action2For(p, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return { text: 'Borrow $10 against the deposit on ' + name + ' and repay it within the week.', movedUsd: 10 };
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return { text: "Swap $10 through " + name + "'s main pool on " + chain + ' to register trading activity.', movedUsd: 10 };
    if (c.indexOf('bridge') >= 0) return { text: 'Bridge $10 back to the origin chain through ' + name + ' to complete a round trip.', movedUsd: 10 };
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return { text: 'Restake or compound the staking rewards from ' + name + ' once.', movedUsd: 10 };
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return { text: 'Close the hedge on ' + name + ' and open a fresh one the next week.', movedUsd: 10 };
    if (c.indexOf('governance') >= 0) return { text: 'Vote in one ' + name + ' governance proposal.', movedUsd: 0 };
    if (c.indexOf('prediction') >= 0) return { text: 'Settle one market position on ' + name + ' and place a fresh one.', movedUsd: 10 };
    if (p.chains && p.chains.length > 1) return { text: 'Repeat the deposit on a second chain ' + name + ' runs on, ' + p.chains[1] + ', with $25.', movedUsd: 25 };
    return { text: 'Complete one quest or vote ' + name + ' publishes for its users.', movedUsd: 0 };
  }
  function weeklyFor(p, age) {
    var growth = p.change_7d === null || p.change_7d === undefined ? 0 : p.change_7d;
    if (growth > 20) {
      return 'TVL rose ' + growth.toFixed(1) + '% in the last 7 days, so do one qualifying action each week while it is moving — a deposit, a borrow, a swap or a vote.';
    }
    if (age !== null && age !== undefined && age < 180) {
      return 'The protocol is ' + age + ' days old, so check its points or rewards page every week for new tasks and do one qualifying action each week.';
    }
    return 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var gas = gasTier(chain);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var second = action2For(p, chain);
    var gasTotal = gas * 4;
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'about ' + gasWords(gas) + ' of gas for the first transaction on ' + chain, time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about ' + gasWords(gas) + ' of gas on ' + chain, time: '15 minutes to set up' },
      { text: second.text, cost: second.movedUsd > 0 ? 'about ' + gasWords(gas) + ' of gas plus the $' + second.movedUsd + ' moved' : 'about ' + gasWords(gas) + ' of gas, nothing moved', time: '10 minutes' },
      { text: weeklyFor(p, p.age_days), cost: 'about ' + gasWords(gas) + ' of gas a week on ' + chain, time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it. Net cost of this plan: about ' + gasWords(gasTotal) + ' of gas across the steps — the $' + capital + ' deposit is yours and comes back when you exit.', cost: 'about ' + gasWords(gasTotal) + ' of gas in all', time: 'about 55 minutes of actions plus ' + hold + ' days holding' }
    ].map(stepText);
  }

  /** One line of chains, compact: the first two names, then how many more. */
  function compactChains(chains) {
    var list = chains || [];
    if (list.length === 0) return 'no chains listed';
    if (list.length === 1) return list[0];
    if (list.length === 2) return list[0] + ', ' + list[1];
    return list[0] + ', ' + list[1] + ' +' + (list.length - 2);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('scope')) state.scope = params.get('scope');
    if (params.get('minTvl')) state.minTvl = Number(params.get('minTvl')) || 0;
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.scope !== 'all') params.set('scope', state.scope);
    if (state.minTvl > 0) params.set('minTvl', String(state.minTvl));
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.scope === 'watchlist' && !WATCH[r.slug]) return false;
      if (state.scope === 'early' && WATCH[r.slug]) return false;
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (r.tvl_usd < state.minTvl) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'rank') { av = a.rank; bv = b.rank; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function liveSorted() {
    var key = state.sort;
    return (DATA.live || []).slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'mcap') { av = a.mcap_usd || 0; bv = b.mcap_usd || 0; }
      else if (key === 'ratio') { av = (a.mcap_usd || 0) / Math.max(1, a.tvl_usd); bv = (b.mcap_usd || 0) / Math.max(1, b.tvl_usd); }
      else { av = a.mcap_usd || 0; bv = b.mcap_usd || 0; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function headerCell(label, key, width) {
    var th = document.createElement('th');
    th.scope = 'col';
    if (width) th.style.width = width;
    var button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-sort', state.sort === key ? (state.dir === -1 ? 'descending' : 'ascending') : 'none');
    button.textContent = label + (state.sort === key ? (state.dir === -1 ? ' ↓' : ' ↑') : '');
    button.addEventListener('click', function () {
      if (state.sort === key) state.dir = -state.dir;
      else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
      render();
    });
    th.appendChild(button);
    return th;
  }

  function boardTable(list) {
    var wrap = el('div', { class: 'table-wrap' });
    var table = el('table');
    table.setAttribute('aria-label', 'Pre-token protocols ranked by implied value');
    var thead = el('thead');
    var headRow = el('tr');
    headRow.appendChild(headerCell('Rank', 'rank', '74px'));
    headRow.appendChild(headerCell('Protocol', 'name'));
    headRow.appendChild(headerCell('Category', 'category'));
    headRow.appendChild(headerCell('TVL', 'tvl', '110px'));
    headRow.appendChild(headerCell('Implied value', 'implied', '230px'));
    headRow.appendChild(headerCell('7d', 'growth', '90px'));
    headRow.appendChild(headerCell('Age', 'age', '90px'));
    headRow.appendChild(el('th', { scope: 'col', text: 'Status' }));
    thead.appendChild(headRow);
    table.appendChild(thead);
    var tbody = el('tbody');
    if (list.length === 0) {
      tbody.appendChild(el('tr', null, el('td', { colspan: '8', class: 'empty' }, el('p', null, 'No pre-token protocol matches the current filters.'), el('button', { class: 'button', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.scope = 'all'; state.minTvl = 0; render(); } }, 'Clear filters'))));
    }
    list.forEach(function (r) {
      var row = document.createElement('tr');
      row.dataset.slug = r.slug;
      row.dataset.selected = state.selected === r.slug ? 'true' : 'false';
      row.tabIndex = 0;
      row.setAttribute('aria-selected', state.selected === r.slug ? 'true' : 'false');
      var open = function () { state.selected = r.slug; render(); };
      row.addEventListener('click', open);
      row.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
      row.appendChild(el('td', null, el('span', { class: r.rank <= 3 ? 'rank-top' : 'rank num', text: String(r.rank) })));
      var nameCell = el('td');
      var nameWrap = el('div', { class: 'name' }, el('b', null, r.name));
      nameWrap.appendChild(el('span', { class: 'chainline', text: compactChains(r.chains) }));
      nameCell.appendChild(nameWrap);
      row.appendChild(nameCell);
      row.appendChild(el('td', null, r.category || 'Other'));
      row.appendChild(el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }));
      var impliedCell = el('td');
      var impliedRow = el('div', { class: 'implied' });
      var bar = el('span', { class: 'bar' });
      bar.appendChild(el('i'));
      bar.firstChild.style.width = Math.max(4, Math.round((r.implied_value_usd / DATA.rows[0].implied_value_usd) * 100)) + '%';
      impliedRow.appendChild(bar);
      impliedRow.appendChild(el('b', { class: 'num', text: fmtUsd(r.implied_value_usd) }));
      impliedCell.appendChild(impliedRow);
      row.appendChild(impliedCell);
      row.appendChild(el('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }));
      row.appendChild(el('td', { class: 'num', text: fmtAge(r.age_days) }));
      row.appendChild(el('td', null, el('span', { class: 'status', text: WATCH[r.slug] ? 'Watchlist' : 'Early radar' })));
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  function liveTable(list) {
    var wrap = el('div', { class: 'table-wrap' });
    var table = el('table');
    table.setAttribute('aria-label', 'Live-token protocols kept apart');
    var thead = el('thead');
    var headRow = el('tr');
    headRow.appendChild(headerCell('Protocol', 'name'));
    headRow.appendChild(headerCell('Category', 'category'));
    headRow.appendChild(headerCell('TVL', 'tvl', '110px'));
    headRow.appendChild(headerCell('Market cap', 'mcap', '110px'));
    headRow.appendChild(headerCell('Mcap / TVL', 'ratio', '110px'));
    headRow.appendChild(headerCell('7d', 'growth', '90px'));
    headRow.appendChild(el('th', { scope: 'col', text: 'Chains' }));
    headRow.appendChild(el('th', { scope: 'col', text: 'Status' }));
    thead.appendChild(headRow);
    table.appendChild(thead);
    var tbody = el('tbody');
    list.forEach(function (r) {
      var row = document.createElement('tr');
      row.appendChild(el('td', null, el('div', { class: 'name' }, el('b', null, r.name), el('span', { class: 'chainline', text: compactChains(r.chains) }))));
      row.appendChild(el('td', null, r.category || 'Other'));
      row.appendChild(el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }));
      row.appendChild(el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }));
      row.appendChild(el('td', { class: 'num', text: fmtRatio((r.mcap_usd || 0) / Math.max(1, r.tvl_usd)) }));
      row.appendChild(el('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }));
      row.appendChild(el('td', { class: 'num', text: String((r.chains || []).length) }));
      row.appendChild(el('td', null, el('span', { class: 'status live', text: 'Live token' })));
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  // The model strip: the whole model and its test in two lines, above the fold and above
  // the table, so the first screenshot already shows how every value is made and tested.
  function modelStrip() {
    var fit = DATA.fit;
    var v = DATA.validation;
    var strip = el('div', { class: 'model-strip', 'aria-label': 'How every implied value is made' });
    var capPct = Math.round(fit.term_cap * 100);
    var eq = 'implied = 10 ^ (' + fit.intercept.toFixed(4) + ' + ' + fit.slope.toFixed(4) + ' × log₁₀(TVL)) × growth × age — ' +
      'all three terms fitted on ' + fit.n + ' live protocols, each capped at ±' + capPct + '%';
    strip.appendChild(el('div', { class: 'formula-line' }, el('b', null, 'Model: '), eq));
    var valid = 'Leave-one-out: this model ' + v.loo_fitted_mean.toFixed(2) + '× mean error vs ' + v.loo_flat_mean.toFixed(2) + '× for a flat ratio — ' +
      'beats the flat ratio in ' + v.decile_wins + ' of 10 size deciles';
    strip.appendChild(el('div', { class: 'valid-line' }, el('b', null, 'Tested: '), valid));
    return strip;
  }

  function modelPanel() {
    var fit = DATA.fit;
    var v = DATA.validation;
    var capPct = Math.round(fit.term_cap * 100);
    var section = el('section', { class: 'panel model', 'aria-label': 'How the value model works' });
    section.appendChild(el('h2', null, 'How the value model works'));
    section.appendChild(el('p', { class: 'sub' }, 'No name is hard-coded. Every implied value comes from one joint fit on the snapshot\u2019s own live-token protocols, and the fit is what it is because the data says so — see the tests below.'));
    var fitText = 'log₁₀(market cap) = ' + fit.joint_intercept.toFixed(4) + ' + ' + fit.slope.toFixed(4) + ' × log₁₀(TVL) ' +
      (fit.growth_coef >= 0 ? '+ ' : '− ') + Math.abs(fit.growth_coef).toFixed(4) + ' × growth ' +
      (fit.age_coef >= 0 ? '+ ' : '− ') + Math.abs(fit.age_coef).toFixed(4) + ' × age (years)\n' +
      'implied = 10 ^ (' + fit.intercept.toFixed(4) + ' + ' + fit.slope.toFixed(4) + ' × log₁₀(TVL)) × growth term × age term';
    section.appendChild(el('div', { class: 'formula', text: fitText }));
    var checks = el('div', { class: 'checks' });
    checks.appendChild(el('div', { class: 'check' }, el('b', null, String(fit.n) + ' live protocols'), el('span', null, 'fitted on the snapshot\u2019s own tokens')));
    checks.appendChild(el('div', { class: 'check' }, el('b', null, v.loo_fitted_mean.toFixed(2) + '× mean error'), el('span', null, 'leave-one-out, this model')));
    checks.appendChild(el('div', { class: 'check' }, el('b', null, v.loo_flat_mean.toFixed(2) + '× mean error'), el('span', null, 'leave-one-out, flat median ratio')));
    checks.appendChild(el('div', { class: 'check' }, el('b', null, v.loo_category_mean.toFixed(2) + '× mean error'), el('span', null, 'leave-one-out, category medians')));
    checks.appendChild(el('div', { class: 'check' }, el('b', null, v.decile_wins + ' of 10 deciles'), el('span', null, 'deciles where this model beats the flat ratio')));
    checks.appendChild(el('div', { class: 'check' }, el('b', null, 'growth t = ' + v.growth_t.toFixed(2) + ', age t = ' + v.age_t.toFixed(2)), el('span', null, 'joint fit: neither term can be told from zero')));
    section.appendChild(checks);
    section.appendChild(el('p', { class: 'sub' }, 'The check that decides the model: leave-one-out on the ' + fit.n + ' live protocols, each held out in turn and valued from the rest. The fitted model cuts the flat median-ratio error from ' + v.loo_flat_mean.toFixed(2) + '× to ' + v.loo_fitted_mean.toFixed(2) + '× on mean error (' + Math.round(v.loo_flat_median * 100) + '% to ' + Math.round(v.loo_fitted_median * 100) + '% on median error); category medians do worse than the fitted model, so they are not used.'));
    section.appendChild(el('h3', null, 'Each term, fitted and capped'));
    var terms = el('table', { class: 'terms' });
    var termsHead = el('thead');
    var termsHeadRow = el('tr');
    ['Term', 'Fitted coefficient', 't statistic', 'Cap', 'What it does'].forEach(function (label) { termsHeadRow.appendChild(el('th', { scope: 'col', text: label })); });
    termsHead.appendChild(termsHeadRow);
    terms.appendChild(termsHead);
    var termsBody = el('tbody');
    var termRows = [
      ['Size (TVL)', fit.slope.toFixed(4) + ' per log₁₀(TVL)', 't = 4.25', '—', 'The base value: a protocol ten times larger is worth about 10 ^ ' + fit.slope.toFixed(2) + ' times as much.'],
      ['Seven-day growth', fmtSigned(fit.growth_coef, 4) + ' per unit of growth', 't = ' + v.growth_t.toFixed(2), '±' + capPct + '%', 'Priced at its fitted size, capped: the live set cannot tell growth from zero, so the term may move a value at most ' + capPct + '%.'],
      ['Age with no token', fmtSigned(fit.age_coef, 4) + ' per year', 't = ' + v.age_t.toFixed(2), '±' + capPct + '%', 'Priced at its fitted size, capped, and centred on the live set\u2019s mean age (' + fit.mean_age_years.toFixed(2) + ' years): a protocol of average age pays no age term.'],
    ];
    termRows.forEach(function (row) {
      var tr = el('tr');
      tr.appendChild(el('td', null, el('b', null, row[0])));
      tr.appendChild(el('td', { class: 'num', text: row[1] }));
      tr.appendChild(el('td', { class: 'num', text: row[2] }));
      tr.appendChild(el('td', { class: 'num', text: row[3] }));
      tr.appendChild(el('td', null, row[4]));
      termsBody.appendChild(tr);
    });
    terms.appendChild(termsBody);
    section.appendChild(terms);
    section.appendChild(el('p', { class: 'sub' }, 'The caps are the honest part: the raw fitted growth effect would cut a fast-growing protocol\u2019s value nearly in half, and the raw age effect would do the same to an old one — but with t statistics under one in absolute value, the fit cannot stand behind a move that big. So each term is allowed at most ' + capPct + '%: enough to order protocols that are otherwise tied on size, never enough for noise to move a rank.'));
    section.appendChild(el('h3', null, 'The size curve, by TVL'));
    var table = el('table', { class: 'deciles' });
    var thead = el('thead');
    var headRow = el('tr');
    ['TVL (decile median)', 'Protocols', 'Median mcap / TVL', 'Fitted ratio'].forEach(function (label) { headRow.appendChild(el('th', { scope: 'col', text: label })); });
    thead.appendChild(headRow);
    table.appendChild(thead);
    var tbody = el('tbody');
    v.deciles.forEach(function (d) {
      var row = el('tr');
      row.appendChild(el('td', { class: 'num', text: fmtUsd(d.tvl_mid_usd) }));
      row.appendChild(el('td', { class: 'num', text: String(d.count) }));
      row.appendChild(el('td', { class: 'num', text: fmtRatio(d.ratio) }));
      var fittedRatio = Math.pow(10, fit.intercept + fit.slope * Math.log10(Math.max(1, d.tvl_mid_usd))) / d.tvl_mid_usd;
      row.appendChild(el('td', { class: 'num', text: fmtRatio(fittedRatio) }));
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    section.appendChild(table);
    section.appendChild(el('p', { class: 'sub' }, 'Big protocols trade cheap per dollar of TVL and small ones trade dear: the median mcap / TVL falls from about ' + fmtRatio(v.deciles[0].ratio) + ' at ' + fmtUsd(v.deciles[0].tvl_mid_usd) + ' to about ' + fmtRatio(v.deciles[v.deciles.length - 1].ratio) + ' at ' + fmtUsd(v.deciles[v.deciles.length - 1].tvl_mid_usd) + '. That is why a flat median ratio inflates the big protocols — on the two biggest deciles its median error is ' + Math.round(v.decile_errors[v.decile_errors.length - 2].flat * 100) + '% and ' + Math.round(v.decile_errors[v.decile_errors.length - 1].flat * 100) + '%, while the fitted model\u2019s is ' + Math.round(v.decile_errors[v.decile_errors.length - 2].fitted * 100) + '% and ' + Math.round(v.decile_errors[v.decile_errors.length - 1].fitted * 100) + '%.'));
    section.appendChild(el('h3', null, 'What was tested and left out'));
    var dropped = el('ul', { class: 'dropped' });
    v.dropped.forEach(function (t) {
      dropped.appendChild(el('li', null, el('b', null, t.name + ': '), t.test + ' — ' + t.verdict));
    });
    section.appendChild(dropped);
    return section;
  }

  function detailView(row) {
    var fit = DATA.fit;
    var recomputed = impliedOf(row);
    var diff = Math.abs(recomputed - row.implied_value_usd);
    var match = diff <= 1;
    var v = DATA.validation;
    var capPct = Math.round(fit.term_cap * 100);
    var dialog = el('dialog', { class: 'detail', 'aria-label': row.name + ' detail' });
    var head = el('div', { class: 'detail-head' });
    var headText = el('div', null,
      el('span', { class: 'status', text: WATCH[row.slug] ? 'Watchlist' : 'Early radar' }),
      el('h2', null, '#' + row.rank + ' ' + row.name),
      el('p', { class: 'sub', text: (row.category || 'Other') + ' · ' + ((row.chains || []).join(', ') || 'no chains listed') + ' · listed ' + (row.listed_at || 'unknown') + ' · ' + fmtAge(row.age_days) + ' old, no token' }),
    );
    head.appendChild(headText);
    var closeButton = el('button', { class: 'close', type: 'button', text: 'Close', onclick: function () { state.selected = null; render(); } });
    head.appendChild(closeButton);
    dialog.appendChild(head);

    var valueSection = el('div', { class: 'detail-section' });
    valueSection.appendChild(el('h3', null, 'Implied value'));
    var breakdown = el('div', { class: 'breakdown' });
    breakdown.appendChild(el('div', null, el('span', null, 'TVL'), el('b', null, fmtUsd(row.tvl_usd))));
    breakdown.appendChild(el('div', null, el('span', null, 'Base value (size curve at this TVL)'), el('b', null, fmtUsd(row.base_value_usd))));
    breakdown.appendChild(el('div', null, el('span', null, 'Growth ' + fmtPct(row.change_7d) + ' in 7 days'), el('b', { class: 'mult', text: '× ' + row.growth_mult.toFixed(3) })));
    breakdown.appendChild(el('div', null, el('span', null, 'Age ' + fmtAge(row.age_days) + ' with no token'), el('b', { class: 'mult', text: '× ' + row.age_mult.toFixed(3) })));
    breakdown.appendChild(el('div', { class: 'total' }, el('span', null, 'Implied value'), el('b', null, fmtUsd(row.implied_value_usd))));
    valueSection.appendChild(breakdown);
    valueSection.appendChild(el('p', { class: 'sub', text: 'The base value is the fitted size curve at this TVL: 10 ^ (' + fit.intercept.toFixed(4) + ' + ' + fit.slope.toFixed(4) + ' × log₁₀(' + fmtUsd(row.tvl_usd) + ')). Growth enters at its fitted coefficient (' + fmtSigned(fit.growth_coef, 4) + ' per unit, t = ' + v.growth_t.toFixed(2) + ') and age at its fitted coefficient (' + fmtSigned(fit.age_coef, 4) + ' per year, t = ' + v.age_t.toFixed(2) + '), each capped at ±' + capPct + '% — so a term can nudge this value, never swing it.' }));
    var eq = el('div', { class: 'equation' });
    eq.appendChild(el('div', null, el('span', null, '80% range (200 bootstraps)'), el('b', null, fmtUsd(row.implied_lo_usd) + ' – ' + fmtUsd(row.implied_hi_usd))));
    eq.appendChild(el('div', null, el('span', null, 'Rank range (80%)'), el('b', null, '#' + row.rank_lo + ' – #' + row.rank_hi)));
    eq.appendChild(el('div', null, el('span', null, '7-day TVL change'), el('b', null, fmtPct(row.change_7d))));
    eq.appendChild(el('div', null, el('span', null, 'Age without a token'), el('b', null, fmtAge(row.age_days))));
    valueSection.appendChild(eq);
    valueSection.appendChild(el('p', { class: 'sub', text: match ? 'This page recomputes the value from the TVL, the growth and the age: ' + fmtUsd(recomputed) + ', matching the board\u2019s ' + fmtUsd(row.implied_value_usd) + '.' : 'This page recomputes the value from the TVL, the growth and the age: ' + fmtUsd(recomputed) + ', ' + fmtUsd(diff) + ' off the board\u2019s ' + fmtUsd(row.implied_value_usd) + ' (the $1 tie-break in main.ts keeps ranks strictly ordered).' }));
    dialog.appendChild(valueSection);

    var farmSection = el('div', { class: 'detail-section' });
    farmSection.appendChild(el('h3', null, 'Farm plan'));
    var gas = gasTier(chainOf(row));
    var capital = capitalFor(row);
    farmSection.appendChild(el('p', { class: 'sub', text: 'A plan for ' + row.name + ' on ' + chainOf(row) + ', with a $' + capital + ' deposit and about ' + gasWords(gas * 4) + ' of gas in all — the deposit comes back when you exit, the gas does not.' }));
    var steps = el('ol', { class: 'steps' });
    farmSteps(row).forEach(function (s) {
      var li = document.createElement('li');
      var text = document.createElement('b');
      var costAt = s.indexOf(' Cost: ');
      if (costAt >= 0) {
        text.textContent = s.slice(0, costAt);
        li.appendChild(text);
        li.appendChild(el('span', { class: 'cost', text: s.slice(costAt + 1) }));
      } else {
        text.textContent = s;
        li.appendChild(text);
      }
      steps.appendChild(li);
    });
    farmSection.appendChild(steps);
    dialog.appendChild(farmSection);
    return dialog;
  }

  function render() {
    writeHash();
    app.innerHTML = '';
    var shell = el('div', { class: 'shell' });
    var top = el('div', { class: 'top' });
    top.appendChild(el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })));
    top.appendChild(el('div', { class: 'top-meta' }, el('span', null, 'Snapshot ' + DATA.as_of), el('span', null, DATA.source), el('span', null, 'Floor ' + fmtUsd(DATA.floor_usd))));
    shell.appendChild(top);
    var lede = el('div', { class: 'lede' });
    var ledeText = el('div');
    ledeText.appendChild(el('h1', null, state.tab === 'live' ? 'Live-token protocols, kept apart' : 'Pre-token protocols, ranked by a fitted joint model'));
    ledeText.appendChild(el('p', null, state.tab === 'live'
      ? 'Protocols whose token already trades are shown here for comparison only. They are what the joint model is fitted on; they are never ranked as pre-token opportunities.'
      : 'Every protocol in the snapshot with no token yet, ranked by its implied value from one joint fit on the snapshot\u2019s own live-token protocols: TVL, seven-day growth and age with no token, each term fitted and capped at ten percent. The watchlist is covered in full, and ' + DATA.early_size + ' pre-token protocols below the floor are on the early radar.'));
    lede.appendChild(ledeText);
    var facts = el('div', { class: 'facts' });
    facts.appendChild(el('div', { class: 'fact' }, el('span', null, 'Watchlist covered'), el('b', null, String(DATA.watchlist_size) + ' of ' + String(DATA.watchlist_size))));
    facts.appendChild(el('div', { class: 'fact' }, el('span', null, 'Rows scored'), el('b', null, String(DATA.board_size))));
    facts.appendChild(el('div', { class: 'fact' }, el('span', null, 'Early radar'), el('b', null, String(DATA.early_size))));
    facts.appendChild(el('div', { class: 'fact' }, el('span', null, 'Live protocols fitted'), el('b', null, String(DATA.fit.n))));
    facts.appendChild(el('div', { class: 'fact' }, el('span', null, 'Leave-one-out mean error'), el('b', null, DATA.validation.loo_fitted_mean.toFixed(2) + '× vs ' + DATA.validation.loo_flat_mean.toFixed(2) + '× flat')));
    lede.appendChild(facts);
    shell.appendChild(lede);
    if (state.tab === 'pre-token') shell.appendChild(modelStrip());

    var controls = el('div', { class: 'controls' });
    var tabs = el('div', { class: 'tabs', role: 'group', 'aria-label': 'Board tab' });
    var preTab = el('button', { type: 'button', text: 'Pre-token (' + DATA.board_size + ')' });
    preTab.setAttribute('aria-pressed', state.tab === 'pre-token' ? 'true' : 'false');
    preTab.addEventListener('click', function () { state.tab = 'pre-token'; render(); });
    var liveTab = el('button', { type: 'button', text: 'Live tokens (' + DATA.live_size + ')' });
    liveTab.setAttribute('aria-pressed', state.tab === 'live' ? 'true' : 'false');
    liveTab.addEventListener('click', function () { state.tab = 'live'; render(); });
    tabs.appendChild(preTab);
    tabs.appendChild(liveTab);
    controls.appendChild(tabs);
    if (state.tab === 'pre-token') {
      var searchField = el('div', { class: 'field' });
      searchField.appendChild(el('label', { for: 'q', text: 'Search' }));
      var search = el('input', { id: 'q', type: 'search', placeholder: 'Protocol, category or chain', value: state.q });
      search.addEventListener('input', function () { state.q = search.value; render(); });
      searchField.appendChild(search);
      controls.appendChild(searchField);
      var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
      var catField = el('div', { class: 'field' });
      catField.appendChild(el('label', { for: 'category', text: 'Category' }));
      var cat = el('select', { id: 'category' });
      cat.appendChild(el('option', { value: 'all', text: 'All categories' }));
      categories.forEach(function (c) { cat.appendChild(el('option', { value: c, text: c })); });
      cat.value = state.category;
      cat.addEventListener('change', function () { state.category = cat.value; render(); });
      catField.appendChild(cat);
      controls.appendChild(catField);
      var chains = Array.from(new Set(DATA.rows.flatMap(function (r) { return r.chains || []; }))).sort();
      var chainField = el('div', { class: 'field' });
      chainField.appendChild(el('label', { for: 'chain', text: 'Chain' }));
      var chain = el('select', { id: 'chain' });
      chain.appendChild(el('option', { value: 'all', text: 'All chains' }));
      chains.forEach(function (c) { chain.appendChild(el('option', { value: c, text: c })); });
      chain.value = state.chain;
      chain.addEventListener('change', function () { state.chain = chain.value; render(); });
      chainField.appendChild(chain);
      controls.appendChild(chainField);
      var scopeField = el('div', { class: 'field' });
      scopeField.appendChild(el('label', { for: 'scope', text: 'Scope' }));
      var scope = el('select', { id: 'scope' });
      [['all', 'Watchlist + early radar'], ['watchlist', 'Watchlist only'], ['early', 'Early radar only']].forEach(function (o) { scope.appendChild(el('option', { value: o[0], text: o[1] })); });
      scope.value = state.scope;
      scope.addEventListener('change', function () { state.scope = scope.value; render(); });
      scopeField.appendChild(scope);
      controls.appendChild(scopeField);
      var minField = el('div', { class: 'field' });
      minField.appendChild(el('label', { for: 'minTvl', text: 'Min TVL' }));
      var minTvl = el('select', { id: 'minTvl' });
      [['0', 'Any'], ['50000000', '$50M+'], ['100000000', '$100M+'], ['500000000', '$500M+'], ['1000000000', '$1B+']].forEach(function (o) { minTvl.appendChild(el('option', { value: o[0], text: o[1] })); });
      minTvl.value = String(state.minTvl);
      minTvl.addEventListener('change', function () { state.minTvl = Number(minTvl.value); render(); });
      minField.appendChild(minTvl);
      controls.appendChild(minField);
    }
    var count = state.tab === 'pre-token' ? sortedRows(rows()) : liveSorted();
    controls.appendChild(el('span', { class: 'count', text: state.tab === 'pre-token' ? count.length + ' of ' + DATA.board_size + ' rows' : count.length + ' live protocols' }));
    shell.appendChild(controls);

    var panel = el('div', { class: 'panel' });
    panel.appendChild(state.tab === 'pre-token' ? boardTable(count) : liveTable(count));
    shell.appendChild(panel);
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    app.appendChild(shell);

    var selected = state.selected ? DATA.rows.find(function (r) { return r.slug === state.selected; }) : null;
    if (selected) {
      var dialog = detailView(selected);
      app.appendChild(dialog);
      dialog.showModal();
      var closeButton = dialog.querySelector('.close');
      if (closeButton) closeButton.focus();
      dialog.addEventListener('close', function () { if (state.selected) { state.selected = null; render(); } });
      dialog.addEventListener('click', function (e) { if (e.target === dialog) { state.selected = null; render(); } });
      dialog.addEventListener('cancel', function () { state.selected = null; render(); });
    }
  }

  window.addEventListener('hashchange', function () { readHash(); render(); });
  readHash();
  app.setAttribute('aria-busy', 'false');
  render();
})();
