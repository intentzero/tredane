import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { AbuseLimitsDto, PanelApi } from "../../api";
import { AutomationLimitsCard } from "./AutomationLimitsCard";

afterEach(cleanup);

const limits = {
  windowHours: 24,
  aiDraftsPerContact: 5,
  aiBookingsPerContact: 2,
  aiBookingsPerClinic: 20,
  futureAppointmentsPerContact: 3,
  pendingPixPerContact: 1,
  pendingProposalsPerContact: 1,
  proposalsPerContact: 5,
  proposalsPerClinic: 50,
};

const view = {
  enabled: true,
  autoBookPaused: false,
  limits,
  caps: limits,
  platformCeilings: limits,
} as unknown as AbuseLimitsDto;

const api = { getClinicAbuseLimits: async () => view } as unknown as PanelApi;

describe("AutomationLimitsCard", () => {
  it("esconde os números até pedir «Personalizar»", async () => {
    const user = userEvent.setup();
    render(
      <AutomationLimitsCard
        tenantId="clinic-demo-a"
        api={api}
        generation={1}
      />,
    );
    const toggle = await screen.findByRole("button", {
      name: /^Personalizar os \d+ limites$/,
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "Salvar números" })).toBeNull();
    expect(
      screen.getByRole("switch", { name: "Aplicar limites de proteção" }),
    ).toBeTruthy();
    await user.click(toggle);
    expect(screen.getByRole("button", { name: "Salvar números" })).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Ocultar os números" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
  });
});
