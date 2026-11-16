import { useState, type FormEvent } from 'react'
import { adminErrorMessage } from '../api'
import { PageHeader } from '../AdminUi'
import { clinicaHref, navigateAdmin } from '../routes'
import { useAdminApi } from '../useAdminApi'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function timezones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] }
  const all = intl.supportedValuesOf?.('timeZone') ?? []
  return all.includes('America/Sao_Paulo') ? all : ['America/Sao_Paulo', ...all]
}

/** PA-03 (DEC-194): cria a clínica e convida a primeira owner por e-mail. */
export function NovaClinica() {
  const api = useAdminApi()
  const [name, setName] = useState('')
  const [timezone, setTimezone] = useState('America/Sao_Paulo')
  const [email, setEmail] = useState('')
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const nameError = name.trim() ? null : 'Escreva o nome da clínica.'
  const emailError = EMAIL_RE.test(email.trim()) ? null : 'Escreva um e-mail completo, como nome@clinica.com.br.'

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (nameError || emailError || busy) return
    setBusy(true)
    setError(null)
    try {
      const created = await api.createTenantWithOwnerInvite({
        name: name.trim(),
        timezone,
        ownerEmail: email.trim(),
      })
      // Se o e-mail falhou, o detalhe mostra o convite pendente com «Reenviar».
      navigateAdmin(clinicaHref(created.tenant.id))
    } catch (err) {
      setError(adminErrorMessage(err))
      setBusy(false)
    }
  }

  return (
    <>
      <a
        className="admin-back"
        href="/admin/clinicas"
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
          e.preventDefault()
          navigateAdmin('/admin/clinicas')
        }}
      >
        ‹ Clínicas
      </a>
      <PageHeader
        title="Nova clínica"
        sub="Cria a clínica e convida a primeira owner. A owner configura o resto no painel."
      />
      <form className="admin-card admin-form" onSubmit={submit} noValidate>
        <label className="admin-field">
          Nome da clínica
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={touched && nameError ? true : undefined}
            disabled={busy}
          />
          {touched && nameError ? <span className="admin-field-error" role="alert">{nameError}</span> : null}
        </label>
        <label className="admin-field">
          Fuso horário
          <select value={timezone} onChange={(e) => setTimezone(e.target.value)} disabled={busy}>
            {timezones().map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </select>
        </label>
        <h2 className="admin-card-title">Primeira owner</h2>
        <label className="admin-field">
          E-mail
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="off"
            aria-invalid={touched && emailError ? true : undefined}
            disabled={busy}
          />
          {touched && emailError ? <span className="admin-field-error" role="alert">{emailError}</span> : null}
        </label>
        <p className="admin-muted">
          A owner recebe um convite válido por 7 dias. Fica registado na auditoria com o seu nome como autor.
          Até aceitar, a clínica aparece como «Em configuração».
        </p>
        {error ? <p className="admin-dialog-error" role="alert">{error}</p> : null}
        <div className="admin-form-actions">
          <button type="submit" className="admin-btn admin-btn--primary" disabled={busy}>
            {busy ? 'Criando…' : 'Criar clínica'}
          </button>
          <button
            type="button"
            className="admin-btn"
            disabled={busy}
            onClick={() => navigateAdmin('/admin/clinicas')}
          >
            Cancelar
          </button>
        </div>
      </form>
    </>
  )
}
