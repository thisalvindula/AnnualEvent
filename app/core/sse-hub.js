// Generic SSE pub-sub, keyed by channel name. Only the two big-screen pages
// hold an open connection (requirement 9.5); employee phones never subscribe,
// which keeps this to a couple of long-lived connections instead of 800.

const channels = new Map(); // channel name -> Set<Fastify raw response>

export function subscribe(channelName, request, reply) {
  reply.hijack(); // tells Fastify this response is managed manually from here on,
  // so app.close()'s drain doesn't wait on or interfere with this open connection
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  reply.raw.write(':ok\n\n');

  if (!channels.has(channelName)) channels.set(channelName, new Set());
  const subscribers = channels.get(channelName);
  subscribers.add(reply.raw);

  const heartbeat = setInterval(() => {
    reply.raw.write(':heartbeat\n\n');
  }, 25000);

  request.raw.on('close', () => {
    clearInterval(heartbeat);
    subscribers.delete(reply.raw);
  });
}

/**
 * Writes directly to one connection (e.g. the initial state snapshot right
 * after a screen connects), rather than broadcasting to the whole channel.
 */
export function sendTo(reply, event, data) {
  reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function publish(channelName, event, data) {
  const subscribers = channels.get(channelName);
  if (!subscribers || subscribers.size === 0) return;

  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of subscribers) {
    res.write(payload);
  }
}

export function subscriberCount(channelName) {
  return channels.get(channelName)?.size ?? 0;
}

/**
 * Tells every open screen connection the server is going away (so a
 * reconnect isn't a surprise) and closes them. Used only during graceful
 * shutdown — the browser's EventSource reconnects on its own afterwards.
 */
export function closeAll() {
  for (const subscribers of channels.values()) {
    for (const res of subscribers) {
      res.write('event: server_shutdown\ndata: {"reconnect":true}\n\n');
      res.end();
    }
    subscribers.clear();
  }
}
