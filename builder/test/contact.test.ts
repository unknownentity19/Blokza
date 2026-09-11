/**
 * The contact endpoint — `api/contact.mjs`.
 *
 * The interesting cases are the ones a form on the open internet actually
 * meets: header injection through a name field, a bot filling the honeypot, and
 * a mail server that is down. Nothing here opens a socket; the transport is
 * injected.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// @ts-expect-error — plain JS, deliberately untyped: the repository root has no
// package.json, and adding one to type two functions would change how Vercel
// detects the whole project.
import handler, { createTransport, validate } from '../../api/contact.mjs';

function fakeReq(method: string, body?: unknown) {
  const req = { method, url: '/api/contact', headers: {}, body } as Record<string, unknown>;
  (req as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] = async function* () {};
  return req;
}

function fakeRes() {
  const out = { code: 0, headers: {} as Record<string, unknown>, body: '' };
  return {
    out,
    status(code: number) { out.code = code; return this; },
    setHeader(key: string, value: unknown) { out.headers[key.toLowerCase()] = value; },
    json(payload: unknown) { out.code = out.code || 200; out.body = JSON.stringify(payload); },
    end(buf?: Uint8Array) { out.body = buf ? Buffer.from(buf).toString('utf8') : ''; },
  };
}

const GOOD = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  topic: 'Sales',
  msg: 'I would like to know more about the Team plan, please.',
};

type SendArgs = { to: string; message: string; host: string; user: string };

async function post(body: unknown, send = vi.fn(async (_opts: SendArgs) => undefined)) {
  const res = fakeRes();
  await handler(fakeReq('POST', body), res, send);
  return { ...res.out, send };
}

beforeEach(() => {
  process.env.SMTP_USER = 'hello@blokza.com';
  process.env.SMTP_PASS = 'app-specific-password';
});

afterEach(() => {
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  delete process.env.CONTACT_TO;
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_PORT;
  vi.restoreAllMocks();
});

describe('the contact endpoint', () => {
  it('sends a valid submission', async () => {
    const { code, send } = await post(GOOD);
    expect(code).toBe(200);
    expect(send).toHaveBeenCalledTimes(1);
  });

  /**
   * The one genuinely dangerous input. A CR or LF in a value that reaches a
   * header lets a submitter append headers of their own, and `Bcc:` turns the
   * form into an open relay.
   */
  it('folds an injected header out of the name', async () => {
    const { code, send } = await post({ ...GOOD, name: 'Ada\r\nBcc: everyone@example.com' });
    expect(code).toBe(200);
    const message = String(send.mock.calls[0][0].message);
    const headerBlock = message.split('\r\n\r\n')[0];
    expect(headerBlock).not.toMatch(/^bcc:/im);
    // the text survives, on one line, where it can do nothing
    expect(headerBlock).toContain('Ada Bcc: everyone@example.com');
  });

  /**
   * Stricter than the name, and deliberately so: an address is a constrained
   * format, so a newline in one is never a paste — it is someone trying. The
   * folded value fails `looksLikeEmail`, and nothing is sent at all.
   */
  it('refuses an address carrying a newline, and sends nothing', async () => {
    const { code, send } = await post({ ...GOOD, email: 'ada@example.com\nX-Injected: yes' });
    expect(code).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  /**
   * A lone dot on its own line ends the DATA section. Left unescaped, a message
   * containing one is silently truncated from that point on.
   */
  it('escapes a line that is just a dot, so the message is not cut short', async () => {
    const { send } = await post({ ...GOOD, msg: 'First line.\n.\nStill here, and this matters.' });
    const message = String(send.mock.calls[0][0].message);
    expect(message).toContain('\r\n..\r\n');
    expect(message).toContain('Still here');
  });

  /** Replying in the inbox should reach the person, not our own mailbox. */
  it('sends from our mailbox but replies to theirs', async () => {
    const { send } = await post(GOOD);
    const message = String(send.mock.calls[0][0].message);
    expect(message).toMatch(/^From: BLOKZA <hello@blokza\.com>/m);
    expect(message).toMatch(/^Reply-To: Ada Lovelace <ada@example\.com>/m);
  });

  /**
   * Header fields are 7-bit ASCII; only the body is covered by the
   * `charset=utf-8` declaration. The subject is built with an em dash, so this
   * is every message rather than an unusual one.
   */
  describe('header encoding', () => {
    const headersOf = (message: string) => message.split('\r\n\r\n')[0];
    // RFC 5322 folding: a continuation line begins with whitespace.
    const unfold = (block: string) => block.replace(/\r\n[ \t]/g, '');
    const decodeWords = (line: string) =>
      line.replace(/=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/g, (_m, b64: string) =>
        Buffer.from(b64, 'base64').toString('utf8'));

    it('never puts a raw non-ASCII byte in a header, even for an ASCII sender', async () => {
      const { send } = await post(GOOD);
      expect(headersOf(String(send.mock.calls[0][0].message))).toMatch(/^[\x00-\x7F]*$/);
    });

    it('encodes an accented name so the inbox shows it, not mojibake', async () => {
      const { send } = await post({ ...GOOD, name: 'José Ávila' });
      const headers = headersOf(String(send.mock.calls[0][0].message));
      expect(headers).toMatch(/^[\x00-\x7F]*$/);

      const subject = unfold(headers).split('\r\n').find((l) => l.startsWith('Subject:'))!;
      expect(decodeWords(subject)).toBe('Subject: [BLOKZA] Sales — José Ávila');
    });

    it('keeps every encoded-word inside the 75-character limit, folding as needed', async () => {
      const { send } = await post({ ...GOOD, name: 'Ünicode Ärger Øyvind Þorsteinn Æsop Ñuñez' });
      const message = String(send.mock.calls[0][0].message);
      const words = message.match(/=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/g) ?? [];
      expect(words.length).toBeGreaterThan(1);
      for (const word of words) expect(word.length).toBeLessThanOrEqual(75);

      const subject = unfold(headersOf(message)).split('\r\n').find((l) => l.startsWith('Subject:'))!;
      expect(decodeWords(subject)).toContain('Ünicode Ärger Øyvind Þorsteinn Æsop Ñuñez');
    });

    /**
     * `Reply-To` is an address *list*, so an unquoted comma in a display name
     * splits one address into two — the second of them malformed, and the
     * reply then goes nowhere.
     */
    it('quotes a display name containing a comma', async () => {
      const { send } = await post({ ...GOOD, name: "Pat O'Brien, Jr" });
      expect(String(send.mock.calls[0][0].message))
        .toMatch(/^Reply-To: "Pat O'Brien, Jr" <ada@example\.com>/m);
    });

    it('quotes a display name containing angle brackets, so it cannot pose as a second address', async () => {
      const { send } = await post({ ...GOOD, name: 'Bad <evil@example.com>' });
      expect(String(send.mock.calls[0][0].message))
        .toMatch(/^Reply-To: "Bad <evil@example\.com>" <ada@example\.com>/m);
    });

    it('leaves an ordinary ASCII name alone', async () => {
      const { send } = await post(GOOD);
      expect(String(send.mock.calls[0][0].message))
        .toMatch(/^Reply-To: Ada Lovelace <ada@example\.com>/m);
    });
  });

  /** Telling a bot it was caught only teaches it to skip the field. */
  it('accepts a honeypot submission silently and sends nothing', async () => {
    const { code, send } = await post({ ...GOOD, _gotcha: 'http://spam.example' });
    expect(code).toBe(200);
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects what a person can fix, and says which', async () => {
    expect((await post({ ...GOOD, email: 'not-an-email' })).code).toBe(400);
    expect((await post({ ...GOOD, msg: 'too short' })).code).toBe(400);
    expect((await post({ ...GOOD, name: 'A' })).code).toBe(400);
    expect(JSON.parse((await post({ ...GOOD, email: 'nope' })).body).message).toMatch(/email/i);
  });

  it('answers 503 rather than pretending, when no mailbox is configured', async () => {
    delete process.env.SMTP_USER;
    const { code, body } = await post(GOOD);
    expect(code).toBe(503);
    expect(body).toContain('MAIL_NOT_CONFIGURED');
  });

  it('answers 502 when the mail server refuses, without leaking why', async () => {
    const send = vi.fn(async (_opts: SendArgs): Promise<undefined> => {
      throw new Error('SMTP 535: authentication failed for hello@blokza.com');
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { code, body } = await post(GOOD, send);
    expect(code).toBe(502);
    expect(body).toContain('MAIL_SEND_FAILED');
    // the credential-shaped detail belongs in the log, not the response
    expect(body).not.toMatch(/535|authentication/i);
  });

  it('refuses anything but POST', async () => {
    const res = fakeRes();
    await handler(fakeReq('GET'), res, vi.fn());
    expect(res.out.code).toBe(405);
    expect(res.out.headers.allow).toBe('POST');
  });

  it('delivers to CONTACT_TO when it differs from the sending mailbox', async () => {
    process.env.CONTACT_TO = 'pratama@blokza.com';
    const { send } = await post(GOOD);
    expect(send.mock.calls[0][0].to).toBe('pratama@blokza.com');
  });

  describe('validate', () => {
    it('folds newlines out of values rather than rejecting a pasted name', () => {
      const out = validate({ ...GOOD, name: 'Ada\nLovelace' }) as { fields: { name: string } };
      expect(out.fields.name).toBe('Ada Lovelace');
    });

    it('lowercases the address, so the same person is one person', () => {
      const out = validate({ ...GOOD, email: 'Ada@Example.COM' }) as { fields: { email: string } };
      expect(out.fields.email).toBe('ada@example.com');
    });
  });
});

/**
 * The SMTP conversation itself, against a server that actually speaks it.
 *
 * The protocol code is the part with no safety net — a stubbed transport proves
 * the handler calls it, and nothing about whether the dialogue is correct. This
 * stands up a real socket server that answers like a mail server and asserts on
 * what arrives: the order of commands, the base64 of AUTH LOGIN, and the dot
 * that terminates DATA. `connect` is injectable, so it runs over plain TCP and
 * needs no certificate; TLS is the transport underneath, not the protocol.
 */
describe('the SMTP client', () => {
  it('completes a real conversation, in order', async () => {
    const net = await import('node:net');
    const seen: string[] = [];

    /*
     * `send` resolves once QUIT is flushed to the socket, which is a moment
     * earlier than the server reading it — asserting straight after the await
     * raced, and `seen` was missing its last line. Waiting on the server side
     * closes the gap. The timeout loses the race deliberately rather than
     * hanging: a QUIT that never arrives should fail as a missing line in the
     * diff, not as "test timed out".
     */
    let sawQuit = () => {};
    const quitReceived = Promise.race([
      new Promise<void>((r) => { sawQuit = r; }),
      new Promise<void>((r) => setTimeout(r, 2000).unref?.()),
    ]);

    const server = net.createServer((socket) => {
      socket.setEncoding('utf8');
      socket.write('220 smtp.test ESMTP ready\r\n');
      // An explicit cursor rather than inferring position from what has been
      // seen: my first attempt counted base64 lines and was off by one, which
      // made the server answer 235 one step early. The client caught it, which
      // is the behaviour under test — but a fixture should not be the thing
      // that needs debugging.
      let inData = false;
      let creds = 0;
      socket.on('data', (chunk: string) => {
        const parts = String(chunk).split('\r\n');
        // Every complete line ends with CRLF, so the split always leaves a
        // trailing empty string that is not a line. A blank line *inside* the
        // message body is real and must survive, so only the last is dropped.
        if (parts[parts.length - 1] === '') parts.pop();
        for (const line of parts) {
          if (inData) {
            seen.push(line);
            if (line === '.') { inData = false; socket.write('250 queued\r\n'); }
            continue;
          }
          if (!line) continue;
          seen.push(line);
          if (/^EHLO/.test(line)) socket.write('250-smtp.test\r\n250 AUTH LOGIN\r\n');
          else if (/^AUTH LOGIN$/.test(line)) socket.write('334 VXNlcm5hbWU6\r\n');
          else if (/^MAIL FROM/.test(line)) socket.write('250 ok\r\n');
          else if (/^RCPT TO/.test(line)) socket.write('250 ok\r\n');
          else if (/^DATA$/.test(line)) { inData = true; socket.write('354 go ahead\r\n'); }
          else if (/^QUIT$/.test(line)) { socket.end('221 bye\r\n'); sawQuit(); }
          else {
            creds += 1;
            socket.write(creds === 1 ? '334 UGFzc3dvcmQ6\r\n' : '235 authenticated\r\n');
          }
        }
      });
    });

    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as { port: number };

    const send = createTransport(() => net.connect({ host: '127.0.0.1', port }));

    await send({
      host: '127.0.0.1',
      port,
      user: 'hello@blokza.com',
      pass: 'secret',
      envelopeFrom: 'hello@blokza.com',
      to: 'inbox@blokza.com',
      message: 'Subject: hi\r\n\r\nbody',
    });
    await quitReceived;
    server.close();

    // The multi-line 250 reply must not have been acted on twice.
    expect(seen.filter((l) => /^AUTH LOGIN$/.test(l))).toHaveLength(1);
    expect(seen).toEqual([
      'EHLO blokza.com',
      'AUTH LOGIN',
      Buffer.from('hello@blokza.com').toString('base64'),
      Buffer.from('secret').toString('base64'),
      'MAIL FROM:<hello@blokza.com>',
      'RCPT TO:<inbox@blokza.com>',
      'DATA',
      'Subject: hi',
      '',
      'body',
      '.',
      'QUIT',
    ]);
  });

  /**
   * The two halves joined: a real submission, the real transport, and a server
   * on the other end.
   *
   * Everything above tests one side of the seam — the handler against a stub, or
   * the transport against a socket. A message that is built correctly and sent
   * correctly can still arrive wrong if the join is wrong, and this is the only
   * test that would notice.
   */
  it('carries a submitted form all the way onto the wire', async () => {
    const net = await import('node:net');
    let received = '';
    let sawEnd = () => {};
    const delivered = Promise.race([
      new Promise<void>((r) => { sawEnd = r; }),
      new Promise<void>((r) => setTimeout(r, 2000).unref?.()),
    ]);

    const server = net.createServer((socket) => {
      socket.setEncoding('utf8');
      socket.write('220 smtp.test ESMTP\r\n');
      let inData = false;
      let creds = 0;
      socket.on('data', (chunk: string) => {
        const parts = String(chunk).split('\r\n');
        if (parts[parts.length - 1] === '') parts.pop();
        for (const line of parts) {
          if (inData) {
            if (line === '.') { inData = false; socket.write('250 queued\r\n'); sawEnd(); }
            else received += `${line}\n`;
            continue;
          }
          if (!line) continue;
          if (/^EHLO/.test(line)) socket.write('250 AUTH LOGIN\r\n');
          else if (/^AUTH LOGIN$/.test(line)) socket.write('334 VXNlcm5hbWU6\r\n');
          else if (/^(MAIL FROM|RCPT TO)/.test(line)) socket.write('250 ok\r\n');
          else if (/^DATA$/.test(line)) { inData = true; socket.write('354 go\r\n'); }
          else if (/^QUIT$/.test(line)) socket.end('221 bye\r\n');
          else {
            creds += 1;
            socket.write(creds === 1 ? '334 UGFzc3dvcmQ6\r\n' : '235 ok\r\n');
          }
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as { port: number };

    process.env.SMTP_HOST = '127.0.0.1';
    process.env.SMTP_PORT = String(port);
    process.env.CONTACT_TO = 'inbox@blokza.com';

    const res = fakeRes();
    await handler(
      fakeReq('POST', { ...GOOD, msg: 'A line.\n.\nAnd one the dot must not swallow.' }),
      res,
      createTransport(() => net.connect({ host: '127.0.0.1', port })),
    );
    await delivered;
    server.close();

    expect(res.out.code).toBe(200);
    expect(received).toMatch(/^To: <inbox@blokza\.com>$/m);
    expect(received).toMatch(/^Reply-To: Ada Lovelace <ada@example\.com>$/m);
    // The subject reaches the wire as an RFC 2047 encoded-word, because it is
    // built with an em dash and a header may not carry a raw non-ASCII byte.
    // What matters is what the recipient's client shows after decoding.
    // This fake server re-joins the DATA lines with \n, so unfold on that.
    const subjectLine = received.replace(/\n[ \t]/g, '')
      .split('\n').find((l) => l.startsWith('Subject:'))!;
    const decodedSubject = subjectLine.replace(
      /=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/g,
      (_m, b64: string) => Buffer.from(b64, 'base64').toString('utf8'),
    );
    expect(decodedSubject).toBe('Subject: [BLOKZA] Sales — Ada Lovelace');
    // The dot-stuffed line arrives escaped, and the text after it survives —
    // the whole point of the escaping is that the message is not truncated.
    expect(received).toContain('\n..\n');
    expect(received).toContain('And one the dot must not swallow.');
  });

  it('surfaces a refusal instead of hanging', async () => {
    const net = await import('node:net');
    const server = net.createServer((socket) => {
      socket.setEncoding('utf8');
      socket.write('220 smtp.test ready\r\n');
      socket.on('data', () => socket.write('535 authentication failed\r\n'));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as { port: number };

    const send = createTransport(() => net.connect({ host: '127.0.0.1', port }));
    await expect(
      send({ host: '127.0.0.1', port, user: 'u', pass: 'p', envelopeFrom: 'a@b.co', to: 'c@d.co', message: 'x' }),
    ).rejects.toThrow(/535/);
    server.close();
  });
});
