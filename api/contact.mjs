/**
 * The contact form's endpoint.
 *
 * Takes the form POST and delivers it as email through Zoho's SMTP. The site is
 * otherwise static, so without something server-side a contact form can only
 * ever hand the submission to a third party — which is what the Formspree
 * placeholder here used to do, and why messages went through someone else's
 * servers before reaching an inbox.
 *
 * SMTP is spoken directly rather than through nodemailer, and that is a
 * deliberate trade. Pulling nodemailer in means a `package.json` at the
 * repository root, which changes how Vercel detects this project — today it
 * sees no framework and no build, and serves the repo as static files plus
 * functions. Risking that on a live site to save a hundred lines of a protocol
 * that has not changed since 1982 is a bad bargain. Port 465 is implicit TLS,
 * so there is no STARTTLS dance to get wrong either.
 *
 * Environment (set in Vercel, never in the repository):
 *
 *   SMTP_USER   the full Zoho mailbox, e.g. contact@blokza.com
 *   SMTP_PASS   an app-specific password, not the account password
 *   CONTACT_TO  where submissions land; defaults to SMTP_USER
 *   SMTP_HOST   defaults to smtp.zoho.com
 *   SMTP_PORT   defaults to 465
 *
 * Zoho's free tier has no SMTP at all — it is web-only for new accounts — so
 * this needs Mail Lite or above. Without the variables the endpoint answers 503
 * and the form shows its fallback, rather than failing in some subtler way.
 */

import tls from 'node:tls';

const LIMITS = { name: 100, email: 254, topic: 40, msg: 2000 };

/**
 * Strip anything that could start a new header line.
 *
 * The one genuinely dangerous thing a contact form can do: a CR or LF inside a
 * value that lands in a header lets a submitter append headers of their own —
 * `\r\nBcc: everyone@example.com` turns the form into an open relay. Values are
 * folded to spaces rather than rejected, because a stray newline in a name is
 * far more likely to be a paste than an attack.
 */
function headerSafe(value) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
}

/** Enough to catch a typo; deliverability is the mail server's problem. */
function looksLikeEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

/**
 * RFC 2047 encoded-word, for header values that are not pure ASCII.
 *
 * Header fields are 7-bit ASCII; `Content-Type: charset=utf-8` covers the body
 * and nothing else. Every subject this builds contains an em dash, so *every*
 * message was putting raw UTF-8 bytes in a header — not just the ones from
 * senders called José. Tolerant servers pass it through, strict ones reject the
 * message, and the common outcome is an inbox showing "Ã©" where a name should
 * be.
 *
 * A word is capped at 75 characters including the `=?UTF-8?B?` and `?=`
 * wrappers, so the payload is chunked at 45 bytes — a multiple of 3, which
 * keeps each chunk's base64 unpadded, and split on whole characters so a word
 * never ends mid-sequence. Continuations are folded with CRLF + space, which is
 * how a long header is spread over several lines.
 */
function encodeHeaderWord(value) {
  const text = String(value ?? '');
  if (!text) return '';
  // eslint-disable-next-line no-control-regex
  if (!/[^\x00-\x7F]/.test(text)) return text;

  const chunks = [];
  let current = Buffer.alloc(0);
  for (const char of text) {
    const bytes = Buffer.from(char, 'utf8');
    if (current.length + bytes.length > 45) {
      chunks.push(current);
      current = Buffer.alloc(0);
    }
    current = Buffer.concat([current, bytes]);
  }
  if (current.length) chunks.push(current);

  return chunks.map((c) => `=?UTF-8?B?${c.toString('base64')}?=`).join('\r\n ');
}

/**
 * A display name as it may appear before an <address>.
 *
 * Non-ASCII is encoded; ASCII that contains an RFC 5322 special is quoted. The
 * special that actually bites is the comma: `Reply-To` is a list, so a sender
 * who writes "Pat O'Brien, Jr" turned one address into two, the second of them
 * malformed — and a reply then bounced or went nowhere.
 */
function displayName(value) {
  const name = String(value ?? '');
  if (!name) return '';
  // eslint-disable-next-line no-control-regex
  if (/[^\x00-\x7F]/.test(name)) return encodeHeaderWord(name);
  if (!/[()<>@,;:\\".[\]]/.test(name)) return name;
  return `"${name.replace(/([\\"])/g, '\\$1')}"`;
}

async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') {
      try {
        return JSON.parse(req.body);
      } catch {
        return Object.fromEntries(new URLSearchParams(req.body));
      }
    }
    return req.body;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return Object.fromEntries(new URLSearchParams(raw));
  }
}

/**
 * A minimal SMTP conversation over implicit TLS.
 *
 * `send` is injectable in tests, so the whole surface can be exercised without
 * opening a socket to anyone.
 */
export function createTransport(connect = (opts) => tls.connect(opts)) {
  return async function send({ host, port, user, pass, envelopeFrom, to, message, timeoutMs = 15_000 }) {
    return new Promise((resolve, reject) => {
      const socket = connect({ host, port, servername: host });
      let buffer = '';
      let step = 0;
      let settled = false;

      const finish = (error) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        error ? reject(error) : resolve();
      };

      const timer = setTimeout(
        () => finish(new Error('The mail server did not answer in time.')),
        timeoutMs,
      );

      // AUTH LOGIN sends the username and password as separate base64 lines,
      // each in reply to a 334 challenge — hence two steps rather than one.
      const script = [
        { expect: 220, send: `EHLO blokza.com` },
        { expect: 250, send: `AUTH LOGIN` },
        { expect: 334, send: Buffer.from(user).toString('base64') },
        { expect: 334, send: Buffer.from(pass).toString('base64') },
        { expect: 235, send: `MAIL FROM:<${envelopeFrom}>` },
        { expect: 250, send: `RCPT TO:<${to}>` },
        { expect: 250, send: `DATA` },
        { expect: 354, send: `${message}\r\n.` },
        { expect: 250, send: `QUIT` },
      ];

      socket.setEncoding('utf8');
      socket.on('error', (error) => {
        clearTimeout(timer);
        finish(error);
      });

      socket.on('data', (chunk) => {
        buffer += chunk;
        // A multi-line reply repeats the code with a hyphen ("250-STARTTLS")
        // and ends with a space ("250 OK"). Acting on the first line would send
        // the next command into the middle of the server's sentence.
        const lines = buffer.split('\r\n').filter(Boolean);
        const last = lines[lines.length - 1];
        if (!last || !/^\d{3} /.test(last)) return;
        buffer = '';

        const code = Number(last.slice(0, 3));
        const stage = script[step];
        if (!stage) return;

        if (code !== stage.expect) {
          clearTimeout(timer);
          finish(new Error(`SMTP ${code}: ${last.slice(4)}`));
          return;
        }

        step += 1;

        /*
         * QUIT is written with `end`, not `write`.
         *
         * Writing it and then destroying the socket races the flush: a local
         * fake server proved the command never arrived at all. `end` sends it
         * and closes politely, and the callback is the point at which the
         * conversation is genuinely over.
         */
        if (stage.send === 'QUIT') {
          clearTimeout(timer);
          settled = true;
          socket.end('QUIT\r\n', () => resolve());
          return;
        }

        socket.write(`${stage.send}\r\n`);
      });
    });
  };
}

/**
 * RFC 5322 message.
 *
 * `Reply-To` carries the sender's address rather than `From`: the message is
 * sent by our own mailbox, and claiming to be from an arbitrary submitter is
 * how a domain earns a spam reputation. Hitting reply in the inbox still goes
 * to the right person.
 */
function buildMessage({ from, to, name, email, topic, msg }) {
  const subject = headerSafe(`[BLOKZA] ${topic || 'Contact'} — ${name}`);
  const body = [
    `From:    ${name} <${email}>`,
    `Topic:   ${topic || '(none)'}`,
    '',
    // Dot-stuffing: a line that is a single dot ends the DATA section, so any
    // line starting with one has to be doubled or the message truncates there.
    String(msg).replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..'),
  ].join('\r\n');

  return [
    `From: BLOKZA <${from}>`,
    `To: <${to}>`,
    `Reply-To: ${displayName(headerSafe(name))} <${headerSafe(email)}>`,
    `Subject: ${encodeHeaderWord(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
  ].join('\r\n');
}

export function validate(fields) {
  const name = headerSafe(fields.name);
  const email = headerSafe(fields.email).toLowerCase();
  const topic = headerSafe(fields.topic);
  const msg = String(fields.msg ?? '').trim();

  // The honeypot is hidden off-screen, so a person never fills it and a bot
  // that fills every input does. Answer 200 rather than an error: telling a
  // bot it was caught only teaches it to skip the field next time.
  if (String(fields._gotcha ?? '').trim()) return { spam: true };

  if (name.length < 2 || name.length > LIMITS.name) {
    return { error: 'Give us a name between 2 and 100 characters.' };
  }
  if (!looksLikeEmail(email) || email.length > LIMITS.email) {
    return { error: 'That does not look like an email address.' };
  }
  if (topic.length > LIMITS.topic) return { error: 'Pick one of the listed topics.' };
  if (msg.length < 10 || msg.length > LIMITS.msg) {
    return { error: 'The message needs to be between 10 and 2000 characters.' };
  }
  return { fields: { name, email, topic, msg } };
}

export default async function handler(req, res, send = createTransport()) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ message: 'Send the form with POST.', code: 'METHOD_NOT_ALLOWED' });
    return;
  }

  const user = process.env.SMTP_USER || '';
  const pass = process.env.SMTP_PASS || '';
  if (!user || !pass) {
    res.status(503).json({
      message: 'The contact form is not configured on this deployment.',
      code: 'MAIL_NOT_CONFIGURED',
    });
    return;
  }

  let fields;
  try {
    fields = await readBody(req);
  } catch {
    res.status(400).json({ message: 'That submission could not be read.', code: 'BAD_BODY' });
    return;
  }

  const checked = validate(fields);
  if (checked.spam) {
    res.status(200).json({ ok: true });
    return;
  }
  if (checked.error) {
    res.status(400).json({ message: checked.error, code: 'INVALID_SUBMISSION' });
    return;
  }

  const to = process.env.CONTACT_TO || user;
  try {
    await send({
      host: process.env.SMTP_HOST || 'smtp.zoho.com',
      port: Number(process.env.SMTP_PORT || 465),
      user,
      pass,
      envelopeFrom: user,
      to,
      message: buildMessage({ from: user, to, ...checked.fields }),
    });
  } catch (error) {
    // The submitter cannot fix a mail server, so they get the fallback wording
    // and the detail goes to the log where it is useful.
    console.error('[BLOKZA] contact send failed:', error && error.message);
    res.status(502).json({
      message: 'The message could not be sent. Please email us instead.',
      code: 'MAIL_SEND_FAILED',
    });
    return;
  }

  res.status(200).json({ ok: true });
}
