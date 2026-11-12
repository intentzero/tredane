import {
  Ban,
  CalendarCheck,
  CalendarPlus,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  CircleAlert,
  Clock,
  EllipsisVertical,
  Info,
  Maximize2,
  MousePointerClick,
  RefreshCw,
  Send,
  SendHorizontal,
  Sparkles,
  UserCheck,
  X,
} from "lucide-react";
import { Fragment, useEffect, useId, useRef, useState } from "react";
import {
  eventConversationId,
  eventDeletesConversation,
  useInboxRealtime,
} from "../../realtime/InboxRealtime";
import {
  Button,
  Dialog,
  Heading,
  Menu,
  MenuItem,
  MenuTrigger,
  Modal,
  ModalOverlay,
  Popover,
  Separator,
  TextArea,
  TextField,
} from "react-aria-components";
import type {
  AiSuggestion,
  InboxConversationDetail,
  InboxMessage,
  PanelApi,
  PixChargeDetail,
  PixPaymentAlert,
  WhatsappTemplateItem,
} from "../../api";
import { PanelApiError } from "../../api";
import { useClinicTimezone } from "../../clinicTimezone";
import { awaitingClinicReply } from "./lastRelevant";
import { BlockContactDialog } from "./BlockContactDialog";
import { DeleteContactDialog } from "./DeleteContactDialog";
import {
  ThreadActionsSheet,
  startsGroup,
  type ThreadAction,
} from "./ThreadActionsSheet";
import { TransferSheet } from "./TransferSheet";
import { PixPendingBar, PixPendingSheet } from "./PixPendingSheet";
import { useMediaQuery } from "../../ui/useMediaQuery";
import { AiWorking } from "../../ui/AiWorking";
import { navigatePanel } from "../../routes";
import { ErrorState } from "../../states/StatusScreens";
import {
  assigneeLine,
  avatarTone,
  contactLabel,
  dayLabel,
  deliveryLabel,
  initials,
  sameDay,
  windowHint,
  windowHintShort,
  statusTone,
  statusLabel,
} from "./format";
import { waitingLabel } from "./urgency";
import { friendlyError } from "../../copy/errors";
import { Badge } from "../../states/Badge";
import { Banner } from "../../states/Banner";
import {
  staffFirstNameFromDisplay,
  synthStaffFirstName,
} from "../../auth/staffDisplayName";

type Props = {
  tenantId: string;
  conversationId: string;
  api: PanelApi;
  generation: number;
  viewerClerkUserId: string;
  /**
   * DEC-088: primeiro nome / apresentação (Clerk). Se omitido, usa persona sintética.
   * Nunca passar o rótulo do papel.
   */
  staffDisplayName?: string | null;
  /** Só owner vê e executa exclusão (clinic.contacts.delete / REQ-071). */
  isOwner?: boolean;
  /** Desktop: o contato é um painel que desliza por cima (abre e fecha por este controlo). */
  contactPanel?: { open: boolean; controlsId: string; onToggle: () => void };
  /** Desktop (DEC-074): «Agendar» abre um painel ao lado da conversa em vez de trocar de área. */
  agendarPanel?: { open: boolean; controlsId: string; onToggle: () => void };
};

function deleteContactErrorMessage(err: unknown): string {
  if (err instanceof PanelApiError) {
    if (err.code === "permission_denied" || err.status === 403) {
      return "Só o responsável pode excluir contatos.";
    }
    if (err.status === 404) {
      return "Contato já não está disponível.";
    }
    if (err.status === 409) {
      return "Não foi possível excluir agora. Tente de novo.";
    }
  }
  return "Não foi possível excluir o contato. Tente de novo.";
}

/** Remetente na primeira bolha enviada de um grupo; a IA aparece como «Assistente IA». */
function senderLabel(author: string | null): string | null {
  if (!author) return null;
  return author === "IA" ? "Assistente IA" : author;
}

/** Mesma sequência: mesmo lado, mesmo autor e mesmo dia, sem aviso de sistema no meio. */
function continuesGroup(prev: InboxMessage | undefined, m: InboxMessage): boolean {
  if (!prev || prev.direction === "system" || m.direction === "system") return false;
  if (prev.direction !== m.direction) return false;
  if (!sameDay(prev.createdAt, m.createdAt)) return false;
  return m.direction === "inbound" || prev.authorDisplayName === m.authorDisplayName;
}

/** Texto sempre como nó React — nunca HTML (XSS / conteúdo externo). */
function PlainText({ text }: { text: string }) {
  return <>{text}</>;
}

/** DEC-161: «[Botão] Confirmar» da cliente vira evento discreto. */
const BUTTON_TAP = /^\[Botão\]\s*(.+)$/;
/** DEC-161: confirmação de marcação enviada pelo sistema vira cartão «Agendado». */
const BOOKED = /^Agendado:\s*([\s\S]+)$/;
/** Linhas «Rótulo: valor» curtas (Serviço, Quando, Duração…) viram grade no cartão. */
const FIELD_LINE = /^([A-ZÀ-Ú][\p{L} ]{1,18}):\s+(.+)$/u;

function splitFields(body: string): {
  fields: { label: string; value: string }[];
  rest: string;
} {
  const fields: { label: string; value: string }[] = [];
  const rest: string[] = [];
  for (const line of body.split("\n")) {
    const f = FIELD_LINE.exec(line.trim());
    if (f) fields.push({ label: f[1]!, value: f[2]! });
    else rest.push(line);
  }
  return { fields, rest: rest.join("\n").trim() };
}

function timeOf(ms: number): string {
  return new Date(ms).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function DeliveryIcon({ state }: { state: string }) {
  const props = {
    "aria-hidden": true,
    size: 14,
    strokeWidth: 2,
    className: "inbox-delivery-icon",
  } as const;
  switch (state) {
    case "pending":
      return <Clock {...props} />;
    case "accepted":
      return <Check {...props} />;
    case "delivered":
    case "read":
      return <CheckCheck {...props} />;
    case "failed":
    case "unknown":
      return <CircleAlert {...props} />;
    default:
      return null;
  }
}

function MessageBubble({
  m,
  onRetry,
  busy,
  showReadBy = false,
  first = true,
  contactName = "A cliente",
}: {
  m: InboxMessage;
  onRetry?: (m: InboxMessage) => void;
  busy: boolean;
  showReadBy?: boolean;
  /** Primeira bolha de uma sequência do mesmo lado e autor: leva a cauda e o remetente. */
  first?: boolean;
  /** Primeiro nome da cliente, para o evento «{nome} tocou X». */
  contactName?: string;
}) {
  if (m.direction === "system") {
    return (
      <div className="inbox-msg-system" role="status">
        <PlainText text={m.body} />
      </div>
    );
  }
  const tap = m.direction === "inbound" ? BUTTON_TAP.exec(m.body.trim()) : null;
  if (tap) {
    return (
      <div className="inbox-msg-event">
        <MousePointerClick aria-hidden size={14} strokeWidth={2} />
        <span>
          {contactName} tocou <strong>{tap[1]}</strong>
        </span>
        <span className="inbox-msg-event-time">{timeOf(m.createdAt)}</span>
      </div>
    );
  }
  const outbound = m.direction === "outbound";
  const booked = outbound ? BOOKED.exec(m.body.trim()) : null;
  const structured = outbound && !booked ? splitFields(m.body) : null;
  const isCard = structured != null && structured.fields.length >= 3;
  const failed = outbound && m.deliveryState === "failed";
  const unknown = outbound && m.deliveryState === "unknown";
  const delivery = outbound ? deliveryLabel(m.deliveryState) : null;
  const stateClass = failed
    ? " inbox-delivery-failed"
    : unknown
      ? " inbox-delivery-unknown"
      : m.deliveryState === "read"
        ? " inbox-delivery-read"
        : "";
  const sender = outbound && first ? senderLabel(m.authorDisplayName) : null;
  return (
    <div
      className={`inbox-msg ${outbound ? "inbox-msg-out" : "inbox-msg-in"}${first ? " inbox-msg--first" : ""}`}
    >
      <div
        className={`inbox-msg-bubble${failed ? " inbox-msg-bubble--failed" : ""}${booked ? " inbox-msg-bubble--booked" : ""}${isCard ? " inbox-msg-bubble--card" : ""}`}
      >
        {sender ? (
          <span
            className={`inbox-msg-sender${m.authorDisplayName === "IA" ? " inbox-msg-sender--ai" : ""}`}
          >
            {sender}
          </span>
        ) : null}
        {booked ? (
          <p className="inbox-msg-booked-head">
            <CalendarCheck aria-hidden size={16} strokeWidth={2} />
            Agendado
          </p>
        ) : null}
        {isCard && structured ? (
          <dl className="inbox-msg-fields">
            {structured.fields.map((f) => (
              <div key={f.label} className="inbox-msg-field">
                <dt>{f.label}</dt>
                <dd>
                  <PlainText text={f.value} />
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        <p className="inbox-msg-body">
          <PlainText
            text={
              booked ? booked[1]! : isCard && structured ? structured.rest : m.body
            }
          />
          <span className="inbox-msg-meta">
            {new Date(m.createdAt).toLocaleTimeString("pt-BR", {
              hour: "2-digit",
              minute: "2-digit",
            })}
            {delivery ? (
              <span className={`inbox-delivery${stateClass}`}>
                <DeliveryIcon state={m.deliveryState} />
                <span className="inbox-delivery-text">{delivery}</span>
              </span>
            ) : null}
          </span>
        </p>
      </div>
      {failed && onRetry ? (
        <Button
          className="inbox-msg-retry"
          onPress={() => onRetry(m)}
          isDisabled={busy}
        >
          Tentar de novo
        </Button>
      ) : null}
      {showReadBy && m.readAt ? (
        <span className="inbox-msg-readby">
          Vista por {m.readByDisplayName ?? "equipe"} ·{" "}
          {new Date(m.readAt).toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      ) : null}
      {unknown ? (
        <span className="inbox-msg-unknown-hint" role="status">
          Estamos conferindo se foi enviada. Aguarde um instante.
        </span>
      ) : null}
    </div>
  );
}

type LocalOutbound = {
  localId: string;
  body: string;
  aiSuggestionId: string | null;
  createdAt: number;
  status: "sending" | "failed";
};

function localToMessage(
  o: LocalOutbound,
  d: { tenantId: string; id: string },
): InboxMessage {
  return {
    id: o.localId,
    tenantId: d.tenantId,
    conversationId: d.id,
    direction: "outbound",
    body: o.body,
    externalMessageId: null,
    deliveryState: o.status === "sending" ? "pending" : "failed",
    authorClerkUserId: null,
    authorDisplayName: null,
    createdAt: o.createdAt,
  };
}

/** Esqueleto da conversa (cabeçalho + bolhas) no lugar do spinner. */
function ThreadSkeleton() {
  return (
    <div
      className="inbox-thread inbox-thread-skeleton"
      role="status"
      aria-busy="true"
    >
      <span className="panel-sr-only">Abrindo conversa…</span>
      <div className="inbox-thread-header" aria-hidden="true">
        <span className="panel-skeleton-avatar" />
        <span className="panel-skeleton-lines">
          <span className="panel-skeleton-line panel-skeleton-line--title" />
          <span className="panel-skeleton-line" />
        </span>
      </div>
      <div className="inbox-timeline" aria-hidden="true">
        {(["in", "out", "in", "out", "in"] as const).map((side, i) => (
          <span
            key={i}
            className={`inbox-skeleton-bubble inbox-skeleton-bubble--${side}`}
            style={{ width: `${[62, 48, 70, 40, 55][i]}%` }}
          />
        ))}
      </div>
      <div className="inbox-composer-wrap" aria-hidden="true">
        <div className="inbox-composer">
          <span className="inbox-skeleton-input" />
        </div>
      </div>
    </div>
  );
}

export function InboxThread({
  tenantId,
  conversationId,
  api,
  generation,
  viewerClerkUserId,
  staffDisplayName = null,
  isOwner = false,
  contactPanel,
  agendarPanel,
}: Props) {
  const authorDisplayName =
    staffFirstNameFromDisplay(staffDisplayName) ??
    synthStaffFirstName(viewerClerkUserId);
  const [detail, setDetail] = useState<InboxConversationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [templates, setTemplates] = useState<WhatsappTemplateItem[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [blockBusy, setBlockBusy] = useState(false);
  const [blockError, setBlockError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const narrow = useMediaQuery("(max-width: 767.98px)");
  // Datas e horas no fuso da clínica (Agenda → Horários).
  useClinicTimezone(api, tenantId, generation);
  const [selectedTemplate, setSelectedTemplate] =
    useState<WhatsappTemplateItem | null>(null);
  const [pixCharges, setPixCharges] = useState<PixChargeDetail[]>([]);
  const [pixSheetId, setPixSheetId] = useState<string | null>(null);
  const [pixAlerts, setPixAlerts] = useState<PixPaymentAlert[]>([]);
  const [templateParams, setTemplateParams] = useState<Record<string, string>>(
    {},
  );
  const [aiSuggestion, setAiSuggestion] = useState<AiSuggestion | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiUnavailable, setAiUnavailable] = useState(false);
  const [aiNotEnabled, setAiNotEnabled] = useState(false);
  const [activeSuggestionId, setActiveSuggestionId] = useState<string | null>(
    null,
  );
  // Rascunho automático da IA (nunca envia; nunca sobrescreve o que a atendente escreve).
  const [autoDraftState, setAutoDraftState] = useState<"idle" | "generating">(
    "idle",
  );
  const [pendingAutoDraft, setPendingAutoDraft] = useState<AiSuggestion | null>(
    null,
  );
  const [aiNotes, setAiNotes] = useState<string | null>(null);
  const [aiDraftTagged, setAiDraftTagged] = useState(false);
  const [aiNotesOpen, setAiNotesOpen] = useState(false);
  const [draftFullOpen, setDraftFullOpen] = useState(false);
  const [aiFallback, setAiFallback] = useState(false);
  const [aiCapReached, setAiCapReached] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const draftRef = useRef("");
  draftRef.current = draft;
  const seenSuggestionIdsRef = useRef<Set<string>>(new Set());
  const revealTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopReveal() {
    if (revealTimerRef.current) clearInterval(revealTimerRef.current);
    revealTimerRef.current = null;
    setRevealing(false);
  }

  /** Insere o rascunho no compositor revelando-o aos poucos (sem streaming real de tokens). */
  function insertDraft(s: AiSuggestion) {
    stopReveal();
    seenSuggestionIdsRef.current.add(s.id);
    setPendingAutoDraft(null);
    setActiveSuggestionId(s.id);
    setAiNotes(s.internalNotes?.trim() || null);
    setAiDraftTagged(true);
    const full = s.suggestedText;
    const reduced =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || full.length < 8) {
      setDraft(full);
      return;
    }
    let i = 0;
    setRevealing(true);
    setDraft("");
    revealTimerRef.current = setInterval(() => {
      i = Math.min(full.length, i + Math.max(2, Math.ceil(full.length / 40)));
      setDraft(full.slice(0, i));
      if (i >= full.length) stopReveal();
    }, 25);
  }

  useEffect(() => () => stopReveal(), []);

  async function refreshAiDraft(messages: InboxMessage[]) {
    try {
      const st = await api.getAiDraft(tenantId, conversationId, {
        generation,
        expectGeneration: () => generation,
      });
      setAiFallback(st.syntheticFallback === true);
      setAiCapReached(st.usage?.capReached === true);
      setAutoDraftState(st.job ? "generating" : "idle");
      const s = st.suggestion;
      if (
        !s ||
        s.origin !== "auto" ||
        s.status !== "pending" ||
        !s.suggestedText
      )
        return;
      if (seenSuggestionIdsRef.current.has(s.id)) return;
      // Só o rascunho da última mensagem da cliente ainda sem resposta.
      if (!awaitingClinicReply(messages)) return;
      const last = [...messages]
        .reverse()
        .find((m) => m.direction === "inbound");
      if (!last) return;
      if (s.replyToMessageId && s.replyToMessageId !== last.id) return;
      if (draftRef.current.trim() === "") insertDraft(s);
      else setPendingAutoDraft(s);
    } catch {
      /* rascunho automático é best-effort */
    }
  }

  const composerId = useId();
  const timelineRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const scrolledConversationRef = useRef<string | null>(null);
  const prevLastMessageIdRef = useRef<string | null>(null);
  // Faixa «N não lidas» ancorada na primeira não lida de quando a conversa abriu.
  const [unreadAnchor, setUnreadAnchor] = useState<{
    id: string;
    count: number;
  } | null>(null);
  // Mensagens recebidas abaixo da área visível (botão «↓ N»).
  const [belowCount, setBelowCount] = useState(0);
  // Envio de texto otimista: a bolha aparece já («Enviando…»); se falhar fica
  // «Não enviada · Tentar de novo» sem perder o texto.
  const [outbox, setOutbox] = useState<LocalOutbound[]>([]);

  async function load(opts?: { quiet?: boolean }) {
    const quiet = opts?.quiet === true;
    if (!quiet) {
      setLoading(true);
      setUnreadAnchor(null);
      setBelowCount(0);
    }
    setError(null);
    try {
      const res = await api.getInboxConversation(
        tenantId,
        conversationId,
        { messageLimit: 100 },
        { generation, expectGeneration: () => generation },
      );
      // DEC-160: `unread_count` pode já ser 0 (IA/equipe atendeu e limpou o
      // badge), mas o humano ainda não reviu — gatilho de mark_read / faixa
      // usa `messages.read_at`, não o contador de exibição.
      const humanUnreadInbound = res.messages.filter(
        (m) => m.direction === "inbound" && m.readAt == null,
      );
      if (!quiet && humanUnreadInbound.length > 0) {
        const first = humanUnreadInbound[0];
        setUnreadAnchor({
          id: first.id,
          count: humanUnreadInbound.length,
        });
      }
      setDetail(res);
      if (res.messagingWindow?.open && res.status !== "closed")
        void refreshAiDraft(res.messages);
      if (humanUnreadInbound.length > 0) {
        void api
          .markInboxRead(tenantId, conversationId, {
            generation,
            expectGeneration: () => generation,
          })
          .then((r) =>
            setDetail((prev) =>
              prev
                ? { ...prev, ...r.conversation, messages: prev.messages }
                : prev,
            ),
          )
          .catch(() => {
            /* leitura best-effort */
          });
      }
      if (!res.messagingWindow?.open) {
        void api
          .listWhatsappTemplates(tenantId, {
            generation,
            expectGeneration: () => generation,
          })
          .then((t) => setTemplates(t.items))
          .catch(() => setTemplates([]));
      }
      void api
        .listConversationPixCharges(tenantId, conversationId, {
          generation,
          expectGeneration: () => generation,
        })
        .then(setPixCharges)
        .catch(() => setPixCharges([]));
      void api
        .listPixPaymentAlerts(tenantId, conversationId, {
          generation,
          expectGeneration: () => generation,
        })
        .then(setPixAlerts)
        .catch(() => setPixAlerts([]));
    } catch (err) {
      // Refetch em tempo real falhado: manter a conversa visível (e o rascunho).
      if (quiet) return;
      setError(friendlyError(err, "Não foi possível abrir esta conversa."));
      setDetail(null);
    } finally {
      if (!quiet) setLoading(false);
    }
  }

  useEffect(() => {
    setOutbox([]);
    stopReveal();
    setPendingAutoDraft(null);
    setAiNotes(null);
    setAiDraftTagged(false);
    seenSuggestionIdsRef.current = new Set();
    void load();
  }, [tenantId, conversationId, generation]);

  // Como no WhatsApp: ao abrir, vai para a primeira não lida (com a faixa) ou
  // para o fim; mensagem nova rola até ela se a pessoa já estava no fim ou se
  // foi ela quem enviou. Quem subiu para ler o histórico não é puxado de volta:
  // aparece o botão «↓ N» com a contagem das recebidas.
  const lastMessage = detail?.messages[detail.messages.length - 1];
  const lastMessageId = lastMessage?.id;
  const lastMessageOutbound = lastMessage?.direction === "outbound";
  useEffect(() => {
    const el = timelineRef.current;
    if (!el || !detail || !lastMessageId) return;
    const opened = scrolledConversationRef.current !== conversationId;
    scrolledConversationRef.current = conversationId;
    const prevId = prevLastMessageIdRef.current;
    prevLastMessageIdRef.current = lastMessageId;
    if (opened) {
      const divider = el.querySelector<HTMLElement>("[data-unread-divider]");
      if (divider && unreadAnchor) {
        el.scrollTop = Math.max(0, divider.offsetTop - 16);
        stickToBottomRef.current = false;
        setBelowCount(unreadAnchor.count);
      } else {
        el.scrollTop = el.scrollHeight;
        stickToBottomRef.current = true;
      }
      return;
    }
    if (stickToBottomRef.current || lastMessageOutbound) {
      const smooth =
        typeof el.scrollTo === "function" &&
        !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      if (smooth) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      else el.scrollTop = el.scrollHeight;
      stickToBottomRef.current = true;
      setBelowCount(0);
      return;
    }
    const prevIndex = prevId
      ? detail.messages.findIndex((m) => m.id === prevId)
      : -1;
    const added = detail.messages
      .slice(prevIndex + 1)
      .filter((m) => m.direction === "inbound").length;
    if (added > 0) setBelowCount((n) => n + added);
  }, [conversationId, lastMessageId, lastMessageOutbound]);

  function scrollToLatest() {
    const el = timelineRef.current;
    if (!el) return;
    if (typeof el.scrollTo === "function") {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    } else {
      el.scrollTop = el.scrollHeight;
    }
    stickToBottomRef.current = true;
    setBelowCount(0);
  }

  // Tempo real: (re)ligação/aba visível ou evento desta conversa → refetch
  // silencioso. O rascunho (estado local) e o scroll não são tocados.
  // contact.deleted que inclui esta conversa: limpar (não quiet-swallow 404).
  useInboxRealtime((signals) => {
    const deletedHere = signals.some(
      (s) =>
        s.kind === "event" && eventDeletesConversation(s.event, conversationId),
    );
    if (deletedHere) {
      setDetail(null);
      setError("Este contato foi excluído. A conversa já não está disponível.");
      return;
    }
    const relevant = signals.some(
      (s) =>
        s.kind === "resync" || eventConversationId(s.event) === conversationId,
    );
    if (relevant) void load({ quiet: true });
  });

  // Correção manual da etapa (DEC-062): usa o mesmo caminho do Acompanhamento; nunca mexe na agenda (DEC-040).
  async function correctStage(toStage: "horario_proposto" | "perdido") {
    const opp = detail?.opportunity;
    if (!opp) return;
    setBusy(true);
    setNotice(null);
    try {
      await api.movePipelineStage(
        tenantId,
        opp.id,
        {
          toStage,
          expectedUpdatedAt: opp.updatedAt,
          note: "Correção manual na conversa",
        },
        { generation, expectGeneration: () => generation },
      );
      await load({ quiet: true });
    } catch (err) {
      setNotice(
        friendlyError(
          err,
          "Não foi possível corrigir a etapa. Nada foi alterado.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  async function refundAlert(a: PixPaymentAlert) {
    setBusy(true);
    setNotice(null);
    try {
      const result = await api.refundPixAlert(
        tenantId,
        a.id,
        { clientRequestId: crypto.randomUUID() },
        { generation, expectGeneration: () => generation },
      );
      if (result.refundConfirmed) {
        setNotice("Sinal devolvido.");
        setPixAlerts((prev) => prev.filter((x) => x.id !== a.id));
      } else if (result.uncertain) {
        setNotice(
          "Pedido de devolução enviado. O dinheiro ainda não voltou para a cliente; o status muda aqui quando voltar.",
        );
      } else {
        setNotice(
          result.charge.status === "refund_failed"
            ? "A devolução não deu certo. Tente de novo."
            : "Pedido de devolução enviado.",
        );
      }
      void api
        .listConversationPixCharges(tenantId, conversationId, {
          generation,
          expectGeneration: () => generation,
        })
        .then(setPixCharges)
        .catch(() => {});
      void api
        .listPixPaymentAlerts(tenantId, conversationId, {
          generation,
          expectGeneration: () => generation,
        })
        .then(setPixAlerts)
        .catch(() => {});
    } catch (err) {
      setNotice(friendlyError(err, "Não foi possível devolver o sinal."));
    } finally {
      setBusy(false);
    }
  }

  async function cancelCharge(c: PixChargeDetail) {
    setBusy(true);
    setNotice(null);
    try {
      await api.cancelPixCharge(
        tenantId,
        c.id,
        { clientRequestId: crypto.randomUUID() },
        { generation, expectGeneration: () => generation },
      );
      setNotice("Cobrança cancelada.");
      setPixCharges((prev) =>
        prev.map((x) => (x.id === c.id ? { ...x, status: "cancelled" } : x)),
      );
    } catch (err) {
      setNotice(friendlyError(err, "Não foi possível cancelar a cobrança."));
    } finally {
      setBusy(false);
    }
  }

  async function resumeAi() {
    if (!detail) return;
    setBusy(true);
    setNotice(null);
    try {
      await api.resumeInboxAi(tenantId, conversationId, {
        generation,
        expectGeneration: () => generation,
      });
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              aiReplyPause: null,
              assigneeClerkUserId: "system:ai-autodraft",
              assigneeDisplayName: "IA",
            }
          : prev,
      );
    } catch (err) {
      setNotice(
        friendlyError(err, "Não foi possível devolver a conversa à IA."),
      );
    } finally {
      setBusy(false);
    }
  }

  /** Abre a lista de modelos (janela fechada) e carrega-a na primeira vez. */
  function openTemplatePicker() {
    setPickerOpen(true);
    if (templates.length === 0) {
      void api
        .listWhatsappTemplates(tenantId, {
          generation,
          expectGeneration: () => generation,
        })
        .then((t) => setTemplates(t.items));
    }
  }

  /** DEC-162: assumir e, quando correu bem, abrir já a escolha de modelo. */
  async function assumeAndPickTemplate() {
    const ok = await assume();
    if (ok) openTemplatePicker();
  }

  async function assume(): Promise<boolean> {
    if (!detail) return false;
    setBusy(true);
    setNotice(null);
    try {
      const res = await api.assignInboxConversation(
        tenantId,
        conversationId,
        { expectedAssignmentVersion: detail.assignmentVersion },
        { generation, expectGeneration: () => generation },
      );
      if (res.versionMatched === false) {
        setNotice(
          `${res.conversation.assigneeDisplayName ?? "Outra pessoa"} assumiu esta conversa antes de você.`,
        );
      }
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              ...res.conversation,
              messages: [...prev.messages, res.systemMessage],
            }
          : prev,
      );
      // DEC-156: Assumir (`clearedAwaitingTeam`) limpa notifs da conversa.
      if (res.versionMatched !== false) {
        const { closeConversationNotifications } = await import(
          "../../notifications"
        );
        void closeConversationNotifications(tenantId, conversationId);
      }
      return res.versionMatched !== false;
    } catch (err) {
      setNotice(
        friendlyError(
          err,
          "Não foi possível assumir a conversa. Tente de novo.",
        ),
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function closeConv() {
    if (!detail) return;
    setBusy(true);
    try {
      const res = await api.closeInboxConversation(tenantId, conversationId, {
        generation,
        expectGeneration: () => generation,
      });
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              ...res.conversation,
              messages: [...prev.messages, res.systemMessage],
            }
          : prev,
      );
    } catch (err) {
      setNotice(
        friendlyError(
          err,
          "Não foi possível encerrar a conversa. Tente de novo.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  async function transferTo(member: {
    clerkUserId: string;
    displayName: string;
  }) {
    if (!detail) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await api.assignInboxConversation(
        tenantId,
        conversationId,
        {
          assigneeClerkUserId: member.clerkUserId,
          assigneeDisplayName: member.displayName,
          expectedAssignmentVersion: detail.assignmentVersion,
        },
        { generation, expectGeneration: () => generation },
      );
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              ...res.conversation,
              messages: [...prev.messages, res.systemMessage],
            }
          : prev,
      );
      setTransferOpen(false);
    } catch (err) {
      setNotice(
        friendlyError(
          err,
          "Não foi possível transferir a conversa. Tente de novo.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  async function unblockContact() {
    if (!detail) return;
    setBusy(true);
    try {
      await api.unblockInboxContact(tenantId, detail.contactId, {
        generation,
        expectGeneration: () => generation,
      });
      await load({ quiet: true });
    } catch (err) {
      setNotice(
        friendlyError(
          err,
          "Não foi possível desbloquear agora. Tente de novo.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  async function blockContact(reason: string | null) {
    if (!detail) return;
    setBlockBusy(true);
    setBlockError(null);
    try {
      await api.blockInboxContact(
        tenantId,
        detail.contactId,
        { reason },
        { generation, expectGeneration: () => generation },
      );
      setBlockOpen(false);
      await load({ quiet: true });
    } catch (err) {
      setBlockError(
        friendlyError(
          err,
          "Não foi possível bloquear agora. Tente de novo.",
        ),
      );
    } finally {
      setBlockBusy(false);
    }
  }

  async function deleteContact() {
    if (!detail) return;
    setDeleteBusy(true);
    setNotice(null);
    try {
      await api.deleteContact(tenantId, detail.contactId, {
        generation,
        expectGeneration: () => generation,
      });
      setDeleteOpen(false);
      navigatePanel({
        kind: "area",
        area: "conversas",
        tenantId,
        section: "lista",
      });
    } catch (err) {
      setDeleteOpen(false);
      setNotice(deleteContactErrorMessage(err));
    } finally {
      setDeleteBusy(false);
    }
  }

  async function requestAiSuggestion(parentSuggestionId?: string | null) {
    setAiBusy(true);
    setAiUnavailable(false);
    setNotice(null);
    try {
      const res = await api.suggestAiReply(
        tenantId,
        conversationId,
        {
          clientRequestId: crypto.randomUUID(),
          parentSuggestionId: parentSuggestionId ?? null,
          actorDisplayName: "Atendente",
        },
        { generation, expectGeneration: () => generation },
      );
      if (res.suggestion.status === "failed" || !res.suggestion.suggestedText) {
        setAiSuggestion(null);
        setAiUnavailable(true);
      } else if (parentSuggestionId && aiDraftTagged && !aiSuggestion) {
        // «Gerar outra» a partir do rascunho no compositor: substitui-o.
        insertDraft(res.suggestion);
      } else {
        setAiSuggestion(res.suggestion);
        setAiUnavailable(false);
      }
    } catch (err) {
      setAiSuggestion(null);
      if (
        err instanceof PanelApiError &&
        (err.code as string) === "ai_not_enabled"
      ) {
        setAiNotEnabled(true);
      } else if (
        err instanceof PanelApiError &&
        (err.code as string) === "ai_daily_cap_reached"
      ) {
        setAiCapReached(true);
      } else {
        setAiUnavailable(true);
      }
    } finally {
      setAiBusy(false);
    }
  }

  /** Descarta o rascunho que já está no compositor (sem tocar no que a atendente escreveu depois). */
  function discardDraftInComposer() {
    stopReveal();
    setDraft("");
    setAiDraftTagged(false);
    setAiNotes(null);
    setAiNotesOpen(false);
    setDraftFullOpen(false);
    setActiveSuggestionId(null);
  }

  async function discardAiSuggestion() {
    if (!aiSuggestion) {
      setAiSuggestion(null);
      return;
    }
    setAiBusy(true);
    try {
      await api.decideAiSuggestion(
        tenantId,
        aiSuggestion.id,
        {
          clientRequestId: crypto.randomUUID(),
          decision: "discard",
          actorDisplayName: "Atendente",
        },
        { generation, expectGeneration: () => generation },
      );
    } catch {
      /* descarte local mesmo se a API falhar */
    } finally {
      setAiSuggestion(null);
      setActiveSuggestionId(null);
      setAiBusy(false);
    }
  }

  function useAndEditAiSuggestion() {
    if (!aiSuggestion) return;
    seenSuggestionIdsRef.current.add(aiSuggestion.id);
    setDraft(aiSuggestion.suggestedText);
    setActiveSuggestionId(aiSuggestion.id);
    setAiNotes(aiSuggestion.internalNotes?.trim() || null);
    setAiDraftTagged(true);
    setAiSuggestion(null);
  }

  // DEC-063: a atendente leu o texto completo e envia em 1 toque; a origem da sugestão fica registrada.
  async function sendAiSuggestion() {
    if (!aiSuggestion) return;
    seenSuggestionIdsRef.current.add(aiSuggestion.id);
    await sendPayload({
      body: aiSuggestion.suggestedText,
      aiSuggestionId: aiSuggestion.id,
    });
  }

  async function sendPayload(
    payload: {
      body?: string;
      template?: {
        name: string;
        language: string;
        params: Record<string, string>;
      };
      aiSuggestionId?: string | null;
    },
    opts?: { retryLocalId?: string },
  ) {
    if (!detail) return;
    const textOnly = Boolean(payload.body) && !payload.template;
    const aiSuggestionId = payload.aiSuggestionId ?? activeSuggestionId;
    const localId = textOnly
      ? (opts?.retryLocalId ?? `local:${crypto.randomUUID()}`)
      : null;
    if (localId) {
      const body = payload.body ?? "";
      setOutbox((prev) =>
        opts?.retryLocalId
          ? prev.map((o) =>
              o.localId === localId ? { ...o, status: "sending" } : o,
            )
          : [
              ...prev,
              {
                localId,
                body,
                aiSuggestionId,
                createdAt: Date.now(),
                status: "sending",
              },
            ],
      );
      // O texto já está na bolha: o campo fica livre para a próxima mensagem.
      setDraft("");
      setActiveSuggestionId(null);
      setAiNotes(null);
      setAiDraftTagged(false);
      setAiSuggestion(null);
      stickToBottomRef.current = true;
      requestAnimationFrame(() => {
        const el = timelineRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    }
    setBusy(true);
    setNotice(null);
    const clientRequestId = `client:${crypto.randomUUID()}`;
    try {
      const res = await api.sendInboxMessage(
        tenantId,
        conversationId,
        {
          ...payload,
          clientRequestId,
          aiSuggestionId,
          authorDisplayName: authorDisplayName ?? undefined,
        },
        { generation, expectGeneration: () => generation },
      );
      if (localId) {
        setOutbox((prev) => prev.filter((o) => o.localId !== localId));
      } else {
        setDraft("");
        setActiveSuggestionId(null);
        setAiNotes(null);
        setAiDraftTagged(false);
        setAiSuggestion(null);
      }
      setSelectedTemplate(null);
      setTemplateParams({});
      setPickerOpen(false);
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              ...res.conversation,
              messages: res.duplicate
                ? prev.messages
                : [...prev.messages, res.message],
            }
          : prev,
      );
    } catch (err) {
      if (localId) {
        setOutbox((prev) =>
          prev.map((o) =>
            o.localId === localId ? { ...o, status: "failed" } : o,
          ),
        );
      }
      setNotice(
        friendlyError(err, "A mensagem não foi enviada. Tente de novo."),
      );
    } finally {
      setBusy(false);
    }
  }

  async function retryLocal(o: LocalOutbound) {
    if (!detail?.messagingWindow?.open) {
      setNotice(
        "Passaram 24 horas desde a última mensagem da cliente. Use um modelo de mensagem para tentar de novo.",
      );
      setPickerOpen(true);
      return;
    }
    await sendPayload(
      { body: o.body, aiSuggestionId: o.aiSuggestionId },
      { retryLocalId: o.localId },
    );
  }

  async function send() {
    const body = draft.trim();
    if (!body || !detail) return;
    if (!detail.messagingWindow?.open) {
      setNotice(
        "Passaram 24 horas desde a última mensagem da cliente. Para voltar a falar com ela, envie um modelo de mensagem.",
      );
      return;
    }
    await sendPayload({ body });
  }

  async function sendTemplate() {
    if (!selectedTemplate) return;
    for (const key of selectedTemplate.paramKeys) {
      if (!templateParams[key]?.trim()) {
        setNotice(`Preencha o parâmetro: ${key}`);
        return;
      }
    }
    await sendPayload({
      template: {
        name: selectedTemplate.name,
        language: selectedTemplate.language,
        params: templateParams,
      },
    });
  }

  async function retryFailed(m: InboxMessage) {
    // Nova tentativa = nova intenção (REQ-013); não reutiliza clientRequestId.
    if (detail?.messagingWindow?.open) {
      await sendPayload({ body: m.body });
    } else {
      setNotice(
        "Passaram 24 horas desde a última mensagem da cliente. Use um modelo de mensagem para tentar de novo.",
      );
      setPickerOpen(true);
    }
  }

  if (loading && !detail) {
    return <ThreadSkeleton />;
  }
  if (error && !detail) {
    return (
      <ErrorState
        title="Conversa indisponível"
        description={error}
        actionLabel="Voltar à lista"
        onAction={() =>
          navigatePanel({
            kind: "area",
            area: "conversas",
            tenantId,
            section: "lista",
          })
        }
      />
    );
  }
  if (!detail) return null;
  // «Lida por» só sob a última mensagem da cliente já lida pela equipe.
  const lastReadInboundId =
    [...detail.messages]
      .reverse()
      .find((m) => m.direction === "inbound" && m.readAt)?.id ?? null;

  const label = contactLabel(detail.contact);
  const isMine =
    detail.assigneeClerkUserId != null &&
    detail.assigneeClerkUserId === viewerClerkUserId;
  const blocked = detail.contact?.blockedAt != null;
  // Confirmado (Paulo, 04/11/2026, Opção A): sem «Reservar bloco» no ⋮ —
  // agendamento a partir da conversa é só «Agendar» no cabeçalho.
  // Resumo da IA continua só no Contato / Detalhes.
  // Confirmado (Paulo, 10/11/2026, TR-488): Bloquear e Excluir também no ⋮ /
  // folha (depois de Encerrar), com o diálogo de confirmação do Contato.
  const threadActions: ThreadAction[] = [
    // Folha mobile: atalho à ficha (no desktop a ficha abre pelo nome, DEC-161).
    { id: "contact", label: "Ver contato", group: "contato" },
    // DEC-062: a etapa muda sozinha; aqui só as duas correções manuais.
    ...(detail.opportunity && detail.status !== "closed" && !blocked
      ? [
          ...(detail.opportunity.stage !== "horario_proposto"
            ? [
                {
                  id: "stage-proposed",
                  label: "Marcar como «Horário proposto»",
                  group: "etapa" as const,
                },
              ]
            : []),
          ...(detail.opportunity.stage !== "perdido"
            ? [
                {
                  id: "stage-lost",
                  label: "Marcar como perdida",
                  group: "etapa" as const,
                },
              ]
            : []),
        ]
      : []),
    ...(detail.status !== "closed" && !blocked
      ? [
          {
            id: "transfer",
            label: "Transferir para outra pessoa",
            group: "equipe" as const,
          },
        ]
      : []),
    ...(detail.status !== "closed"
      ? [{ id: "close", label: "Encerrar conversa", group: "equipe" as const }]
      : []),
    // DEC-159: ⋮ marcar/limpar revisão removido — análise via MCP central.
    // Destrutivas no fim: Bloquear (equipa) e Excluir (só owner / REQ-071).
    ...(!blocked
      ? [
          {
            id: "block",
            label: "Bloquear contato",
            danger: true,
            group: "risco" as const,
          },
        ]
      : []),
    ...(isOwner
      ? [
          {
            id: "delete",
            label: "Excluir contato",
            danger: true,
            group: "risco" as const,
          },
        ]
      : []),
  ];
  // DEC-161: no desktop a ficha abre pelo nome — «Ver contato» não entra no ⋮.
  const menuActions = narrow
    ? threadActions
    : threadActions.filter((a) => a.id !== "contact");
  const hasMenuActions = menuActions.length > 0;
  function runThreadAction(id: string) {
    if (id === "contact") {
      navigatePanel({
        kind: "area",
        area: "conversas",
        tenantId,
        section: "contato",
        conversationId: detail!.id,
        contactId: detail!.contactId,
      });
    }
    if (id === "stage-proposed") void correctStage("horario_proposto");
    if (id === "stage-lost") void correctStage("perdido");
    if (id === "transfer") setTransferOpen(true);
    if (id === "close") setConfirmClose(true);
    if (id === "block") {
      setBlockError(null);
      setBlockOpen(true);
    }
    if (id === "delete") setDeleteOpen(true);
  }
  const pendingPix =
    pixCharges.find((c) => c.status === "awaiting_payment") ?? null;
  const windowOpen = detail.messagingWindow?.open !== false && !blocked;
  // Última mensagem relevante nossa (ignora sistema/notas): sem «Sugerir resposta» nem sugestão automática.
  const canSuggest = awaitingClinicReply(detail.messages);
  const closesAt = detail.messagingWindow?.closesAt ?? null;
  const hint = windowHint(closesAt);
  // Menos de 1 h para fechar a janela: a pílula passa a aviso.
  const windowSoon = closesAt != null && closesAt - Date.now() < 60 * 60 * 1000;
  // DEC-161: estado de atendimento + alerta de handoff num só cartão, junto ao compositor.
  const needsPerson = (detail.pendingCommunications ?? []).filter(
    (c) => c.status === "alerted" || c.status === "open",
  );
  const canAssume = !isMine && detail.status !== "closed";
  const needsSince =
    needsPerson.length > 0
      ? Math.min(...needsPerson.map((c) => c.alertedAt ?? c.startedAt))
      : null;
  const needsMinutes =
    needsSince != null
      ? Math.max(1, Math.round((Date.now() - needsSince) / 60000))
      : null;
  const assignLine = detail.assigneeClerkUserId
    ? `${detail.assigneeDisplayName ?? "Outra pessoa"} está atendendo esta conversa.`
    : "Ninguém está atendendo esta conversa.";
  const contactFirstName = label.split(" ")[0] || "A cliente";
  // DEC-162: a cliente falou por último — a espera aparece sob o nome.
  const lastHuman = [...detail.messages]
    .reverse()
    .find((m) => m.direction !== "system");
  const waitingSince =
    detail.status !== "closed" && lastHuman?.direction === "inbound"
      ? lastHuman.createdAt
      : null;
  // DEC-162 (M-68): ninguém atende e a janela fechou — um só cartão, uma ação principal.
  const unassignedClosed =
    canAssume &&
    !detail.assigneeClerkUserId &&
    !windowOpen &&
    needsPerson.length === 0;
  const cardMode =
    windowOpen && aiDraftTagged && !!draft.trim() && !pendingAutoDraft;

  return (
    <div className="inbox-thread">
      <header className="inbox-thread-header">
        <Button
          className="panel-icon-btn inbox-thread-back"
          aria-label="Voltar às conversas"
          onPress={() =>
            navigatePanel({
              kind: "area",
              area: "conversas",
              tenantId,
              section: "lista",
            })
          }
        >
          <ChevronLeft aria-hidden size={22} strokeWidth={2} />
        </Button>
        <button
          type="button"
          className="inbox-thread-person"
          aria-label={`Informações de ${label}`}
          {...(contactPanel
            ? {
                "aria-expanded": contactPanel.open,
                "aria-controls": contactPanel.controlsId,
              }
            : {})}
          onClick={() =>
            contactPanel
              ? contactPanel.onToggle()
              : navigatePanel({
                  kind: "area",
                  area: "conversas",
                  tenantId,
                  section: "contato",
                  conversationId: detail.id,
                  contactId: detail.contactId,
                })
          }
        >
          <span
            className={`inbox-avatar inbox-avatar--sm inbox-avatar--${avatarTone(label)}`}
            aria-hidden
          >
            {initials(label)}
          </span>
          <span className="inbox-thread-who">
            <span className="inbox-thread-name">{label}</span>
            <span className="inbox-thread-sub">
              {/* Uma só etiqueta: a etapa (muda sozinha, DEC-062). O estado da conversa só aparece
                  quando é exceção (bloqueada/encerrada) ou quando não há oportunidade. */}
              {blocked ? (
                <Badge tone="closed">Bloqueado</Badge>
              ) : detail.opportunity && detail.status !== "closed" ? (
                <span className="inbox-stage-chip" role="status">
                  {detail.opportunity.label}
                </span>
              ) : (
                <Badge tone={statusTone(detail.status)}>
                  {statusLabel(detail.status)}
                </Badge>
              )}
              <span>{assigneeLine(detail, viewerClerkUserId)}</span>
              {waitingSince != null ? (
                <span className="inbox-thread-wait">{waitingLabel(waitingSince)}</span>
              ) : null}
            </span>
          </span>
        </button>
        {/* DEC-064: um único «Agendar», no cabeçalho, ao lado do ⋮. */}
        {detail.status !== "closed" && !blocked ? (
          <Button
            className={`panel-header-action panel-header-action--primary${agendarPanel ? " panel-header-action--toggle" : ""}`}
            aria-label="Agendar horário"
            isDisabled={busy}
            {...(agendarPanel
              ? {
                  "aria-pressed": agendarPanel.open,
                  "aria-controls": agendarPanel.controlsId,
                }
              : {})}
            onPress={() =>
              agendarPanel
                ? agendarPanel.onToggle()
                : navigatePanel({
                    kind: "area",
                    area: "agenda",
                    tenantId,
                    section: "agendar",
                    conversationId,
                    contactId: detail.contactId,
                  })
            }
          >
            <CalendarPlus aria-hidden size={20} strokeWidth={2} />
            <span>Agendar</span>
          </Button>
        ) : null}
        {hasMenuActions && narrow ? (
          <Button
            className="panel-icon-btn"
            aria-label="Mais opções da conversa"
            aria-haspopup="dialog"
            onPress={() => setActionsOpen(true)}
          >
            <EllipsisVertical aria-hidden size={22} strokeWidth={2} />
          </Button>
        ) : null}
        {hasMenuActions && !narrow ? (
          <MenuTrigger>
            <Button
              className="panel-icon-btn"
              aria-label="Mais opções da conversa"
            >
              <EllipsisVertical aria-hidden size={22} strokeWidth={2} />
            </Button>
            <Popover className="panel-popover" placement="bottom end">
              <Menu
                className="panel-menu"
                aria-label="Opções da conversa"
                onAction={(key) => runThreadAction(String(key))}
              >
                {menuActions.map((a, i) => (
                  <Fragment key={a.id}>
                    {startsGroup(menuActions, i) ? (
                      <Separator className="panel-menu-separator" />
                    ) : null}
                    <MenuItem
                      id={a.id}
                      className={`panel-menu-item${a.danger ? " panel-menu-item--danger" : ""}`}
                    >
                      {a.label}
                    </MenuItem>
                  </Fragment>
                ))}
              </Menu>
            </Popover>
          </MenuTrigger>
        ) : null}
      </header>

      {confirmClose ? (
        <div className="inbox-confirm">
          <Banner tone="warn" title="Encerrar esta conversa?" role="alert">
            <p>Se a cliente escrever de novo, a conversa abre outra vez.</p>
            <div className="inbox-confirm-actions">
              <Button
                className="panel-btn-primary panel-btn-compact"
                isDisabled={busy}
                onPress={() => {
                  setConfirmClose(false);
                  void closeConv();
                }}
              >
                Encerrar
              </Button>
              <Button
                className="panel-btn-ghost panel-btn-compact"
                autoFocus
                onPress={() => setConfirmClose(false)}
              >
                Cancelar
              </Button>
            </div>
          </Banner>
        </div>
      ) : null}

      {detail.aiReplyPause ? (
        <div className="inbox-assign" role="status">
          <p>A IA está pausada. Uma pessoa continua esta conversa.</p>
          <Button
            className="panel-btn-secondary panel-btn-compact"
            onPress={() => void resumeAi()}
            isDisabled={busy}
          >
            Devolver à IA
          </Button>
        </div>
      ) : null}


      <ThreadActionsSheet
        open={actionsOpen && narrow && hasMenuActions}
        title={`Conversa com ${label}`}
        actions={menuActions}
        onAction={runThreadAction}
        onClose={() => setActionsOpen(false)}
      />
      <TransferSheet
        open={transferOpen}
        tenantId={tenantId}
        api={api}
        generation={generation}
        viewerClerkUserId={viewerClerkUserId}
        currentAssigneeClerkUserId={detail.assigneeClerkUserId}
        busy={busy}
        onClose={() => setTransferOpen(false)}
        onPick={(m) => void transferTo(m)}
      />
      <BlockContactDialog
        open={blockOpen}
        contactLabel={label}
        busy={blockBusy}
        hasPendingPix={
          detail.contactHasPendingPix === true || pendingPix != null
        }
        error={blockError}
        onClose={() => {
          if (!blockBusy) setBlockOpen(false);
        }}
        onConfirm={(reason) => {
          void blockContact(reason);
        }}
      />
      <DeleteContactDialog
        open={deleteOpen}
        contactLabel={label}
        busy={deleteBusy}
        onClose={() => {
          if (!deleteBusy) setDeleteOpen(false);
        }}
        onConfirm={() => {
          void deleteContact();
        }}
      />
      {notice ? (
        <div className="inbox-notice" role="status">
          {notice}
          {!isMine && detail.status !== "closed" ? (
            <Button
              className="panel-btn-secondary"
              onPress={() => void assume()}
              isDisabled={busy}
            >
              Assumir mesmo assim
            </Button>
          ) : null}
        </div>
      ) : null}

      {pixAlerts.length > 0 ? (
        <div className="inbox-notice inbox-pix-alert" role="alert">
          {pixAlerts.map((a) => {
            const charge = pixCharges.find((c) => c.id === a.chargeId);
            const refundPending = charge?.status === "refund_requested";
            const refundFailed = charge?.status === "refund_failed";
            return (
              <div key={a.id} className="inbox-pix-card">
                <strong>Sinal pago, mas o horário foi ocupado</strong>
                <p>
                  {charge
                    ? (charge.amountCents / 100).toLocaleString("pt-BR", {
                        style: "currency",
                        currency: "BRL",
                      })
                    : "Pagamento registrado"}
                  {" · "}
                  {a.reason === "payment_after_expiry"
                    ? "pagamento após o prazo"
                    : a.reason === "slot_occupied"
                      ? "horário já reservado"
                      : "não foi possível confirmar o horário"}
                  {refundPending
                    ? " · devolução pedida (dinheiro ainda não devolvido)"
                    : refundFailed
                      ? " · a devolução não deu certo"
                      : ""}
                </p>
                <div className="clinic-actions">
                  <Button
                    className="panel-btn-primary"
                    onPress={() =>
                      navigatePanel({
                        kind: "area",
                        area: "agenda",
                        tenantId,
                        section: "agendar",
                        conversationId,
                        contactId: detail?.contactId,
                        alertId: a.id,
                      })
                    }
                    isDisabled={busy || refundPending}
                  >
                    Escolher outro horário
                  </Button>
                  <Button
                    className="panel-btn-secondary"
                    onPress={() => void refundAlert(a)}
                    isDisabled={busy || refundPending}
                  >
                    {refundFailed
                      ? "Tentar devolver de novo"
                      : "Devolver sinal"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {/* DEC-065: faixa compacta; o estado e as ações ficam na folha «Detalhes». */}
      {pendingPix ? (
        <PixPendingBar
          charge={pendingPix}
          onDetails={() => setPixSheetId(pendingPix.id)}
        />
      ) : null}
      <PixPendingSheet
        charge={
          pixCharges.find(
            (c) => c.id === pixSheetId && c.status === "awaiting_payment",
          ) ?? null
        }
        busy={busy}
        onClose={() => setPixSheetId(null)}
        onCopy={(c) => {
          void navigator.clipboard?.writeText(c.pixCopyPaste!);
          setPixSheetId(null);
          setNotice("Pix copiado");
        }}
        onCancel={(c) => void cancelCharge(c)}
      />

      {/* S4 / #175 — proposta versionada + H7 comunicação pendente (sinal mínimo; mocks Em aberto). */}
      {detail.activeProposal ? (
        <div
          className="inbox-notice"
          role="status"
          data-testid="proposal-panel"
        >
          <strong>
            Proposta v{detail.activeProposal.version} ·{" "}
            {detail.activeProposal.state}
          </strong>
          <p>
            {detail.activeProposal.serviceName}
            {detail.activeProposal.resultKind
              ? ` · resultado: ${detail.activeProposal.resultKind}`
              : ""}
            {detail.activeProposal.expiresAt
              ? ` · vale até ${new Date(detail.activeProposal.expiresAt).toLocaleString("pt-BR")}`
              : ""}
          </p>
        </div>
      ) : null}

      <div className="inbox-timeline-wrap">
        <div
          className="inbox-timeline"
          aria-live="polite"
          ref={timelineRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            const atBottom =
              el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            stickToBottomRef.current = atBottom;
            if (atBottom) setBelowCount(0);
          }}
        >
          {detail.messagesHasMore ? (
            <p className="inbox-timeline-more">
              Há mensagens mais antigas no histórico.
            </p>
          ) : null}
          {detail.messages.map((m, i) => (
            <Fragment key={m.id}>
              {i === 0 ||
              !sameDay(detail.messages[i - 1]!.createdAt, m.createdAt) ? (
                <div className="inbox-day">{dayLabel(m.createdAt)}</div>
              ) : null}
              {unreadAnchor?.id === m.id ? (
                <div className="inbox-unread-divider" data-unread-divider>
                  {unreadAnchor.count === 1
                    ? "1 mensagem não lida"
                    : `${unreadAnchor.count} mensagens não lidas`}
                </div>
              ) : null}
              <MessageBubble
                m={m}
                busy={busy}
                first={
                  unreadAnchor?.id === m.id ||
                  !continuesGroup(detail.messages[i - 1], m)
                }
                showReadBy={m.id === lastReadInboundId}
                contactName={contactFirstName}
                onRetry={m.deliveryState === "failed" ? retryFailed : undefined}
              />
            </Fragment>
          ))}
          {outbox.map((o, i) => (
            <MessageBubble
              key={o.localId}
              m={localToMessage(o, detail)}
              first={
                i === 0 &&
                detail.messages[detail.messages.length - 1]?.direction !==
                  "outbound"
              }
              busy={busy}
              onRetry={
                o.status === "failed" ? () => void retryLocal(o) : undefined
              }
            />
          ))}
        </div>
        {belowCount > 0 ? (
          <Button
            className="inbox-scroll-latest"
            aria-label={`Ir para as mensagens novas (${belowCount} não lidas)`}
            onPress={scrollToLatest}
          >
            <ChevronDown aria-hidden="true" size={22} strokeWidth={2} />
            <span className="inbox-scroll-latest-count" aria-hidden="true">
              {belowCount}
            </span>
          </Button>
        ) : null}
      </div>

      {unassignedClosed && !blocked ? (
        <section
          className="inbox-handoff inbox-handoff--closed"
          role="status"
          aria-labelledby="inbox-closed-title"
        >
          <div className="inbox-handoff-text">
            <strong id="inbox-closed-title">
              Ninguém respondeu · janela de 24 h fechada
            </strong>
            <p>
              Para voltar a falar com {contactFirstName}, o WhatsApp só aceita um
              modelo de mensagem aprovado.
            </p>
          </div>
          <Button
            className="panel-btn-primary inbox-handoff-btn"
            onPress={() => void assumeAndPickTemplate()}
            isDisabled={busy}
          >
            {busy ? "Assumindo…" : "Assumir e escolher modelo"}
          </Button>
          <Button
            className="panel-link-btn inbox-handoff-secondary"
            onPress={() => void assume()}
            isDisabled={busy}
          >
            Só assumir
          </Button>
        </section>
      ) : needsPerson.length > 0 || canAssume ? (
        <div
          className={`inbox-handoff${needsPerson.length > 0 ? " inbox-handoff--alert" : ""}`}
          role={needsPerson.length > 0 ? "alert" : "status"}
          {...(needsPerson.length > 0
            ? { "data-testid": "pending-comm-panel" }
            : {})}
        >
          <span className="inbox-handoff-icon" aria-hidden>
            <UserCheck size={18} strokeWidth={2} />
          </span>
          <div className="inbox-handoff-text">
            {needsPerson.length > 0 ? (
              <>
                <strong>
                  Precisa de alguém
                  {needsMinutes != null ? ` · há ${needsMinutes} min` : ""}
                </strong>
                {needsPerson.map((c) => (
                  <p key={c.id}>{c.detailText || c.kind}</p>
                ))}
                {canAssume ? <p>{assignLine}</p> : null}
              </>
            ) : (
              <p>{assignLine}</p>
            )}
          </div>
          {canAssume ? (
            <Button
              className="panel-btn-primary panel-btn-compact inbox-handoff-btn"
              onPress={() => void assume()}
              isDisabled={busy}
            >
              {busy ? "Assumindo…" : "Assumir conversa"}
            </Button>
          ) : null}
        </div>
      ) : null}

      {blocked ? (
        <div className="inbox-blocked" role="status">
          <p>
            <Ban aria-hidden size={20} strokeWidth={2} />
            Contato bloqueado. Mensagens novas deste número não aparecem no
            painel e não é possível responder.
          </p>
          <Button
            className="panel-btn-secondary"
            isDisabled={busy}
            onPress={() => void unblockContact()}
          >
            Desbloquear
          </Button>
        </div>
      ) : detail.status !== "closed" && !unassignedClosed ? (
        <div className="inbox-composer-wrap">
          <div className="inbox-dock">
            {aiNotEnabled ? (
              <div className="ai-block ai-block-unavailable" role="status">
                <p>
                  As sugestões com IA estão desligadas nesta clínica. O
                  responsável pode ativar em Clínica › Sugestões com IA.
                </p>
              </div>
            ) : null}
            {aiUnavailable ? (
              <div className="ai-block ai-block-unavailable" role="status">
                <p>
                  A sugestão não está disponível agora. Você pode responder
                  normalmente.
                </p>
              </div>
            ) : null}
            {aiSuggestion ? (
              <div
                className="ai-block"
                role="region"
                aria-label="Sugestão da IA"
              >
                <p className="ai-block-label">
                  Sugestão da IA — revise antes de enviar
                </p>
                {aiSuggestion.warningLabels.map((w) => (
                  <p key={w} className="ai-block-warn" role="status">
                    {w}
                  </p>
                ))}
                {aiSuggestion.sourceRefs.map((s) => (
                  <p key={s.serviceName} className="ai-block-source">
                    {s.label}
                  </p>
                ))}
                <p className="ai-block-text">
                  <PlainText text={aiSuggestion.suggestedText} />
                </p>
                {aiSuggestion.internalNotes ? (
                  <p className="ai-notes" role="note">
                    <span className="ai-notes-label">
                      Notas da IA para você (não são enviadas)
                    </span>
                    <PlainText text={aiSuggestion.internalNotes} />
                  </p>
                ) : null}
                <div className="ai-block-actions">
                  {windowOpen ? (
                    <Button
                      className="panel-btn-primary ai-btn ai-btn--send"
                      onPress={() => void sendAiSuggestion()}
                      isDisabled={aiBusy || busy}
                    >
                      Enviar
                    </Button>
                  ) : null}
                  <Button
                    className="panel-btn-secondary ai-btn"
                    onPress={() => useAndEditAiSuggestion()}
                    isDisabled={aiBusy || busy}
                  >
                    Editar
                  </Button>
                  <Button
                    className="panel-btn-secondary ai-btn ai-btn--icon"
                    aria-label="Gerar outra"
                    onPress={() => void requestAiSuggestion(aiSuggestion.id)}
                    isDisabled={aiBusy || busy}
                  >
                    <RefreshCw aria-hidden size={20} strokeWidth={2} />
                  </Button>
                  <Button
                    className="panel-btn-secondary ai-btn ai-btn--icon"
                    aria-label="Descartar"
                    onPress={() => void discardAiSuggestion()}
                    isDisabled={aiBusy || busy}
                  >
                    <X aria-hidden size={20} strokeWidth={2} />
                  </Button>
                </div>
              </div>
            ) : null}
            {aiFallback ? (
              <p className="ai-banner" role="status">
                IA em modo de teste: a chave do provedor não está configurada,
                por isso as sugestões são fictícias. Avise o responsável.
              </p>
            ) : null}
            {aiCapReached ? (
              <p className="ai-banner" role="status">
                Limite diário de rascunhos da IA atingido nesta clínica. As
                sugestões voltam amanhã; você pode responder normalmente.
              </p>
            ) : null}
            <div className="inbox-dock-pills">
              {!windowOpen ? (
                <p
                  className="inbox-window-banner inbox-window-banner--soon"
                  role="status"
                >
                  <Clock aria-hidden size={14} strokeWidth={2} />
                  Passaram 24 horas: use um modelo de mensagem
                </p>
              ) : null}
              {windowOpen && hint && windowSoon ? (
                <p
                  className="inbox-window-banner inbox-window-banner--soon"
                  role="status"
                >
                  <Clock aria-hidden size={14} strokeWidth={2} />
                  {hint}
                </p>
              ) : null}
              {windowOpen &&
              canSuggest &&
              (autoDraftState === "generating" || pendingAutoDraft) ? (
                <div className="inbox-ai-status">
                  {autoDraftState === "generating" &&
                  !pendingAutoDraft &&
                  !aiDraftTagged ? (
                    <AiWorking label="IA escrevendo um rascunho…" />
                  ) : null}
                  {pendingAutoDraft ? (
                    <Button
                      className="inbox-ai-chip"
                      aria-label="Sugestão pronta, inserir no lugar do texto atual"
                      onPress={() => insertDraft(pendingAutoDraft)}
                    >
                      <Sparkles aria-hidden size={14} strokeWidth={2} />
                      Sugestão pronta · inserir
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
            {windowOpen ? (
              <form
                className={`inbox-composer${cardMode ? " inbox-ai-card" : ""}`}
                onSubmit={(e) => {
                  e.preventDefault();
                  void send();
                }}
              >
                {cardMode ? (
                  <div className="inbox-ai-card-head">
                    {revealing || aiBusy ? (
                      <AiWorking
                        label={aiBusy ? "Gerando outra…" : "IA escrevendo…"}
                      />
                    ) : (
                      <span className="inbox-ai-draft-tag">
                        <Sparkles aria-hidden size={14} strokeWidth={2} />
                        Rascunho da IA
                        <span className="inbox-ai-draft-sub">
                          {" "}
                          · revise antes de enviar
                        </span>
                      </span>
                    )}
                    <Button
                      className="inbox-ai-icon"
                      aria-label="Ver rascunho em tela cheia"
                      onPress={() => setDraftFullOpen(true)}
                    >
                      <Maximize2 aria-hidden size={18} strokeWidth={2} />
                    </Button>
                    <Button
                      className="inbox-ai-icon"
                      aria-label="Descartar rascunho"
                      onPress={discardDraftInComposer}
                    >
                      <X aria-hidden size={18} strokeWidth={2} />
                    </Button>
                  </div>
                ) : null}
                {cardMode && aiNotes && aiNotesOpen ? (
                  <p className="ai-notes ai-notes--card" role="note">
                    <span className="ai-notes-label">
                      Nota para você · não é enviada
                    </span>
                    {aiNotes}
                  </p>
                ) : null}
                <TextField
                  className="inbox-composer-field"
                  aria-label="Mensagem"
                  value={draft}
                  onChange={(v) => {
                    if (revealing) stopReveal();
                    setDraft(v);
                    if (!v.trim() && aiDraftTagged) {
                      setAiDraftTagged(false);
                      setAiNotes(null);
                      setAiNotesOpen(false);
                      setActiveSuggestionId(null);
                    }
                  }}
                >
                  <TextArea
                    id={composerId}
                    className={`inbox-composer-input${cardMode ? " inbox-composer-input--card" : ""}`}
                    placeholder="Escreva uma mensagem"
                    rows={1}
                    // WebKit trata autocomplete="off" como tipo vazio e o iOS mostra a cápsula
                    // de senhas, cartão e morada. organization-title é um tipo concreto fora
                    // dessas três; o teclado e as sugestões de texto ficam os de uma textarea.
                    autoComplete="organization-title"
                    name="mensagem"
                    inputMode="text"
                    autoCorrect="on"
                    autoCapitalize="sentences"
                    spellCheck
                    data-form-type="other"
                    data-lpignore="true"
                    data-1p-ignore
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                        e.preventDefault();
                        void send();
                      }
                    }}
                  />
                </TextField>
                {cardMode ? (
                  <div className="inbox-ai-card-foot">
                    <Button
                      className="inbox-ai-foot-btn"
                      aria-label="Gerar outra"
                      onPress={() =>
                        void requestAiSuggestion(activeSuggestionId)
                      }
                      isDisabled={aiBusy || busy || revealing}
                    >
                      <RefreshCw aria-hidden size={16} strokeWidth={2} />
                      Outra
                    </Button>
                    {aiNotes ? (
                      <Button
                        className="inbox-ai-foot-btn"
                        aria-expanded={aiNotesOpen}
                        aria-label="Nota da IA para você"
                        onPress={() => setAiNotesOpen((o) => !o)}
                      >
                        <Info aria-hidden size={16} strokeWidth={2} />
                        Nota
                      </Button>
                    ) : null}
                    <span className="inbox-ai-foot-spacer" />
                    <Button
                      className="inbox-send inbox-send--label"
                      type="submit"
                      aria-label="Enviar"
                      isDisabled={busy || !draft.trim()}
                    >
                      Enviar
                      <Send aria-hidden size={16} strokeWidth={2} />
                    </Button>
                  </div>
                ) : (
                  <>
                    {/* DEC-161: prazo da janela discreto dentro da barra; pílula só com < 1 h. */}
                    {hint && !windowSoon ? (
                      <span className="inbox-composer-window" role="status">
                        <Clock aria-hidden size={14} strokeWidth={2} />
                        <span aria-hidden>{windowHintShort(closesAt)}</span>
                        <span className="panel-sr-only">{hint}</span>
                      </span>
                    ) : null}
                    {canSuggest &&
                    !aiSuggestion &&
                    autoDraftState !== "generating" ? (
                      <Button
                        className="inbox-composer-icon inbox-composer-icon--ai"
                        aria-label="Sugerir resposta com IA"
                        onPress={() => void requestAiSuggestion(null)}
                        isDisabled={aiBusy || busy}
                      >
                        {aiBusy ? (
                          <AiWorking compact label="Gerando sugestão…" />
                        ) : (
                          <Sparkles aria-hidden size={22} strokeWidth={1.8} />
                        )}
                      </Button>
                    ) : null}
                    <Button
                      className="inbox-send"
                      type="submit"
                      aria-label="Enviar"
                      isDisabled={busy || !draft.trim()}
                    >
                      <SendHorizontal aria-hidden size={20} strokeWidth={2} />
                    </Button>
                  </>
                )}
              </form>
            ) : (
              <div className="inbox-composer inbox-composer-template">
                <Button
                  className="panel-btn-primary"
                  onPress={() => {
                    if (pickerOpen) setPickerOpen(false);
                    else openTemplatePicker();
                  }}
                  isDisabled={busy}
                >
                  Escolher modelo
                </Button>
              </div>
            )}
          </div>

          <ModalOverlay
            isOpen={draftFullOpen && cardMode}
            onOpenChange={setDraftFullOpen}
            className="panel-overlay"
            style={{ position: "fixed", inset: 0, zIndex: 30 }}
            isDismissable
          >
            <Modal className="inbox-draft-full-modal">
              <Dialog
                className="inbox-draft-full"
                aria-labelledby="draft-full-title"
              >
                {({ close }) => (
                  <>
                    <header className="inbox-draft-full-head">
                      <Button
                        className="panel-icon-btn"
                        aria-label="Voltar para a conversa"
                        onPress={close}
                      >
                        <ChevronLeft aria-hidden size={22} strokeWidth={2} />
                      </Button>
                      <div className="inbox-draft-full-title">
                        <Heading slot="title" id="draft-full-title">
                          Resposta para {label}
                        </Heading>
                        <span>Rascunho da IA · revise antes de enviar</span>
                      </div>
                      <Button
                        className="inbox-ai-foot-btn"
                        aria-label="Gerar outra"
                        onPress={() =>
                          void requestAiSuggestion(activeSuggestionId)
                        }
                        isDisabled={aiBusy || busy || revealing}
                      >
                        <RefreshCw aria-hidden size={16} strokeWidth={2} />
                        Outra
                      </Button>
                    </header>
                    {aiNotes ? (
                      <p className="ai-notes ai-notes--card" role="note">
                        <span className="ai-notes-label">
                          Nota para você · não é enviada
                        </span>
                        {aiNotes}
                      </p>
                    ) : null}
                    <TextField
                      className="inbox-draft-full-field"
                      aria-label="Resposta"
                      value={draft}
                      onChange={setDraft}
                    >
                      <TextArea className="inbox-draft-full-input" />
                    </TextField>
                    <div className="inbox-draft-full-foot">
                      <Button className="panel-btn-secondary" onPress={close}>
                        Voltar
                      </Button>
                      <Button
                        className="panel-btn-primary"
                        isDisabled={busy || !draft.trim()}
                        onPress={() => {
                          close();
                          void send();
                        }}
                      >
                        Enviar para {label}
                      </Button>
                    </div>
                  </>
                )}
              </Dialog>
            </Modal>
          </ModalOverlay>

          <ModalOverlay
            isOpen={pickerOpen}
            onOpenChange={(next) => {
              if (!next && !busy) setPickerOpen(false);
            }}
            className="panel-overlay"
            style={{ position: "fixed", inset: 0, zIndex: 30 }}
            isDismissable={!busy}
          >
            <Modal>
              <Dialog
                className="panel-sheet inbox-template-picker"
                style={{ position: "fixed", left: 0, right: 0, bottom: 0 }}
                aria-labelledby="wa-template-title"
              >
                {({ close }) => (
                  <>
                    <span className="panel-sheet-handle" aria-hidden="true" />
                    <Heading
                      slot="title"
                      id="wa-template-title"
                      className="panel-title"
                      style={{ margin: "8px 0 2px" }}
                    >
                      Modelos WhatsApp
                    </Heading>
                    {templates.length === 0 ? (
                      <p className="panel-subtitle">
                        Nenhum modelo aprovado sincronizado.
                      </p>
                    ) : (
                      <ul className="inbox-template-list">
                        {templates.map((t) => (
                          <li key={`${t.name}:${t.language}`}>
                            <button
                              type="button"
                              className={
                                selectedTemplate?.name === t.name
                                  ? "inbox-template-item inbox-template-item-active"
                                  : "inbox-template-item"
                              }
                              aria-pressed={selectedTemplate?.name === t.name}
                              onClick={() => {
                                setSelectedTemplate(t);
                                const next: Record<string, string> = {};
                                for (const k of t.paramKeys)
                                  next[k] = templateParams[k] ?? "";
                                setTemplateParams(next);
                              }}
                            >
                              <strong>{t.name}</strong>
                              <span>
                                {t.category}
                                {t.pricingCategory
                                  ? ` · ${t.pricingCategory}`
                                  : ""}
                              </span>
                              <span className="inbox-template-pricing">
                                {t.pricingNote}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {selectedTemplate ? (
                      <div className="inbox-template-form">
                        <p className="inbox-template-preview">
                          <PlainText text={selectedTemplate.bodyPreview} />
                        </p>
                        <p className="inbox-template-pricing" role="note">
                          {selectedTemplate.pricingNote}
                        </p>
                        {selectedTemplate.paramKeys.map((key) => (
                          <label key={key} className="inbox-template-param">
                            <span>{key}</span>
                            <input
                              autoComplete="off"
                              value={templateParams[key] ?? ""}
                              onChange={(e) =>
                                setTemplateParams((prev) => ({
                                  ...prev,
                                  [key]: e.target.value,
                                }))
                              }
                            />
                          </label>
                        ))}
                        <Button
                          className="panel-btn-primary"
                          onPress={() => void sendTemplate()}
                          isDisabled={busy}
                        >
                          Enviar modelo
                        </Button>
                      </div>
                    ) : null}
                    <Button
                      className="panel-btn-secondary"
                      style={{ marginTop: 8 }}
                      isDisabled={busy}
                      onPress={() => {
                        close();
                        setPickerOpen(false);
                      }}
                    >
                      Fechar
                    </Button>
                  </>
                )}
              </Dialog>
            </Modal>
          </ModalOverlay>
        </div>
      ) : (
        <p className="inbox-composer-closed">
          Conversa encerrada. Se a cliente escrever de novo, a conversa abre
          outra vez.
        </p>
      )}
    </div>
  );
}
