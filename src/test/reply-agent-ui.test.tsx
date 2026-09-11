import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SelectableCard } from "@/components/reply-agent/SelectableCard";
import {
  agentToDraft,
  emptyAgentDraft,
  parseResources,
  scopeSummary,
  validateAgentDraft,
  type ReplyAgent,
} from "@/components/reply-agent/types";

function makeAgent(over: Partial<ReplyAgent> = {}): ReplyAgent {
  return {
    id: "a1",
    user_id: "u1",
    name: "Agente ventas",
    prompt: "",
    company_info: "",
    account_tags: [],
    account_ids: [],
    is_active: true,
    delay_minutes: 5,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    primary_goal: null,
    custom_goal: null,
    scope_type: null,
    campaign_ids: null,
    category_mode: null,
    categories: null,
    reply_mode: null,
    tone: null,
    length: null,
    style_prompt: null,
    business_context: null,
    objection_handling: null,
    resources: null,
    max_replies_per_day: null,
    signature_name: null,
    ...over,
  };
}

describe("validateAgentDraft", () => {
  it("exige nombre", () => {
    expect(validateAgentDraft({ ...emptyAgentDraft(), name: "  " })).toMatch(/nombre/i);
  });

  it("exige al menos una campaña cuando el alcance es por campaña", () => {
    const d = { ...emptyAgentDraft(), name: "X", scope_type: "campaign" as const, campaign_ids: [] };
    expect(validateAgentDraft(d)).toMatch(/campaña/i);
    expect(validateAgentDraft({ ...d, campaign_ids: ["c1"] })).toBeNull();
  });

  it("exige al menos una etiqueta cuando el alcance es por etiquetas", () => {
    const d = { ...emptyAgentDraft(), name: "X", scope_type: "tags" as const, account_tags: [] };
    expect(validateAgentDraft(d)).toMatch(/etiqueta/i);
  });

  it("exige al menos una categoría en modo específico", () => {
    const d = { ...emptyAgentDraft(), name: "X", categories: [] };
    expect(validateAgentDraft(d)).toMatch(/categoría/i);
  });

  it("no exige categorías cuando aplica a todas las respuestas", () => {
    const d = { ...emptyAgentDraft(), name: "X", category_mode: "all" as const, categories: [] };
    expect(validateAgentDraft(d)).toBeNull();
  });

  it("exige describir el objetivo personalizado", () => {
    const d = { ...emptyAgentDraft(), name: "X", primary_goal: "custom" as const, custom_goal: "" };
    expect(validateAgentDraft(d)).toMatch(/objetivo/i);
  });

  it("acepta el borrador por defecto con nombre", () => {
    expect(validateAgentDraft({ ...emptyAgentDraft(), name: "Agente" })).toBeNull();
  });
});

describe("agentToDraft", () => {
  it("rellena los valores por defecto en filas antiguas (columnas nulas)", () => {
    const d = agentToDraft(makeAgent());
    expect(d.primary_goal).toBe("book_meeting");
    expect(d.scope_type).toBe("account");
    expect(d.reply_mode).toBe("draft");
    expect(d.category_mode).toBe("specific");
    expect(d.categories).toEqual(["Interesado", "Pregunta"]);
    expect(d.max_replies_per_day).toBe(50);
    expect(d.resources).toEqual([]);
  });

  it("respeta lo guardado", () => {
    const d = agentToDraft(makeAgent({ reply_mode: "auto", tone: "direct", length: "short", max_replies_per_day: 10 }));
    expect(d.reply_mode).toBe("auto");
    expect(d.tone).toBe("direct");
    expect(d.length).toBe("short");
    expect(d.max_replies_per_day).toBe(10);
  });
});

describe("parseResources", () => {
  it("ignora jsonb corrupto y normaliza los campos", () => {
    expect(parseResources(null)).toEqual([]);
    expect(parseResources("no-es-array")).toEqual([]);
    expect(parseResources([{ name: "Calendario" }, null, 3])).toEqual([{ name: "Calendario", url: "" }]);
  });
});

describe("scopeSummary", () => {
  it("resume cada tipo de alcance", () => {
    expect(scopeSummary(makeAgent({ scope_type: "account" }), {})).toBe("Toda la cuenta");
    expect(scopeSummary(makeAgent({ scope_type: "tags", account_tags: ["ventas"] }), {})).toContain("ventas");
    expect(scopeSummary(makeAgent({ scope_type: "campaign", campaign_ids: ["c1"] }), { c1: "Campaña A" })).toBe("Campaña A");
    expect(scopeSummary(makeAgent({ scope_type: "campaign", campaign_ids: [] }), {})).toMatch(/Sin campañas/);
  });
});

describe("SelectableCard", () => {
  it("marca la opción elegida y avisa al pulsar", () => {
    const onSelect = vi.fn();
    render(<SelectableCard selected onSelect={onSelect} title="Envío automático" description="Sin revisión" />);
    const card = screen.getByRole("radio");
    expect(card).toHaveAttribute("aria-checked", "true");
    fireEvent.click(card);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
