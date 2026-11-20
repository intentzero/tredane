/**
 * Sons com o painel aberto (foreground). Preferência só neste aparelho.
 * Mensagens/handoff: sintetizados (Web Audio). Agendamento confirmado: WAV Mixkit.
 * Com o app fechado ou em segundo plano quem avisa é o push do sistema (public/sw.js) —
 * este módulo NÃO controla o tom de notificação do SO (iOS PWA incluído).
 */

const STORAGE_KEY = 'tredane.sound.messages'

/** Mixkit doorbell (Sound Effects License — uso livre; atribuição não obrigatória). */
export const APPOINTMENT_CONFIRMED_SOUND_URL =
  '/sounds/mixkit-doorbell-tone-2864.wav'

type AudioCtor = typeof AudioContext

let ctx: AudioContext | null = null
let doorbellBuffer: AudioBuffer | null = null
let doorbellLoad: Promise<AudioBuffer | null> | null = null

export function isSoundEnabled(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setSoundEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off')
  } catch {
    /* sem armazenamento: vale só até recarregar */
  }
}

function audioContext(): AudioContext | null {
  if (ctx) return ctx
  if (typeof window === 'undefined') return null
  const Ctor: AudioCtor | undefined =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext
  if (!Ctor) return null
  try {
    ctx = new Ctor()
  } catch {
    return null
  }
  return ctx
}

/**
 * O iOS só deixa tocar áudio depois de um gesto do usuário.
 * Chame uma vez; o primeiro toque na tela destrava o som para o resto da sessão.
 */
export function installSoundUnlock(): () => void {
  if (typeof window === 'undefined') return () => {}
  const unlock = () => {
    const c = audioContext()
    if (c && c.state === 'suspended') void c.resume().catch(() => {})
    if (c && c.state !== 'closed') remove()
  }
  const events = ['pointerdown', 'touchend', 'keydown'] as const
  const remove = () => events.forEach((e) => window.removeEventListener(e, unlock))
  events.forEach((e) => window.addEventListener(e, unlock, { passive: true }))
  return remove
}

/** Dois toques curtos e suaves (Si5 → Mi6, ~0,35 s). Retorna se chegou a agendar o som. */
export function playMessageSound(): boolean {
  const c = audioContext()
  if (!c || c.state !== 'running') return false
  const start = c.currentTime + 0.01
  const notes: Array<[number, number]> = [
    [987.77, 0],
    [1318.51, 0.14],
  ]
  for (const [freq, offset] of notes) {
    const osc = c.createOscillator()
    const gain = c.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    const t = start + offset
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22)
    osc.connect(gain).connect(c.destination)
    osc.start(t)
    osc.stop(t + 0.24)
  }
  return true
}

/** Toca só se o usuário não desligou, a aba está visível e o evento é mensagem recebida. */
export function maybePlayInboundSound(event: {
  eventType: string
  payload?: Record<string, unknown> | null
}): boolean {
  if (event.eventType !== 'message.created') return false
  if (event.payload?.direction !== 'inbound') return false
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return false
  if (!isSoundEnabled()) return false
  return playMessageSound()
}

/**
 * DEC-156 — três notas (Si4 → Mi5 → Si5) para handoff / «Precisa de alguém».
 * Distinto do chirp de mensagem. Retorna se agendou o som.
 */
export function playHandoffSound(): boolean {
  const c = audioContext()
  if (!c || c.state !== 'running') return false
  const start = c.currentTime + 0.01
  const notes: Array<[number, number, number]> = [
    [493.88, 0, 0.22],
    [659.25, 0.16, 0.22],
    [987.77, 0.32, 0.28],
  ]
  for (const [freq, offset, dur] of notes) {
    const osc = c.createOscillator()
    const gain = c.createGain()
    osc.type = 'triangle'
    osc.frequency.value = freq
    const t = start + offset
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.2, t + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    osc.connect(gain).connect(c.destination)
    osc.start(t)
    osc.stop(t + dur + 0.02)
  }
  return true
}

/** Som de reforço (5 min): duas notas mais graves e longas. */
export function playHandoffEscalateSound(): boolean {
  const c = audioContext()
  if (!c || c.state !== 'running') return false
  const start = c.currentTime + 0.01
  const notes: Array<[number, number]> = [
    [392.0, 0],
    [523.25, 0.22],
  ]
  for (const [freq, offset] of notes) {
    const osc = c.createOscillator()
    const gain = c.createGain()
    osc.type = 'square'
    osc.frequency.value = freq
    const t = start + offset
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.12, t + 0.03)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35)
    osc.connect(gain).connect(c.destination)
    osc.start(t)
    osc.stop(t + 0.38)
  }
  return true
}

function canPlayAlertSound(): boolean {
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return false
  return isSoundEnabled()
}

/**
 * Handoff: `conversation.ai_pause` com `source: 'handoff'` (DEC-155 gancho).
 * Ignora timeout_resume / manual_resume.
 */
export function maybePlayHandoffSound(event: {
  eventType: string
  payload?: Record<string, unknown> | null
}): boolean {
  if (event.eventType !== 'conversation.ai_pause') return false
  if (event.payload?.aiReplyPaused !== true) return false
  if (event.payload?.source != null && event.payload.source !== 'handoff') return false
  if (!canPlayAlertSound()) return false
  return playHandoffSound()
}

/** Reforço aos 5 min sem Assumir. */
export function maybePlayHandoffEscalateSound(event: {
  eventType: string
  payload?: Record<string, unknown> | null
}): boolean {
  if (event.eventType !== 'conversation.needs_person_escalate') return false
  if (!canPlayAlertSound()) return false
  return playHandoffEscalateSound()
}

function loadDoorbellBuffer(c: AudioContext): Promise<AudioBuffer | null> {
  if (doorbellBuffer) return Promise.resolve(doorbellBuffer)
  if (doorbellLoad) return doorbellLoad
  doorbellLoad = (async () => {
    try {
      const res = await fetch(APPOINTMENT_CONFIRMED_SOUND_URL)
      if (!res.ok) throw new Error(`doorbell ${res.status}`)
      const raw = await res.arrayBuffer()
      const buf = await new Promise<AudioBuffer>((resolve, reject) => {
        let settled = false
        const ok = (b: AudioBuffer) => {
          if (settled) return
          settled = true
          resolve(b)
        }
        const bad = (err: unknown) => {
          if (settled) return
          settled = true
          reject(err)
        }
        try {
          // Promise API (moderno) + callback (Safari antigo).
          const ret = c.decodeAudioData(raw.slice(0), ok, bad) as unknown
          if (ret && typeof (ret as Promise<AudioBuffer>).then === 'function') {
            ;(ret as Promise<AudioBuffer>).then(ok, bad)
          }
        } catch (err) {
          bad(err)
        }
      })
      doorbellBuffer = buf
      return buf
    } catch {
      doorbellLoad = null
      return null
    }
  })()
  return doorbellLoad
}

/**
 * Campainha Mixkit ao confirmar marcação (painel aberto + gesto de unlock).
 * Carrega o WAV sob demanda; falhas silenciosas (rede / decode).
 */
export function playAppointmentConfirmedSound(): boolean {
  const c = audioContext()
  if (!c || c.state !== 'running') return false
  void loadDoorbellBuffer(c).then((buf) => {
    if (!buf || !ctx || ctx.state !== 'running') return
    try {
      const src = ctx.createBufferSource()
      const gain = ctx.createGain()
      src.buffer = buf
      gain.gain.value = 0.85
      src.connect(gain).connect(ctx.destination)
      src.start(0)
    } catch {
      /* best-effort */
    }
  })
  return true
}

/**
 * `appointment.confirmed` (marcação criada/confirmada — botão, Pix, página cliente).
 * Não toca em proposta, hold, draft nem remarcação.
 */
export function maybePlayAppointmentConfirmedSound(event: {
  eventType: string
  payload?: Record<string, unknown> | null
}): boolean {
  if (event.eventType !== 'appointment.confirmed') return false
  if (!canPlayAlertSound()) return false
  return playAppointmentConfirmedSound()
}

/** Só para testes. */
export function resetSoundForTests(): void {
  ctx = null
  doorbellBuffer = null
  doorbellLoad = null
}
