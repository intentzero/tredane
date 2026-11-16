/**
 * Exportar / importar catálogo (serviços+variantes e profissionais). Só owner (DEC-042).
 * Paulo 16/11/2026 — Clínica › hub.
 */
import { useRef, useState } from 'react'
import { Button } from 'react-aria-components'
import type { ClinicCatalogImportResult, ClinicCatalogTransferDocument, PanelApi } from '../../api'
import { friendlyError } from '../../copy/errors'
import { ClinicCheck } from './ClinicCheck'

type Props = {
  tenantId: string
  api: PanelApi
  generation: number
  onApplied?: () => void
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function summarizePlan(result: ClinicCatalogImportResult): string {
  const creates = result.items.filter((i) => i.action === 'create').length
  const updates = result.items.filter((i) => i.action === 'update').length
  const parts = [
    `${creates} a criar`,
    `${updates} a actualizar`,
    `${result.warnings.length} aviso${result.warnings.length === 1 ? '' : 's'}`,
  ]
  return parts.join(' · ')
}

export function CatalogTransferCard({ tenantId, api, generation, onApplied }: Props) {
  const [services, setServices] = useState(true)
  const [professionals, setProfessionals] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [preview, setPreview] = useState<ClinicCatalogImportResult | null>(null)
  const [pendingDoc, setPendingDoc] = useState<ClinicCatalogTransferDocument | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const canRun = services || professionals

  async function onExport() {
    if (!canRun) {
      setMessage('Escolha pelo menos serviços ou profissionais.')
      return
    }
    setBusy(true)
    setMessage(null)
    setPreview(null)
    try {
      const doc = await api.exportClinicCatalog(
        tenantId,
        { services, professionals },
        { generation, expectGeneration: () => generation },
      )
      const day = doc.exportedAt.slice(0, 10)
      downloadJson(`tredane-catalogo-${tenantId}-${day}.json`, doc)
      setMessage('Ficheiro JSON descarregado. Inclui nomes de profissionais se esse âmbito estiver marcado.')
    } catch (err) {
      setMessage(friendlyError(err, 'Não deu para exportar agora.'))
    } finally {
      setBusy(false)
    }
  }

  async function onFileChosen(file: File | null) {
    if (!file) return
    setMessage(null)
    setPreview(null)
    setPendingDoc(null)
    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as ClinicCatalogTransferDocument
      if (!canRun) {
        setMessage('Escolha pelo menos serviços ou profissionais para importar.')
        return
      }
      setBusy(true)
      const result = await api.importClinicCatalog(
        tenantId,
        {
          document: parsed,
          dryRun: true,
          services,
          professionals,
        },
        { generation, expectGeneration: () => generation },
      )
      setPendingDoc(parsed)
      setPreview(result)
      setMessage(`Pré-visualização: ${summarizePlan(result)}. Confirme para gravar.`)
    } catch (err) {
      setMessage(friendlyError(err, 'Ficheiro inválido ou importação recusada.'))
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function onApply() {
    if (!pendingDoc || !canRun) return
    setBusy(true)
    setMessage(null)
    try {
      const result = await api.importClinicCatalog(
        tenantId,
        {
          document: pendingDoc,
          dryRun: false,
          services,
          professionals,
        },
        { generation, expectGeneration: () => generation },
      )
      setPreview(result)
      setPendingDoc(null)
      setMessage(`Importação gravada: ${summarizePlan(result)}.`)
      onApplied?.()
    } catch (err) {
      setMessage(friendlyError(err, 'Não deu para aplicar a importação.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="catalog-transfer" className="whatsapp-dev-sync-section">
      <h3 id="catalog-transfer" className="whatsapp-subhead">
        Exportar e importar catálogo
      </h3>
      <p className="clinic-footnote">
        Copia a configuração de serviços (com variantes, sinónimos e combos) e/ou profissionais
        para um ficheiro JSON, ou traz de volta com pré-visualização antes de gravar. Não inclui
        salas, agenda, contactos nem WhatsApp. Nomes de profissionais são dados pessoais — guarde
        o ficheiro com cuidado.
      </p>
      <div className="clinic-stack" role="group" aria-label="O que incluir">
        <p className="clinic-footnote">O que incluir</p>
        <ClinicCheck isSelected={services} onChange={setServices}>
          Serviços e variantes
        </ClinicCheck>
        <ClinicCheck isSelected={professionals} onChange={setProfessionals}>
          Profissionais
        </ClinicCheck>
      </div>
      <div className="clinic-actions">
        <Button
          className="panel-btn-secondary"
          isDisabled={busy || !canRun}
          onPress={() => void onExport()}
        >
          {busy ? 'A trabalhar…' : 'Exportar JSON'}
        </Button>
        <Button
          className="panel-btn-secondary"
          isDisabled={busy || !canRun}
          onPress={() => fileRef.current?.click()}
        >
          Escolher ficheiro…
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => void onFileChosen(e.target.files?.[0] ?? null)}
        />
        {preview?.dryRun && pendingDoc ? (
          <Button
            className="panel-btn-primary"
            isDisabled={busy}
            onPress={() => void onApply()}
          >
            Confirmar importação
          </Button>
        ) : null}
      </div>
      {preview && preview.warnings.length > 0 ? (
        <ul className="clinic-footnote" role="status">
          {preview.warnings.slice(0, 8).map((w, i) => (
            <li key={`${w.code}-${i}`}>{w.message}</li>
          ))}
          {preview.warnings.length > 8 ? (
            <li>…e mais {preview.warnings.length - 8} avisos</li>
          ) : null}
        </ul>
      ) : null}
      {message ? (
        <p className="clinic-footnote" role="status">
          {message}
        </p>
      ) : null}
    </section>
  )
}
