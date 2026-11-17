import type { InboxMessage } from "../../api";

export type LocalOutboundLike = {
  body: string;
  clientRequestId?: string;
};

const ACKED = new Set([
  "pending",
  "accepted",
  "delivered",
  "read",
  "unknown",
]);

/**
 * Remove cópias otimistas quando o refetch em tempo real já trouxe a mensagem do servidor
 * (corrida entre `message.created` e a resposta do POST).
 */
export function pruneOutboxAgainstMessages<T extends LocalOutboundLike>(
  outbox: T[],
  messages: InboxMessage[],
): T[] {
  if (outbox.length === 0) return outbox;
  return outbox.filter((o) => {
    const body = o.body.trim();
    return !messages.some(
      (m) =>
        m.direction === "outbound" &&
        m.body.trim() === body &&
        ACKED.has(m.deliveryState),
    );
  });
}