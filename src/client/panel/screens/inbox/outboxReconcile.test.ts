// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { pruneOutboxAgainstMessages } from "./outboxReconcile";

const msg = (
  body: string,
  deliveryState: string,
): { direction: "outbound"; body: string; deliveryState: string } => ({
  direction: "outbound",
  body,
  deliveryState,
});

describe("pruneOutboxAgainstMessages", () => {
  it("remove otimista quando o servidor já listou a mesma bolha pendente", () => {
    const outbox = [{ localId: "l1", body: "Olá", clientRequestId: "c1" }];
    const next = pruneOutboxAgainstMessages(outbox, [
      msg("Olá", "pending") as never,
    ]);
    expect(next).toHaveLength(0);
  });

  it("mantém otimista falhada sem eco do servidor", () => {
    const outbox = [{ localId: "l1", body: "Olá" }];
    const next = pruneOutboxAgainstMessages(outbox, [
      msg("Outra", "pending") as never,
    ]);
    expect(next).toHaveLength(1);
  });
});