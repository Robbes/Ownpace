// MEASUREMENT ONLY, on a branch that is never merged.
//
// What a TLS hello with no server name meets, as a browser sends one to an
// address:
//   front: on each port EXPOSURE_PROBE_FRONT_PORTS lists, on every IPv4 address
//          the production names resolve to. The front is NetBird's shared proxy,
//          and the ports it holds by itself are not this repository's, so only
//          booleans are printed: never an address, a name, or anything of a
//          certificate but whether its issuer is Caddy's own local CA and
//          whether it names an address in 100.64.0.0/10.
//   local: the dashboard's TLS front as this repository runs it, on loopback,
//          with a made-up address or name; its issuer and names are printed.

import { promises as dns } from 'node:dns';
import { connect } from 'node:tls';

const CADDY = 'Caddy Local Authority';

function hello(host, port, ms = 10000) {
  return new Promise((done) => {
    let tcp = false;
    let settled = false;
    const socket = connect({ host, port, rejectUnauthorized: false });
    const finish = (answer) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      done(answer);
    };
    socket.setTimeout(ms, () => finish({ state: tcp ? 'no handshake (timeout)' : 'no connection (timeout)' }));
    socket.once('connect', () => {
      tcp = true;
    });
    socket.once('secureConnect', () => {
      const cert = socket.getPeerCertificate() ?? {};
      const cn = cert.issuer?.CN;
      const issuer = Array.isArray(cn) ? cn.map(String) : cn === undefined ? [] : [String(cn)];
      finish({ state: 'tls', issuer, names: typeof cert.subjectaltname === 'string' ? cert.subjectaltname : '' });
    });
    socket.once('error', (e) =>
      finish({ state: tcp ? `no handshake (${e?.code ?? 'error'})` : `no connection (${e?.code ?? 'error'})` }),
    );
  });
}

const mesh = (names) =>
  names.split(/,\s*/).some((entry) => {
    const m = /^IP Address:100\.(\d+)\.\d+\.\d+$/.exec(entry);
    return m !== null && Number(m[1]) >= 64 && Number(m[1]) <= 127;
  });

const mode = process.argv[2];
if (mode === 'front') {
  const ports = (process.env.PORTS ?? '').split(/[\s,]+/).filter(Boolean).map(Number);
  const names = ['app.ownpace.eu', 'id.ownpace.eu', 'status.ownpace.eu'];
  const resolved = await Promise.all(names.map((n) => dns.resolve4(n).catch(() => [])));
  const addresses = [...new Set(resolved.flat())];
  for (const a of addresses) console.log(`::add-mask::${a}`);
  console.log(`front: ${addresses.length} IPv4 address(es); listed ports: ${ports.join(' ')}`);
  for (const [i, address] of addresses.entries()) {
    for (const port of ports) {
      const r = await hello(address, port);
      const where = `front ${i + 1} of ${addresses.length}, port ${port}`;
      console.log(
        r.state === 'tls'
          ? `${where}: TLS; issuer is Caddy's local CA: ${r.issuer.some((x) => x.startsWith(CADDY)) ? 'YES' : 'no'}; ` +
              `names an address in 100.64.0.0/10: ${mesh(r.names) ? 'YES' : 'no'}`
          : `${where}: ${r.state}`,
      );
    }
  }
} else if (mode === 'local') {
  const port = Number(process.argv[3]);
  let r = { state: 'not asked' };
  for (let i = 0; i < 30; i++) {
    r = await hello('127.0.0.1', port, 2000);
    if (r.state === 'tls') break;
    await new Promise((wait) => setTimeout(wait, 1000));
  }
  console.log(
    `local dashboard front: ${r.state}; issuer CN: ${JSON.stringify(r.issuer ?? [])}; ` +
      `subjectaltname: ${JSON.stringify(r.names ?? '')}; Caddy's local CA: ${(r.issuer ?? []).some((x) => x.startsWith(CADDY))}`,
  );
  if (r.state !== 'tls') process.exitCode = 1;
} else {
  console.log('usage: front-tls.mjs front | local <port>');
  process.exitCode = 2;
}
