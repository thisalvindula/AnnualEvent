import { useEffect, useState } from 'preact/hooks';

// Subscribes to a set of named SSE events on `url`, returning the latest
// payload received for each event name: { [eventName]: { data, receivedAt } }.
// Always closes the EventSource in the effect cleanup so React/Preact
// StrictMode's double-invoke in dev never leaves a duplicate live connection.
export function useEventSource(url, eventNames) {
  const [events, setEvents] = useState({});
  const eventNamesKey = eventNames.join(',');

  useEffect(() => {
    if (!url) return undefined;
    const es = new EventSource(url);
    const handlers = eventNamesKey.split(',').filter(Boolean).map((name) => {
      const handler = (e) => {
        let data;
        try {
          data = JSON.parse(e.data);
        } catch {
          data = e.data;
        }
        setEvents((prev) => ({ ...prev, [name]: { data, receivedAt: Date.now() } }));
      };
      es.addEventListener(name, handler);
      return [name, handler];
    });

    return () => {
      for (const [name, handler] of handlers) es.removeEventListener(name, handler);
      es.close();
    };
  }, [url, eventNamesKey]);

  return events;
}
