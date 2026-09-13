import { describe, expect, it } from 'vitest';
import { conversationOpener, conversationTopicLabel, countUnread } from './thread.js';
import type { ConversationTopic } from '../domain/types.js';

const at = (minute: number) => new Date(Date.UTC(2026, 8, 12, 10, minute));

const hilo = [
  { sender: 'person', sentAt: at(0) },
  { sender: 'gym', sentAt: at(5) },
  { sender: 'person', sentAt: at(9) },
  { sender: 'person', sentAt: at(10) },
] as const;

describe('lo no leido', () => {
  it('sin haber abierto nunca, todo lo del otro lado esta sin leer', () => {
    expect(countUnread(hilo, 'gym', null)).toBe(3);
    expect(countUnread(hilo, 'person', null)).toBe(1);
  });

  it('no cuenta lo que uno mismo escribio', () => {
    // Los dos ultimos del hilo son suyos y son posteriores a su marca: verse un
    // «2» por lo que uno acaba de escribir es el bug clasico de las bandejas.
    expect(countUnread(hilo, 'person', at(5))).toBe(0);
  });

  it('cuenta lo llegado despues de la marca', () => {
    expect(countUnread(hilo, 'gym', at(5))).toBe(2);
    expect(countUnread(hilo, 'gym', at(9))).toBe(1);
    expect(countUnread(hilo, 'gym', at(10))).toBe(0);
  });
});

describe('como se nombra el hilo', () => {
  const topics: readonly ConversationTopic[] = [
    'general',
    'trial',
    'drop_in',
    'membership',
    'event',
  ];

  it('cada origen tiene etiqueta y primera linea', () => {
    for (const topic of topics) {
      expect(conversationTopicLabel(topic).length).toBeGreaterThan(3);
      expect(conversationOpener(topic).length).toBeGreaterThan(3);
    }
  });
});
