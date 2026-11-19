import {
  BarChart,
  Button,
  Callout,
  Divider,
  Grid,
  H1,
  H2,
  H3,
  Row,
  Select,
  Stack,
  Stat,
  Table,
  Text,
  TextInput,
  UsageBar,
  useCanvasState,
  useMemo,
} from "cursor/canvas";

/**
 * Unit economics da assinatura Tredane.
 * Tudo abaixo de FONTES é hipótese (Proposto), não preço aprovado.
 *
 * Preços de terceiros usados no caso-base (nov/2026):
 * - Meta Brasil, cartão de 1/out/2026: service R$ 0,035 após 1.000 grátis
 *   por número/mês; utility R$ 0,035. Marketing R$ 0,3217 fica fora
 *   (lembrete de campanha não está no MVP).
 * - Claude Haiku 5.5, prompt até 100k tokens: US$ 0,10 / US$ 0,50 por milhão
 *   (entrada / saída). Sonnet 5.5: US$ 2 / US$ 10. Modelos em src/ai/budgets.ts.
 * - Conta WhatsApp é da clínica (DEC-009). Pix cai na conta da clínica (DEC-047).
 * - Imposto sobre a nota: Simples Anexo V 15,5% na 1ª faixa (LC 123/2006),
 *   caso-base enquanto a folha ficar abaixo de 28% da receita (fator R).
 *   Anexo III começa em 6%. O regime ainda está em aberto: sem CNPJ (VAL-13).
 */

const HAIKU_IN = 2500;
const HAIKU_OUT = 600;
const SONNET_IN = 4000;
const SONNET_OUT = 800;
const HAIKU_IN_USD = 0.1;
const HAIKU_OUT_USD = 0.5;
const SONNET_IN_USD = 2;
const SONNET_OUT_USD = 10;
const WA_RATE = 0.035;
const WA_FREE_SERVICE = 1000;
const MARGIN_TARGET = 0.6;
const PRICE_STEPS = [297, 397, 497, 697, 897, 1097, 1297];

type RegimeId = "v" | "iii" | "lp2" | "lp5" | "manual";

type Faixa = { teto: number; nominal: number; deduz: number };

/** LC 123/2006, anexos III e V, faixas de 2026. Efetiva = (RBT12 × nominal − dedução) / RBT12. */
const FAIXAS_III: Faixa[] = [
  { teto: 180_000, nominal: 0.06, deduz: 0 },
  { teto: 360_000, nominal: 0.112, deduz: 9_360 },
  { teto: 720_000, nominal: 0.135, deduz: 17_640 },
  { teto: 1_800_000, nominal: 0.16, deduz: 35_640 },
  { teto: 3_600_000, nominal: 0.21, deduz: 125_640 },
  { teto: 4_800_000, nominal: 0.33, deduz: 648_000 },
];

const FAIXAS_V: Faixa[] = [
  { teto: 180_000, nominal: 0.155, deduz: 0 },
  { teto: 360_000, nominal: 0.18, deduz: 4_500 },
  { teto: 720_000, nominal: 0.195, deduz: 9_900 },
  { teto: 1_800_000, nominal: 0.205, deduz: 17_100 },
  { teto: 3_600_000, nominal: 0.23, deduz: 62_100 },
  { teto: 4_800_000, nominal: 0.305, deduz: 540_000 },
];

/** ISS + PIS 0,65% + COFINS 3% + IRPJ 15% e CSLL 9% sobre presunção de 32%. */
const PRESUMIDO_SEM_ISS = 0.0065 + 0.03 + 0.15 * 0.32 + 0.09 * 0.32;

type PresetId = "estudio" | "pequena" | "ocupada";

type Volume = {
  conversas: number;
  msgsOut: number;
  utility: number;
  haikuPor: number;
  sonnet: number;
  horasPiloto: number;
  horasRegime: number;
  onboardingHoras: number;
};

const PRESETS: Record<PresetId, Volume & { label: string }> = {
  estudio: {
    label: "Estúdio · 1 profissional",
    conversas: 80,
    msgsOut: 6,
    utility: 15,
    haikuPor: 0.8,
    sonnet: 8,
    horasPiloto: 1,
    horasRegime: 0.3,
    onboardingHoras: 3,
  },
  pequena: {
    label: "Clínica pequena · 2 a 3",
    conversas: 200,
    msgsOut: 8,
    utility: 40,
    haikuPor: 1.2,
    sonnet: 20,
    horasPiloto: 1.5,
    horasRegime: 0.4,
    onboardingHoras: 4,
  },
  ocupada: {
    label: "Clínica ocupada · 5 a 8",
    conversas: 500,
    msgsOut: 10,
    utility: 80,
    haikuPor: 1.5,
    sonnet: 40,
    horasPiloto: 2.5,
    horasRegime: 0.6,
    onboardingHoras: 6,
  },
};

type ImportMode = "iof" | "saas" | "licenca";

type CostInput = {
  conversas: number;
  msgsOut: number;
  utility: number;
  haikuPor: number;
  sonnet: number;
  horas: number;
  onboardingReais: number;
  custoHora: number;
  infraUsd: number;
  fx: number;
  absorve: boolean;
  /** IOF só, ou pacote de importação de SaaS/licença sobre a fatura em dólar. */
  importMode: ImportMode;
  /** ISS da importação, em fração (0,02 = 2%). */
  issImport: number;
};

type Cost = {
  ai: number;
  infra: number;
  remessa: number;
  suporte: number;
  onboarding: number;
  meta: number;
  waNoTredane: number;
  cogs: number;
  serviceMsgs: number;
  serviceBillable: number;
};

/**
 * Tributos por cima da fatura estrangeira quando o fornecedor recebe o valor cheio.
 * IRRF 15% com gross-up (RIR/2018, art. 786). CIDE 10% sobre a base reajustada no
 * enquadramento de serviço técnico (SC Cosit 191/2017); zero na licença sem
 * transferência de tecnologia (SC Cosit 107/2023). PIS/Cofins-Importação 9,25%
 * com base gross-up (IN RFB 2.121/2022, art. 273). IOF-câmbio 3,5% (Decreto 12.499/2025).
 * No Simples isso fica fora do DAS (LC 123/2006, art. 13, § 1º).
 */
function tributoRemessa(fatura: number, mode: ImportMode, issImport: number): number {
  const base = Math.max(0, fatura);
  const iof = base * 0.035;
  if (mode === "iof" || base === 0) return iof;
  const baseIrrf = base / 0.85;
  const irrf = baseIrrf * 0.15;
  const cide = mode === "saas" ? baseIrrf * 0.1 : 0;
  const pisCofins = (baseIrrf / 0.9075) * 0.0925;
  const iss = base * Math.max(0, issImport);
  return iof + irrf + cide + pisCofins + iss;
}

function brl(n: number, digits = 0): string {
  const neg = n < 0;
  const abs = Math.abs(n);
  const fixed = abs.toFixed(digits);
  const [inteiro, frac] = fixed.split(".");
  const withDots = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${neg ? "-" : ""}R$ ${withDots}${frac !== undefined && digits > 0 ? "," + frac : ""}`;
}

function pct(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `${Math.round(n * 100)}%`;
}

function pct1(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const rounded = Math.round(n * 1000) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace(".", ",");
  return `${text}%`;
}

function efetiva(rbt12: number, faixas: Faixa[]): number {
  const r = Math.max(rbt12, 1);
  const faixa = faixas.find((f) => r <= f.teto) ?? faixas[faixas.length - 1];
  return Math.max(0, (r * faixa.nominal - faixa.deduz) / r);
}

function aliquotaDe(regime: RegimeId, rbt12: number, manualPct: number): number {
  if (regime === "manual") return Math.max(0, manualPct) / 100;
  if (regime === "lp2") return 0.02 + PRESUMIDO_SEM_ISS;
  if (regime === "lp5") return 0.05 + PRESUMIDO_SEM_ISS;
  return efetiva(rbt12, regime === "iii" ? FAIXAS_III : FAIXAS_V);
}

function regimeNome(regime: RegimeId): string {
  if (regime === "iii") return "Simples Anexo III";
  if (regime === "lp2") return "Lucro Presumido com ISS de 2%";
  if (regime === "lp5") return "Lucro Presumido com ISS de 5%";
  if (regime === "manual") return "alíquota manual";
  return "Simples Anexo V";
}

/** Preço em que (preço − imposto − custo) / preço = margem alvo. */
function pisoBruto(cogs: number, aliquota: number): number {
  const denom = 1 - aliquota - MARGIN_TARGET;
  if (denom <= 0.02) return Number.POSITIVE_INFINITY;
  return cogs / denom;
}

function snapPrice(floor: number): number {
  return PRICE_STEPS.find((step) => step >= floor) ?? PRICE_STEPS[PRICE_STEPS.length - 1];
}

function costOf(input: CostInput): Cost {
  const haikuCalls = Math.max(0, input.conversas) * Math.max(0, input.haikuPor);
  const haikuUsd =
    haikuCalls * ((HAIKU_IN / 1e6) * HAIKU_IN_USD + (HAIKU_OUT / 1e6) * HAIKU_OUT_USD);
  const sonnetUsd =
    Math.max(0, input.sonnet) *
    ((SONNET_IN / 1e6) * SONNET_IN_USD + (SONNET_OUT / 1e6) * SONNET_OUT_USD);
  const ai = (haikuUsd + sonnetUsd) * input.fx;
  const infra = Math.max(0, input.infraUsd) * input.fx;
  const suporte = Math.max(0, input.horas) * Math.max(0, input.custoHora);
  const onboarding = Math.max(0, input.onboardingReais);
  const serviceMsgs = Math.max(0, input.conversas) * Math.max(0, input.msgsOut);
  const serviceBillable = Math.max(0, serviceMsgs - WA_FREE_SERVICE);
  const meta = serviceBillable * WA_RATE + Math.max(0, input.utility) * WA_RATE;
  const waNoTredane = input.absorve ? meta : 0;
  const remessa = tributoRemessa(ai + infra, input.importMode, input.issImport);
  const cogs = ai + infra + remessa + suporte + onboarding + waNoTredane;
  return {
    ai,
    infra,
    remessa,
    suporte,
    onboarding,
    meta,
    waNoTredane,
    cogs,
    serviceMsgs,
    serviceBillable,
  };
}

function marginTone(margin: number): "success" | "warning" | "danger" {
  if (margin >= MARGIN_TARGET) return "success";
  if (margin >= 0.4) return "warning";
  return "danger";
}

function Field({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <Stack gap={4}>
      <Text size="small" weight="medium">
        {label}
      </Text>
      <TextInput
        type="number"
        value={String(value)}
        onChange={(v) => {
          const n = Number(v);
          if (Number.isFinite(n)) onChange(n);
        }}
        style={{ width: "100%" }}
      />
        {hint ? (
        <Text size="small" tone="tertiary">
          {hint}
        </Text>
      ) : null}
    </Stack>
  );
}

export default function UnitEconomicsAssinatura() {
  const [perfil, setPerfil] = useCanvasState<string>("perfil", "pequena");
  const [conversas, setConversas] = useCanvasState("conversas", PRESETS.pequena.conversas);
  const [msgsOut, setMsgsOut] = useCanvasState("msgsOut", PRESETS.pequena.msgsOut);
  const [utility, setUtility] = useCanvasState("utility", PRESETS.pequena.utility);
  const [haikuPor, setHaikuPor] = useCanvasState("haikuPor", PRESETS.pequena.haikuPor);
  const [sonnet, setSonnet] = useCanvasState("sonnet", PRESETS.pequena.sonnet);
  const [horasPiloto, setHorasPiloto] = useCanvasState("horasPiloto", PRESETS.pequena.horasPiloto);
  const [horasRegime, setHorasRegime] = useCanvasState("horasRegime", PRESETS.pequena.horasRegime);
  const [onboardingHoras, setOnboardingHoras] = useCanvasState(
    "onboardingHoras",
    PRESETS.pequena.onboardingHoras,
  );
  const [custoHora, setCustoHora] = useCanvasState("custoHora", 80);
  const [infraUsd, setInfraUsd] = useCanvasState("infraUsd", 1);
  const [fx, setFx] = useCanvasState("fx", 5.4);
  const [absorve, setAbsorve] = useCanvasState("absorve", false);
  const [preco, setPreco] = useCanvasState("preco", 397);
  const [burn, setBurn] = useCanvasState("burn", 12000);
  const [clinicas, setClinicas] = useCanvasState("clinicas", 15);
  const [regime, setRegime] = useCanvasState<RegimeId>("regime", "v");
  const [manualPct, setManualPct] = useCanvasState("manualPct", 15.5);
  const [importMode, setImportMode] = useCanvasState<ImportMode>("importMode", "saas");
  const [issImportPct, setIssImportPct] = useCanvasState("issImportPct", 2);

  const onboardingReais = (onboardingHoras * custoHora) / 12;

  const piloto = useMemo(
    () =>
      costOf({
        conversas,
        msgsOut,
        utility,
        haikuPor,
        sonnet,
        horas: horasPiloto,
        onboardingReais,
        custoHora,
        infraUsd,
        fx,
        absorve,
        importMode,
        issImport: issImportPct / 100,
      }),
    [
      conversas,
      msgsOut,
      utility,
      haikuPor,
      sonnet,
      horasPiloto,
      onboardingReais,
      custoHora,
      infraUsd,
      fx,
      absorve,
      importMode,
      issImportPct,
    ],
  );

  const estavel = useMemo(
    () =>
      costOf({
        conversas,
        msgsOut,
        utility,
        haikuPor,
        sonnet,
        horas: horasRegime,
        onboardingReais: 0,
        custoHora,
        infraUsd,
        fx,
        absorve,
        importMode,
        issImport: issImportPct / 100,
      }),
    [
      conversas,
      msgsOut,
      utility,
      haikuPor,
      sonnet,
      horasRegime,
      custoHora,
      infraUsd,
      fx,
      absorve,
      importMode,
      issImportPct,
    ],
  );

  const rbt12 = Math.max(0, clinicas) * Math.max(preco, 0) * 12;
  const aliquota = aliquotaDe(regime, Math.max(rbt12, 1), manualPct);
  const imposto = preco * aliquota;
  const simplesEstoura = (regime === "v" || regime === "iii") && rbt12 > 4_800_000;

  function degrauDe(cogs: number): number {
    const rateAt = (price: number) =>
      aliquotaDe(regime, Math.max(clinicas, 1) * Math.max(price, 1) * 12, manualPct);
    let rate = rateAt(preco);
    let raw = pisoBruto(cogs, rate);
    rate = rateAt(Number.isFinite(raw) ? raw : preco);
    raw = pisoBruto(cogs, rate);
    return snapPrice(raw);
  }

  const floor = pisoBruto(piloto.cogs, aliquota);
  const degrau = degrauDe(piloto.cogs);
  const margemPiloto = preco > 0 ? (preco - imposto - piloto.cogs) / preco : 0;
  const margemRegime = preco > 0 ? (preco - imposto - estavel.cogs) / preco : 0;
  const contribPiloto = preco - imposto - piloto.cogs;
  const contribRegime = preco - imposto - estavel.cogs;

  function touch(setter: (n: number) => void) {
    return (n: number) => {
      setPerfil("custom");
      setter(n);
    };
  }

  function applyPreset(id: PresetId) {
    const p = PRESETS[id];
    setPerfil(id);
    setConversas(p.conversas);
    setMsgsOut(p.msgsOut);
    setUtility(p.utility);
    setHaikuPor(p.haikuPor);
    setSonnet(p.sonnet);
    setHorasPiloto(p.horasPiloto);
    setHorasRegime(p.horasRegime);
    setOnboardingHoras(p.onboardingHoras);
    const onboarding = (p.onboardingHoras * custoHora) / 12;
    const next = costOf({
      conversas: p.conversas,
      msgsOut: p.msgsOut,
      utility: p.utility,
      haikuPor: p.haikuPor,
      sonnet: p.sonnet,
      horas: p.horasPiloto,
      onboardingReais: onboarding,
      custoHora,
      infraUsd,
      fx,
      absorve,
      importMode,
      issImport: issImportPct / 100,
    });
    setPreco(degrauDe(next.cogs));
  }

  const segments = [
    { id: "ia", value: piloto.ai, color: "purple" as const },
    { id: "infra", value: piloto.infra, color: "gray" as const },
    { id: "remessa", value: piloto.remessa, color: "red" as const },
    { id: "suporte", value: piloto.suporte, color: "blue" as const },
    { id: "onboarding", value: piloto.onboarding, color: "yellow" as const },
    { id: "imposto", value: Math.max(0, imposto), color: "pink" as const },
    ...(absorve ? [{ id: "wa", value: piloto.waNoTredane, color: "orange" as const }] : []),
    ...(contribPiloto > 0 ? [{ id: "margem", value: contribPiloto, color: "green" as const }] : []),
  ];
  const barTotal = Math.max(preco, piloto.cogs + Math.max(0, imposto), 1);

  const ladderPrices = [297, 397, 497, 697, 897];
  const impostoEm = (price: number) =>
    price * aliquotaDe(regime, Math.max(clinicas, 1) * price * 12, manualPct);
  const ladderPiloto = ladderPrices.map((price) => Math.round(price - impostoEm(price) - piloto.cogs));
  const ladderRegime = ladderPrices.map((price) => Math.round(price - impostoEm(price) - estavel.cogs));
  const ladderMin = Math.min(...ladderPiloto, ...ladderRegime);

  const presetRows = (Object.keys(PRESETS) as PresetId[]).map((id) => {
    const p = PRESETS[id];
    const base = {
      conversas: p.conversas,
      msgsOut: p.msgsOut,
      utility: p.utility,
      haikuPor: p.haikuPor,
      sonnet: p.sonnet,
      custoHora,
      infraUsd,
      fx,
      absorve,
      importMode,
      issImport: issImportPct / 100,
    };
    const pCogs = costOf({
      ...base,
      horas: p.horasPiloto,
      onboardingReais: (p.onboardingHoras * custoHora) / 12,
    });
    const rCogs = costOf({ ...base, horas: p.horasRegime, onboardingReais: 0 });
    const price = degrauDe(pCogs.cogs);
    const tax = price * aliquotaDe(regime, Math.max(clinicas, 1) * price * 12, manualPct);
    const regimeMargin = price > 0 ? (price - tax - rCogs.cogs) / price : 0;
    return [
      p.label,
      brl(price),
      brl(pCogs.cogs),
      brl(tax),
      pct((price - tax - pCogs.cogs) / price),
      pct(regimeMargin),
      brl(pCogs.meta),
    ];
  });

  const regimeRows = (
    [
      ["v", "Simples Anexo V"],
      ["iii", "Simples Anexo III"],
      ["lp2", "Lucro Presumido, ISS 2%"],
      ["lp5", "Lucro Presumido, ISS 5%"],
    ] as const
  ).map(([id, nome]) => {
    const rate = aliquotaDe(id, Math.max(clinicas, 1) * 497 * 12, manualPct);
    const left = 497 * (1 - rate) - piloto.cogs;
    const step = (() => {
      const rateAt = (price: number) => aliquotaDe(id, Math.max(clinicas, 1) * price * 12, manualPct);
      let r = rateAt(497);
      let raw = pisoBruto(piloto.cogs, r);
      r = rateAt(Number.isFinite(raw) ? raw : 497);
      raw = pisoBruto(piloto.cogs, r);
      return snapPrice(raw);
    })();
    return [nome, pct1(rate), brl(left), pct(left / 497), brl(step)];
  });

  function clinicsFor(contribution: number): string {
    if (contribution <= 0) return "não fecha";
    return String(Math.ceil(burn / contribution));
  }

  return (
    <Stack gap={24}>
      <Stack gap={6}>
        <H1>Quanto cobrar por clínica</H1>
        <Text tone="secondary">
          Assinatura mensal do Tredane para uma clínica de estética. A leitura de baixo é hipótese
          editável: o preço ainda não está decidido.
        </Text>
      </Stack>

      <Row gap={24} wrap>
        <Stat value={brl(degrau)} label="Degrau com 60% da nota, já com imposto" tone="info" />
        <Stat value={brl(imposto)} label={`Imposto em ${brl(preco)} (${pct1(aliquota)})`} tone="warning" />
        <Stat
          value={pct(margemPiloto)}
          label={`Sobra no piloto a ${brl(preco)}`}
          tone={marginTone(margemPiloto)}
        />
        <Stat value={brl(piloto.cogs)} label="Custo do piloto, antes do imposto" />
      </Row>

      <Callout tone={margemPiloto >= MARGIN_TARGET ? "info" : "warning"} title="A nota paga imposto antes da margem">
        {`Em ${brl(preco)} o ${regimeNome(regime)} leva ${brl(imposto)} (${pct1(aliquota)}). Com custo de piloto de ${brl(piloto.cogs)}, sobram ${brl(contribPiloto)} — ${pct(margemPiloto)} da nota. Para sobrar 60% da nota, o preço precisa passar de ${brl(Math.ceil(floor))}. O degrau comercial seguinte é ${brl(degrau)}. A conta da Meta (${brl(piloto.meta)}) ${absorve ? "entra no custo do Tredane." : "fica na clínica e não entra nesta nota."} ${simplesEstoura ? "A receita anualizada passou de R$ 4,8 milhões: o Simples deixa de caber." : `Receita anualizada nesta base: ${brl(rbt12)}.`}`}
      </Callout>

      <Grid columns="minmax(0, 1fr) minmax(0, 1.15fr)" gap={28}>
        <Stack gap={16}>
          <H2>Perfil da clínica</H2>
          <Row gap={8} wrap>
            <Button
              variant={perfil === "estudio" ? "primary" : "secondary"}
              onClick={() => applyPreset("estudio")}
            >
              Estúdio
            </Button>
            <Button
              variant={perfil === "pequena" ? "primary" : "secondary"}
              onClick={() => applyPreset("pequena")}
            >
              Pequena
            </Button>
            <Button
              variant={perfil === "ocupada" ? "primary" : "secondary"}
              onClick={() => applyPreset("ocupada")}
            >
              Ocupada
            </Button>
          </Row>
          <Text size="small" tone="tertiary">
            {perfil === "custom"
              ? "Números ajustados à mão."
              : PRESETS[perfil as PresetId]?.label ?? "Perfil"}
          </Text>
          <Grid columns={2} gap={12}>
            <Field
              label="Conversas por mês"
              hint="Uma conversa com a cliente, não uma mensagem."
              value={conversas}
              onChange={touch(setConversas)}
            />
            <Field
              label="Saídas de serviço por conversa"
              hint="Texto livre dentro da janela de 24 h."
              value={msgsOut}
              onChange={touch(setMsgsOut)}
            />
            <Field
              label="Utility por mês"
              hint="Modelo fora da janela: confirmação, cancelamento."
              value={utility}
              onChange={touch(setUtility)}
            />
            <Field
              label="Chamadas Haiku por conversa"
              hint="Extrator e resposta aberta. O caminho de agenda é frase do backend."
              value={haikuPor}
              onChange={touch(setHaikuPor)}
            />
            <Field
              label="Chamadas Sonnet por mês"
              hint="«Gerar outra» no painel. O rascunho automático é Haiku."
              value={sonnet}
              onChange={touch(setSonnet)}
            />
            <Field
              label="Horas de suporte no piloto"
              hint="Por clínica, por mês, enquanto aprende o produto."
              value={horasPiloto}
              onChange={touch(setHorasPiloto)}
            />
            <Field
              label="Horas de suporte em regime"
              value={horasRegime}
              onChange={touch(setHorasRegime)}
            />
            <Field
              label="Horas de onboarding"
              hint="Diluídas em 12 meses no custo do piloto."
              value={onboardingHoras}
              onChange={touch(setOnboardingHoras)}
            />
          </Grid>
          <Select
            value={absorve ? "tredane" : "clinica"}
            onChange={(v) => {
              setPerfil("custom");
              setAbsorve(v === "tredane");
            }}
            options={[
              { value: "clinica", label: "Meta paga pela clínica (conta dela)" },
              { value: "tredane", label: "Tredane absorve a conta da Meta" },
            ]}
          />
          <Select
            value={importMode}
            onChange={(v) => setImportMode(v as ImportMode)}
            options={[
              { value: "saas", label: "Remessa: SaaS técnico + IOF" },
              { value: "licenca", label: "Remessa: licença sem CIDE + IOF" },
              { value: "iof", label: "Remessa: só o IOF de 3,5%" },
            ]}
          />
          {importMode === "iof" ? (
            <Text size="small" tone="tertiary">
              Só o IOF que o banco ou o cartão cobra na fatura em dólar da Cloudflare e da Anthropic.
            </Text>
          ) : (
            <Field
              label="ISS da importação (%)"
              hint="Por cima da fatura em dólar. O município define entre 2% e 5%."
              value={issImportPct}
              onChange={setIssImportPct}
            />
          )}
        </Stack>

        <Stack gap={16}>
          <H2>Para onde vai a mensalidade no piloto</H2>
          <UsageBar
            total={barTotal}
            topLeftLabel={absorve ? "Com a Meta dentro da mensalidade" : "Meta fora da mensalidade"}
            topRightLabel={`${brl(preco)} · margem ${pct(margemPiloto)}`}
            segments={segments}
          />
          <Text size="small" tone="tertiary">
            {`Roxo IA ${brl(piloto.ai, 2)} · cinza infra ${brl(piloto.infra, 0)} · vermelho remessa ${brl(piloto.remessa, 2)} · azul suporte ${brl(piloto.suporte, 0)} · amarelo onboarding ${brl(piloto.onboarding, 0)} · rosa imposto da nota ${brl(imposto, 0)}${absorve ? ` · laranja Meta ${brl(piloto.waNoTredane, 0)}` : ""} · verde o que sobra ${brl(Math.max(0, contribPiloto), 0)}.`}
          </Text>
          <Grid columns={2} gap={12}>
            <Field label="Mensalidade testada (R$)" value={preco} onChange={touch(setPreco)} />
            <Field
              label="Custo da hora de suporte (R$)"
              hint="Hipótese de hora de alguém da operação."
              value={custoHora}
              onChange={touch(setCustoHora)}
            />
          </Grid>
          <Select
            value={regime}
            onChange={(v) => setRegime(v as RegimeId)}
            options={[
              { value: "v", label: "Simples Anexo V · folha abaixo de 28%" },
              { value: "iii", label: "Simples Anexo III · fator R de 28% ou mais" },
              { value: "lp2", label: "Lucro Presumido · ISS 2%" },
              { value: "lp5", label: "Lucro Presumido · ISS 5%" },
              { value: "manual", label: "Alíquota manual" },
            ]}
          />
          {regime === "manual" ? (
            <Field
              label="Alíquota sobre a nota (%)"
              hint="Incide na mensalidade inteira."
              value={manualPct}
              onChange={setManualPct}
            />
          ) : (
            <Text size="small" tone="tertiary">
              {`Alíquota efetiva nesta base: ${pct1(aliquota)}. No Simples ela segue a receita dos 12 meses (${brl(rbt12)}), não a clínica isolada.`}
            </Text>
          )}
          <Table
            headers={["Linha", "Piloto", "Regime", "Quem paga"]}
            columnAlign={["left", "right", "right", "left"]}
            rowTone={["neutral", "neutral", "danger", "warning", "info", "neutral", "warning", "success"]}
            rows={[
              ["IA, Haiku 5.5 e Sonnet 5.5", brl(piloto.ai, 2), brl(estavel.ai, 2), "Tredane"],
              ["Infra Cloudflare", brl(piloto.infra, 2), brl(estavel.infra, 2), "Tredane"],
              [
                "Tributos da remessa em dólar",
                brl(piloto.remessa, 2),
                brl(estavel.remessa, 2),
                "Tredane, fora do DAS",
              ],
              ["Suporte", brl(piloto.suporte, 0), brl(estavel.suporte, 0), "Tredane"],
              ["Onboarding diluído em 12 meses", brl(piloto.onboarding, 0), brl(0), "Tredane"],
              [
                "WhatsApp service + utility",
                brl(piloto.meta, 2),
                brl(estavel.meta, 2),
                absorve ? "Tredane" : "Clínica",
              ],
              ["Imposto sobre a nota", brl(imposto, 0), brl(imposto, 0), "Tredane"],
              ["O que sobra da mensalidade", brl(contribPiloto, 0), brl(contribRegime, 0), ""],
            ]}
          />
          <Text size="small" tone="tertiary">
            Piloto = suporte alto + onboarding diluído. Regime = suporte baixo, onboarding já pago.
            O primeiro mês tira as horas de onboarding inteiras do caixa; a tabela mostra a média.
          </Text>
        </Stack>
      </Grid>

      <Divider />

      <Stack gap={8}>
        <H2>O que sobra por clínica em cada preço, depois do imposto (R$/mês)</H2>
        <BarChart
          categories={ladderPrices.map((price) => brl(price))}
          series={[
            { name: "Sobra no piloto", data: ladderPiloto, tone: "info" },
            { name: "Sobra em regime", data: ladderRegime, tone: "success" },
          ]}
          height={240}
          beginAtZero={ladderMin >= 0}
          valuePrefix="R$ "
          showValues
        />
        <Text size="small" tone="tertiary">
          Eixo horizontal: mensalidade. Eixo vertical: reais que sobram por clínica depois do
          imposto desta alíquota e do custo do Tredane. Fonte: premissas do painel, LC 123/2006,
          cartão Meta de 1/out/2026 e preços públicos da Anthropic para Haiku 5.5 e Sonnet 5.5.
        </Text>
      </Stack>

      <Stack gap={8}>
        <H2>O mesmo perfil em quatro regimes, a R$ 497</H2>
        <Text tone="secondary">
          Alíquota com a quantidade de clínicas pagantes deste painel. A última coluna é o degrau
          em que ainda sobram 60% da nota no piloto, depois do imposto.
        </Text>
        <Table
          headers={["Regime", "Alíquota", "Sobra no piloto", "Percentual da nota", "Degrau de 60%"]}
          columnAlign={["left", "right", "right", "right", "right"]}
          rows={regimeRows}
          striped
        />

        <H2>Três clínicas no regime selecionado</H2>
        <Text tone="secondary">
          Cada linha sobe ao degrau que ainda deixa 60% da nota no piloto, já com este imposto. A
          conta Meta continua fora da nota quando a clínica paga o número dela.
        </Text>
        <Table
          headers={[
            "Perfil",
            "Mensalidade",
            "Custo piloto",
            "Imposto",
            "Sobra no piloto",
            "Sobra em regime",
            "Conta Meta",
          ]}
          columnAlign={["left", "right", "right", "right", "right", "right", "right"]}
          rows={presetRows}
          striped
        />
      </Stack>

      <Stack gap={8}>
        <H3>O que isso paga da empresa</H3>
        <Grid columns={4} gap={12}>
          <Field label="Custo fixo mensal (R$)" hint="Ferramentas e retirada, fora da clínica." value={burn} onChange={setBurn} />
          <Field label="Clínicas pagantes" value={clinicas} onChange={setClinicas} />
          <Field label="Câmbio (R$ por US$)" value={fx} onChange={touch(setFx)} />
          <Field
            label="Infra por clínica (US$)"
            hint="Parcela variável. O mínimo da conta Cloudflare fica no custo fixo."
            value={infraUsd}
            onChange={touch(setInfraUsd)}
          />
        </Grid>
        <Row gap={24} wrap>
          <Stat value={clinicsFor(contribPiloto)} label={`Clínicas para cobrir ${brl(burn)} no piloto`} />
          <Stat
            value={clinicsFor(contribRegime)}
            label={`Clínicas para cobrir ${brl(burn)} em regime`}
            tone="success"
          />
          <Stat
            value={brl(clinicas * contribRegime)}
            label={`Contribuição em regime com ${clinicas} clínicas`}
          />
        </Row>
      </Stack>

      <Divider />

      <Stack gap={8}>
        <H2>Premissas e o que ficou de fora</H2>
        <Text>
          Cada chamada de Haiku 5.5 entra com 2.500 tokens a US$ 0,10 por milhão e sai com 600
          (thinking incluído) a US$ 0,50. Sonnet 5.5, só no «gerar outra» do painel, entra com
          4.000 a US$ 2 e sai com 800 a US$ 10. O teto de 300 rascunhos por dia por clínica, no
          Haiku, fica na casa de dezenas de reais mesmo no mês cheio.
        </Text>
        <Text>
          Service da Meta: R$ 0,035 a partir da mensagem 1.001 de cada número, por mês. Utility no
          mesmo valor. As 1.000 primeiras de serviço são grátis e não acumulam. Marketing, a R$
          0,3217, não entra: campanha e lembrete de retorno estão fora deste recorte.
        </Text>
        <Text>
          Referência de mercado em novembro de 2026, páginas públicas: Trinks R$ 55 a R$ 146
          conforme a equipe, WhatsApp à parte; Clinicorp Standard na casa de R$ 112 a R$ 160, com
          prontuário e financeiro; Belle com módulo de WhatsApp citado a R$ 229 em cima do sistema;
          Atendize de R$ 197 (até 3 atendentes) a R$ 397 com agenda e IA, e R$ 497 com Pix. O
          recorte do Tredane está perto dessa última faixa: WhatsApp oficial, agenda, pipeline e
          sinal Pix. Prontuário, estoque e nota fiscal não estão na entrega.
        </Text>
        <Text>
          O caso-base de imposto da nota é o Simples Anexo V na primeira faixa: 15,5% da mensalidade,
          enquanto a receita dos 12 meses ficar até R$ 180 mil e a folha ficar abaixo de 28% da
          receita. Essa alíquota não diminui por causa da Cloudflare. No Simples e no Lucro
          Presumido o custo da nuvem não abate o imposto da receita. Com fator R de 28% ou mais, a
          primeira faixa do Anexo III é 6%. Lucro Presumido aqui é ISS da cidade mais 11,33% (PIS,
          COFINS, IRPJ e CSLL sobre presunção de 32%).
        </Text>
        <Text>
          Cloudflare e Anthropic são fatura em dólar. Por cima dela, fora do DAS, o caso-base soma
          IOF de 3,5%, IRRF de 15% com gross-up (o fornecedor recebe o valor cheio), CIDE de 10% no
          enquadramento de SaaS como serviço técnico, PIS/Cofins-Importação de 9,25% e ISS de 2%.
          Dá cerca de 47% a mais sobre essa fatura. A leitura de licença sem CIDE, e a de só IOF,
          estão no seletor. A classificação de nuvem como serviço técnico ou como licença segue em
          aberto. A Meta, quando a clínica paga o número, é boleto da Facebook Brasil em reais: não
          entra nessa remessa. O repasse de PIS/Cofins de 9,25% e ISS de 2,9% que a Meta anunciou
          para 2026 vale para anúncio, não para o cartão de mensagem da API.
        </Text>
        <Text tone="secondary">
          Em aberto: o regime em si. O Tredane ainda não tem CNPJ (VAL-13), então Anexo V, Anexo
          III ou Lucro Presumido é hipótese, não enquadramento. Também seguem em aberto as horas
          reais de suporte, o volume de conversas e quem paga a Meta (DEC-009 deixa a conta com a
          clínica). A tarifa de AI Provider da Meta vale para assistente de propósito geral; o
          caso-base trata a clínica como empresa normal. Sinal Pix não gera receita do Tredane
          (DEC-047). Câmbio de R$ 5,40 por dólar é hipótese. Isto não substitui um contador.
        </Text>
      </Stack>
    </Stack>
  );
}
