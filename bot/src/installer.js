'use strict';
// Установка экстрактора на удалённый сервер по SSH. Данные входа живут только в памяти на время установки.
const crypto = require('crypto');
const { Client, utils } = require('ssh2');

const REPO_RAW = process.env.INSTALL_SCRIPT_URL || 'https://raw.githubusercontent.com/tneange1/link-extractor/main/install.sh';

function q(s) { return `'${String(s).replace(/'/g, `'\\''`)}'`; }

// Проверяет приватный ключ: null — ок, 'passphrase' — нужен пароль от ключа, иначе текст ошибки
function checkKey(key, passphrase) {
  const parsed = utils.parseKey(key, passphrase);
  if (parsed instanceof Error) {
    if (/encrypted|passphrase|bad decrypt/i.test(parsed.message)) return 'passphrase';
    return `Ключ не распознан: ${parsed.message}`;
  }
  return null;
}

function connect(cred) {
  return new Promise((resolve, reject) => {
    const c = new Client();
    let fingerprint = '';
    c.on('ready', () => resolve({ conn: c, fingerprint }));
    c.on('error', (e) => reject(new Error(/authentication/i.test(e.message) ? 'Неверный логин, пароль или ключ' : e.message)));
    c.connect({
      host: cred.host, port: cred.port || 22, username: cred.user || 'root',
      password: cred.password || undefined, privateKey: cred.key || undefined, passphrase: cred.passphrase || undefined,
      readyTimeout: 20000, keepaliveInterval: 15000, tryKeyboard: !!cred.password,
      hostVerifier: (key) => { fingerprint = `SHA256:${crypto.createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`; return true; },
    });
    c.on('keyboard-interactive', (_n, _i, _l, prompts, finish) => finish(prompts.map(() => cred.password || '')));
  });
}

function exec(conn, cmd, onData) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, { pty: false }, (err, stream) => {
      if (err) return reject(err);
      let out = '';
      const push = (d) => { const s = d.toString(); out += s; if (onData) onData(s); };
      stream.on('data', push);
      stream.stderr.on('data', push);
      stream.on('close', (code) => resolve({ code, out }));
    });
  });
}

const SUDO = 'if [ "$(id -u)" = 0 ]; then S=""; else S="sudo -n"; fi';

async function detect(conn) {
  const r = await exec(conn, `${SUDO}; curl -fsSL ${q(REPO_RAW)} -o /tmp/le-install.sh && $S bash /tmp/le-install.sh --detect`);
  const info = {};
  for (const line of r.out.split('\n')) {
    const m = line.match(/^LE_DETECT (\w+)=(.*)$/);
    if (m) info[m[1]] = m[2].trim();
  }
  if (!Object.keys(info).length) throw new Error(`Не удалось проверить сервер:\n${r.out.slice(-600)}`);
  return info;
}

async function install(conn, opts, onData) {
  const args = ['--mode', 'extractor', '--yes',
    '--panel-name', opts.name, '--auto-update', opts.autoUpdate ? '1' : '0', '--db-backup', opts.dbBackup ? '1' : '0',
    '--proxy', opts.proxy ? 'auto' : 'none'];
  if (opts.tgToken) args.push('--tg-token', opts.tgToken);
  if (opts.tgChat) args.push('--tg-chat', String(opts.tgChat));
  if (opts.rwToken) args.push('--api-token', opts.rwToken);
  if (opts.subDomain) args.push('--sub-domain', opts.subDomain);
  const cmd = `${SUDO}; curl -fsSL ${q(REPO_RAW)} -o /tmp/le-install.sh && $S bash /tmp/le-install.sh ${args.map(q).join(' ')}; rc=$?; rm -f /tmp/le-install.sh; exit $rc`;
  const r = await exec(conn, cmd, onData);
  const m = r.out.match(/^LE_RESULT url=(\S*) token=(\S*) proxy=(\S*) name=(\S*)/m);
  const e = r.out.match(/^LE_ERROR (.*)$/m);
  if (r.code !== 0 || !m) throw new Error(e ? e[1] : `Установка завершилась с кодом ${r.code}:\n${r.out.slice(-800)}`);
  return { url: m[1], token: m[2], proxy: m[3], name: m[4].replace(/_/g, ' ') };
}

module.exports = { connect, exec, detect, install, checkKey };
