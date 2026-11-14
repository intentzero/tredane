/**
 * DEC-185 — Conhecimento da clínica / FAQ institucional (só owner).
 * Categorias CRUD + entradas Q&A (pergunta, resposta ≤500, published/draft).
 */
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button, Input, Label, TextArea, TextField } from 'react-aria-components'
import type { PanelApi } from '../../api'
import { Banner } from '../../states/Banner'
import { EmptyState } from '../../states/StatusScreens'

export type KnowledgeCategoryDto = {
  id: string
  name: string
  sortOrder: number
}

export type KnowledgeEntryDto = {
  id: string
  categoryId: string
  categoryName: string
  question: string
  answer: string
  matchCues: string[]
  status: 'draft' | 'published'
  sourceKey: string | null
  version: number
}

type Props = {
  tenantId: string
  api: PanelApi
  generation: number
}

const ANSWER_MAX = 500

export function KnowledgeScreen({ tenantId, api, generation }: Props) {
  const [categories, setCategories] = useState<KnowledgeCategoryDto[]>([])
  const [entries, setEntries] = useState<KnowledgeEntryDto[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [newCategory, setNewCategory] = useState('')
  const [editCategoryId, setEditCategoryId] = useState<string | null>(null)
  const [editCategoryName, setEditCategoryName] = useState('')

  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [categoryId, setCategoryId] = useState('')
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [cues, setCues] = useState('')
  const [status, setStatus] = useState<'draft' | 'published'>('draft')

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [cats, ents] = await Promise.all([
        api.listKnowledgeCategories(tenantId, {
          generation,
          expectGeneration: () => generation,
        }),
        api.listKnowledgeEntries(tenantId, {
          generation,
          expectGeneration: () => generation,
        }),
      ])
      setCategories(cats)
      setEntries(ents)
      if (!categoryId && cats[0]) setCategoryId(cats[0].id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar o conhecimento')
    } finally {
      setLoading(false)
    }
  }, [api, tenantId, generation, categoryId])

  useEffect(() => {
    void reload()
  }, [reload])

  const resetForm = () => {
    setFormOpen(false)
    setEditingId(null)
    setQuestion('')
    setAnswer('')
    setCues('')
    setStatus('draft')
    if (categories[0]) setCategoryId(categories[0].id)
  }

  const openEdit = (entry: KnowledgeEntryDto) => {
    setFormOpen(true)
    setEditingId(entry.id)
    setCategoryId(entry.categoryId)
    setQuestion(entry.question)
    setAnswer(entry.answer)
    setCues(entry.matchCues.join(', '))
    setStatus(entry.status)
  }

  const saveCategory = async () => {
    const name = newCategory.trim()
    if (!name || busy) return
    setBusy(true)
    setError(null)
    try {
      await api.upsertKnowledgeCategory(tenantId, { name }, {
        generation,
        expectGeneration: () => generation,
      })
      setNewCategory('')
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não gravou a categoria')
    } finally {
      setBusy(false)
    }
  }

  const renameCategory = async () => {
    if (!editCategoryId || !editCategoryName.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await api.upsertKnowledgeCategory(
        tenantId,
        { id: editCategoryId, name: editCategoryName.trim() },
        { generation, expectGeneration: () => generation },
      )
      setEditCategoryId(null)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não renomeou a categoria')
    } finally {
      setBusy(false)
    }
  }

  const removeCategory = async (id: string) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await api.deleteKnowledgeCategory(tenantId, id, {
        generation,
        expectGeneration: () => generation,
      })
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não apagou a categoria')
    } finally {
      setBusy(false)
    }
  }

  const saveEntry = async () => {
    if (!categoryId || !question.trim() || !answer.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const matchCues = cues
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean)
      await api.upsertKnowledgeEntry(
        tenantId,
        {
          ...(editingId ? { id: editingId } : {}),
          categoryId,
          question: question.trim(),
          answer: answer.trim(),
          matchCues,
          status,
        },
        { generation, expectGeneration: () => generation },
      )
      resetForm()
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não gravou a entrada')
    } finally {
      setBusy(false)
    }
  }

  const removeEntry = async (id: string) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await api.deleteKnowledgeEntry(tenantId, id, {
        generation,
        expectGeneration: () => generation,
      })
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não apagou a entrada')
    } finally {
      setBusy(false)
    }
  }

  const published = entries.filter((e) => e.status === 'published').length

  if (loading && categories.length === 0 && entries.length === 0) {
    return <p className="clinic-muted">A carregar conhecimento…</p>
  }

  return (
    <div className="clinic-stack">
      <Banner tone="info" title="Como funciona">
        Perguntas e respostas que a assistente envia à cliente com o texto exacto (sem inventar).
        No máximo 15 publicadas · resposta até {ANSWER_MAX} caracteres. A equipe vê a resposta no
        fio da conversa, como mensagem da IA.
      </Banner>
      {error ? (
        <Banner tone="error" title="Não deu para gravar">
          {error}
        </Banner>
      ) : null}

      <section className="clinic-card" aria-labelledby="kn-cat-t">
        <h2 id="kn-cat-t" className="clinic-card-title">
          Categorias
        </h2>
        <p className="clinic-muted">
          Crie as que precisar (acesso, pagamento, visita…). Não há lista fixa; preparo de
          procedimento fica no serviço, se fizer sentido.
        </p>
        <ul className="clinic-plain-list">
          {categories.map((c) => (
            <li key={c.id} className="clinic-row-actions">
              {editCategoryId === c.id ? (
                <>
                  <Input
                    aria-label="Nome da categoria"
                    value={editCategoryName}
                    onChange={(e) => setEditCategoryName(e.target.value)}
                    className="panel-input"
                  />
                  <Button className="panel-btn-primary" onPress={() => void renameCategory()} isDisabled={busy}>
                    Salvar
                  </Button>
                  <Button className="panel-btn-ghost" onPress={() => setEditCategoryId(null)}>
                    Cancelar
                  </Button>
                </>
              ) : (
                <>
                  <span>{c.name}</span>
                  <Button
                    className="panel-btn-ghost"
                    aria-label={`Editar ${c.name}`}
                    onPress={() => {
                      setEditCategoryId(c.id)
                      setEditCategoryName(c.name)
                    }}
                  >
                    <Pencil size={16} aria-hidden />
                  </Button>
                  <Button
                    className="panel-btn-ghost"
                    aria-label={`Apagar ${c.name}`}
                    onPress={() => void removeCategory(c.id)}
                    isDisabled={busy}
                  >
                    <Trash2 size={16} aria-hidden />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
        <div className="clinic-row-actions">
          <Input
            aria-label="Nova categoria"
            placeholder="Nome da categoria"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            className="panel-input"
          />
          <Button className="panel-btn-secondary" onPress={() => void saveCategory()} isDisabled={busy || !newCategory.trim()}>
            <Plus size={16} aria-hidden /> Adicionar
          </Button>
        </div>
      </section>

      <section className="clinic-card" aria-labelledby="kn-ent-t">
        <div className="clinic-card-head">
          <h2 id="kn-ent-t" className="clinic-card-title">
            Perguntas e respostas
          </h2>
          <span className="clinic-muted">
            {published} publicadas · {entries.length} no total
          </span>
        </div>

        {!formOpen ? (
          <Button
            className="panel-btn-primary"
            onPress={() => {
              setFormOpen(true)
              setEditingId(null)
            }}
            isDisabled={categories.length === 0}
          >
            <Plus size={16} aria-hidden /> Nova entrada
          </Button>
        ) : (
          <div className="clinic-form-stack">
            <TextField>
              <Label>Categoria</Label>
              <select
                className="panel-input"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                aria-label="Categoria"
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </TextField>
            <TextField>
              <Label>Pergunta</Label>
              <Input
                className="panel-input"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                maxLength={200}
              />
            </TextField>
            <TextField>
              <Label>Resposta à cliente (máx. {ANSWER_MAX})</Label>
              <TextArea
                className="panel-input"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                maxLength={ANSWER_MAX}
                rows={4}
              />
              <span className="clinic-muted">{answer.length}/{ANSWER_MAX}</span>
            </TextField>
            <TextField>
              <Label>Palavras que disparam (separadas por vírgula)</Label>
              <Input
                className="panel-input"
                value={cues}
                onChange={(e) => setCues(e.target.value)}
                placeholder="estacionamento, vaga, garagem"
              />
            </TextField>
            <fieldset className="clinic-inline-choice">
              <legend>Estado</legend>
              <label>
                <input
                  type="radio"
                  name="kn-status"
                  checked={status === 'draft'}
                  onChange={() => setStatus('draft')}
                />{' '}
                Rascunho
              </label>
              <label>
                <input
                  type="radio"
                  name="kn-status"
                  checked={status === 'published'}
                  onChange={() => setStatus('published')}
                />{' '}
                Publicada
              </label>
            </fieldset>
            <div className="clinic-row-actions">
              <Button className="panel-btn-primary" onPress={() => void saveEntry()} isDisabled={busy}>
                {editingId ? 'Salvar' : 'Criar'}
              </Button>
              <Button className="panel-btn-ghost" onPress={resetForm}>
                Cancelar
              </Button>
            </div>
          </div>
        )}

        {entries.length === 0 && !formOpen ? (
          <EmptyState
            title="Nenhuma pergunta ainda"
            description="Cadastre 5 a 15 respostas curtas que a clínica já dá no WhatsApp."
          />
        ) : (
          <ul className="clinic-plain-list">
            {entries.map((e) => (
              <li key={e.id} className="clinic-knowledge-entry">
                <div>
                  <p className="clinic-knowledge-q">{e.question}</p>
                  <p className="clinic-muted">
                    {e.categoryName}
                    {' · '}
                    {e.status === 'published' ? 'Publicada' : 'Rascunho'}
                    {e.sourceKey === 'signal_policy' ? ' · política de sinal' : ''}
                  </p>
                  <p className="clinic-knowledge-a">{e.answer}</p>
                </div>
                <div className="clinic-row-actions">
                  <Button className="panel-btn-ghost" aria-label="Editar" onPress={() => openEdit(e)}>
                    <Pencil size={16} aria-hidden />
                  </Button>
                  <Button
                    className="panel-btn-ghost"
                    aria-label="Apagar"
                    onPress={() => void removeEntry(e.id)}
                    isDisabled={busy || e.sourceKey === 'signal_policy'}
                  >
                    <Trash2 size={16} aria-hidden />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
