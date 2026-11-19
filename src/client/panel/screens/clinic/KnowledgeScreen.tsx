/**
 * DEC-185 — Conhecimento da clínica / FAQ institucional (só owner).
 * Categorias CRUD + entradas Q&A (pergunta, resposta ≤500, published/draft).
 */
import { ChevronRight, Lock, Plus, Search, Tag, Trash2, X, Pencil } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Input, Label, Switch, TextArea, TextField } from 'react-aria-components'
import type { PanelApi } from '../../api'
import { friendlyError } from '../../copy/errors'
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
const PUBLISHED_MAX = 15
const CUES_MAX = 12
const SIGNAL_KEY = 'signal_policy'

/** Primeira vez: o dono toca e abre o editor com a pergunta e a categoria prontas. */
const SUGGESTIONS: Array<{ question: string; category: string }> = [
  { question: 'Tem estacionamento?', category: 'Acesso' },
  { question: 'Qual o endereço e como chegar?', category: 'Acesso' },
  { question: 'Quais formas de pagamento aceitam?', category: 'Pagamento' },
  { question: 'Posso levar acompanhante?', category: 'Visita' },
  { question: 'Com quanto tempo de antecedência devo chegar?', category: 'Visita' },
]

type View = 'list' | 'edit' | 'categories'

export function KnowledgeScreen({ tenantId, api, generation }: Props) {
  const [categories, setCategories] = useState<KnowledgeCategoryDto[]>([])
  const [entries, setEntries] = useState<KnowledgeEntryDto[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [view, setView] = useState<View>('list')

  // Lista
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<string>('all')

  // Categorias
  const [newCategory, setNewCategory] = useState('')
  const [editCategoryId, setEditCategoryId] = useState<string | null>(null)
  const [editCategoryName, setEditCategoryName] = useState('')

  // Editor
  const [editingId, setEditingId] = useState<string | null>(null)
  const [categoryId, setCategoryId] = useState('')
  const [pendingCategory, setPendingCategory] = useState('')
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [cues, setCues] = useState<string[]>([])
  const [draftCue, setDraftCue] = useState('')
  const [status, setStatus] = useState<'draft' | 'published'>('draft')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const opts = useMemo(
    () => ({ generation, expectGeneration: () => generation }),
    [generation],
  )

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [cats, ents] = await Promise.all([
        api.listKnowledgeCategories(tenantId, opts),
        api.listKnowledgeEntries(tenantId, opts),
      ])
      setCategories(cats)
      setEntries(ents)
    } catch (err) {
      setError(friendlyError(err, 'Não foi possível carregar o conhecimento'))
    } finally {
      setLoading(false)
    }
  }, [api, tenantId, opts])

  useEffect(() => {
    void reload()
  }, [reload])

  const run = async (fallback: string, fn: () => Promise<void>): Promise<boolean> => {
    if (busy) return false
    setBusy(true)
    setError(null)
    try {
      await fn()
      return true
    } catch (err) {
      setError(friendlyError(err, fallback))
      return false
    } finally {
      setBusy(false)
    }
  }

  const publishedCount = entries.filter((e) => e.status === 'published').length
  const draftCount = entries.length - publishedCount
  const quotaFull = publishedCount >= PUBLISHED_MAX

  const openNew = (suggestion?: { question: string; category: string }) => {
    const match = suggestion
      ? categories.find((c) => c.name.toLowerCase() === suggestion.category.toLowerCase())
      : undefined
    setEditingId(null)
    setCategoryId(match?.id ?? (filter !== 'all' ? filter : (categories[0]?.id ?? '')))
    setPendingCategory(!match && suggestion && categories.length === 0 ? suggestion.category : '')
    setQuestion(suggestion?.question ?? '')
    setAnswer('')
    setCues([])
    setDraftCue('')
    setStatus('draft')
    setConfirmDelete(false)
    setView('edit')
  }

  const openEdit = (entry: KnowledgeEntryDto) => {
    setEditingId(entry.id)
    setCategoryId(entry.categoryId)
    setPendingCategory('')
    setQuestion(entry.question)
    setAnswer(entry.answer)
    setCues(entry.matchCues)
    setDraftCue('')
    setStatus(entry.status)
    setConfirmDelete(false)
    setView('edit')
  }

  const closeEditor = () => {
    setView('list')
    setEditingId(null)
    setConfirmDelete(false)
  }

  const addCue = () => {
    const v = draftCue.trim()
    if (!v || cues.length >= CUES_MAX) return
    if (!cues.some((c) => c.toLowerCase() === v.toLowerCase())) setCues([...cues, v])
    setDraftCue('')
  }

  const saveEntry = async () => {
    const needsCategory = !categoryId && !pendingCategory.trim()
    if (needsCategory || !question.trim() || !answer.trim()) return
    const ok = await run('Não gravou a pergunta', async () => {
      let catId = categoryId
      if (!catId) {
        const created = await api.upsertKnowledgeCategory(
          tenantId,
          { name: pendingCategory.trim() },
          opts,
        )
        catId = created.id
      }
      const extra = draftCue.trim() && cues.length < CUES_MAX ? [draftCue.trim()] : []
      await api.upsertKnowledgeEntry(
        tenantId,
        {
          ...(editingId ? { id: editingId } : {}),
          categoryId: catId,
          question: question.trim(),
          answer: answer.trim(),
          matchCues: [...cues, ...extra],
          status,
        },
        opts,
      )
      await reload()
    })
    if (ok) closeEditor()
  }

  const removeEntry = async (id: string) => {
    const ok = await run('Não apagou a pergunta', async () => {
      await api.deleteKnowledgeEntry(tenantId, id, opts)
      await reload()
    })
    if (ok) closeEditor()
  }

  const addCategory = () => {
    const name = newCategory.trim()
    if (!name) return
    void run('Não gravou a categoria', async () => {
      await api.upsertKnowledgeCategory(tenantId, { name }, opts)
      setNewCategory('')
      await reload()
    })
  }

  const renameCategory = () => {
    if (!editCategoryId || !editCategoryName.trim()) return
    void run('Não renomeou a categoria', async () => {
      await api.upsertKnowledgeCategory(
        tenantId,
        { id: editCategoryId, name: editCategoryName.trim() },
        opts,
      )
      setEditCategoryId(null)
      await reload()
    })
  }

  const removeCategory = (id: string) => {
    void run('Não apagou a categoria', async () => {
      await api.deleteKnowledgeCategory(tenantId, id, opts)
      if (filter === id) setFilter('all')
      await reload()
    })
  }

  const errorBanner = error ? (
    <Banner tone="error" title="Não deu para gravar">
      {error}
    </Banner>
  ) : null

  if (loading && categories.length === 0 && entries.length === 0) {
    return <p className="clinic-muted">Carregando conhecimento…</p>
  }

  // ---------- Categorias ----------
  if (view === 'categories') {
    return (
      <div className="kn-stack">
        <Button className="panel-btn-ghost kn-back" onPress={() => setView('list')}>
          <ChevronRight size={16} aria-hidden className="kn-back-icon" /> Voltar ao conhecimento
        </Button>
        {errorBanner}
        <p className="clinic-muted">
          Agrupam as perguntas no painel; a cliente não vê. Preparo de procedimento fica na ficha do
          serviço.
        </p>
        <ul className="kn-card kn-cat-list">
          {categories.map((c) => {
            const count = entries.filter((e) => e.categoryId === c.id).length
            return (
              <li key={c.id} className="kn-cat-row">
                {editCategoryId === c.id ? (
                  <div className="kn-cat-edit">
                    <TextField>
                      <Label>Renomear categoria</Label>
                      <Input
                        className="panel-input"
                        value={editCategoryName}
                        maxLength={60}
                        onChange={(e) => setEditCategoryName(e.target.value)}
                        autoFocus
                      />
                    </TextField>
                    <div className="clinic-row-actions kn-end">
                      <Button className="panel-btn-ghost" onPress={() => setEditCategoryId(null)}>
                        Cancelar
                      </Button>
                      <Button
                        className="panel-btn-primary"
                        onPress={renameCategory}
                        isDisabled={busy || !editCategoryName.trim()}
                      >
                        Salvar
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="kn-grow">
                      <span className="kn-strong">{c.name}</span>
                      <span className="clinic-muted">
                        {count === 0 ? 'Nenhuma pergunta' : count === 1 ? '1 pergunta' : `${count} perguntas`}
                      </span>
                    </div>
                    <Button
                      className="panel-btn-ghost kn-icon-btn"
                      aria-label={`Renomear ${c.name}`}
                      onPress={() => {
                        setEditCategoryId(c.id)
                        setEditCategoryName(c.name)
                      }}
                    >
                      <Pencil size={18} aria-hidden />
                    </Button>
                    <Button
                      className="panel-btn-ghost kn-icon-btn"
                      aria-label={count > 0 ? `Apagar ${c.name} (tem perguntas)` : `Apagar ${c.name}`}
                      onPress={() => removeCategory(c.id)}
                      isDisabled={busy || count > 0}
                    >
                      <Trash2 size={18} aria-hidden />
                    </Button>
                  </>
                )}
              </li>
            )
          })}
        </ul>
        <p className="clinic-muted">
          Só dá para apagar uma categoria vazia. Mova ou apague as perguntas dela antes.
        </p>
        <div className="kn-new-cat">
          <TextField className="kn-grow">
            <Label>Nova categoria</Label>
            <Input
              className="panel-input"
              placeholder="Ex.: Horários e feriados"
              value={newCategory}
              maxLength={60}
              onChange={(e) => setNewCategory(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addCategory()
              }}
            />
          </TextField>
          <Button
            className="panel-btn-secondary"
            onPress={addCategory}
            isDisabled={busy || !newCategory.trim()}
          >
            <Plus size={16} aria-hidden /> Adicionar
          </Button>
        </div>
      </div>
    )
  }

  // ---------- Editor ----------
  if (view === 'edit') {
    const locked = entries.find((e) => e.id === editingId)?.sourceKey === SIGNAL_KEY
    const overQuota = status === 'published' && quotaFull &&
      entries.find((e) => e.id === editingId)?.status !== 'published'
    const canSave =
      !busy &&
      !overQuota &&
      question.trim().length > 0 &&
      answer.trim().length > 0 &&
      (categoryId !== '' || pendingCategory.trim().length > 0)
    const usedAfter = publishedCount +
      (status === 'published' && entries.find((e) => e.id === editingId)?.status !== 'published' ? 1 : 0) -
      (status !== 'published' && entries.find((e) => e.id === editingId)?.status === 'published' ? 1 : 0)
    return (
      <div className="kn-stack">
        <Button className="panel-btn-ghost kn-back" onPress={closeEditor}>
          <ChevronRight size={16} aria-hidden className="kn-back-icon" /> Voltar sem salvar
        </Button>
        {errorBanner}

        <TextField>
          <Label>Pergunta</Label>
          <Input
            className="panel-input"
            value={question}
            maxLength={200}
            onChange={(e) => setQuestion(e.target.value)}
            readOnly={locked}
          />
          <span className="clinic-muted">Do jeito que a cliente costuma perguntar.</span>
        </TextField>

        {categories.length > 0 ? (
          <fieldset className="kn-fieldset">
            <legend>Categoria</legend>
            <div className="kn-chips kn-chips--wrap">
              {categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="kn-chip"
                  aria-pressed={categoryId === c.id}
                  onClick={() => setCategoryId(c.id)}
                >
                  {c.name}
                </button>
              ))}
              <button type="button" className="kn-chip kn-chip--dashed" onClick={() => setView('categories')}>
                <Plus size={14} aria-hidden /> Nova
              </button>
            </div>
          </fieldset>
        ) : (
          <TextField>
            <Label>Categoria</Label>
            <Input
              className="panel-input"
              value={pendingCategory}
              maxLength={60}
              placeholder="Ex.: Acesso"
              onChange={(e) => setPendingCategory(e.target.value)}
            />
            <span className="clinic-muted">Ainda não há categorias; esta será criada ao salvar.</span>
          </TextField>
        )}

        <TextField>
          <div className="kn-label-row">
            <Label>Resposta à cliente</Label>
            <span
              className={answer.length > ANSWER_MAX - 50 ? 'kn-count kn-count--warn' : 'kn-count'}
              aria-live="polite"
            >
              {answer.length}/{ANSWER_MAX}
            </span>
          </div>
          <TextArea
            className="panel-input"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            maxLength={ANSWER_MAX}
            rows={4}
            readOnly={locked}
          />
          <span className="clinic-muted">Enviada exatamente assim. A IA não reescreve.</span>
        </TextField>

        <section className="kn-preview" aria-labelledby="kn-prev-t">
          <h3 id="kn-prev-t" className="kn-sub">Como a cliente vê no WhatsApp</h3>
          <div className="kn-preview-pane">
            <p className="kn-bubble kn-bubble--in">{question.trim() || 'Pergunta da cliente'}</p>
            <p className="kn-bubble kn-bubble--out">{answer.trim() || 'A resposta aparece aqui.'}</p>
            <span className="kn-preview-note">Enviada pela assistente</span>
          </div>
        </section>

        <section className="kn-fieldset" aria-labelledby="kn-cue-t">
          <h3 id="kn-cue-t" className="kn-sub">Palavras que ativam esta resposta</h3>
          {cues.length > 0 ? (
            <ul className="kn-chips kn-chips--wrap kn-plain">
              {cues.map((c) => (
                <li key={c} className="kn-cue">
                  {c}
                  <button
                    type="button"
                    className="kn-cue-x"
                    aria-label={`Remover ${c}`}
                    onClick={() => setCues(cues.filter((x) => x !== c))}
                  >
                    <X size={14} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="kn-new-cat">
            <Input
              aria-label="Nova palavra"
              className="panel-input kn-grow"
              placeholder="Ex.: garagem"
              value={draftCue}
              onChange={(e) => setDraftCue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addCue()
                }
              }}
              maxLength={80}
            />
            <Button
              className="panel-btn-secondary"
              onPress={addCue}
              isDisabled={!draftCue.trim() || cues.length >= CUES_MAX}
            >
              Adicionar
            </Button>
          </div>
          <span className="clinic-muted">
            Se a mensagem da cliente tiver uma destas palavras, esta resposta é usada. Até {CUES_MAX}.
          </span>
        </section>

        <div className="kn-card kn-switch-row">
          <Switch
            className="kn-switch"
            isSelected={status === 'published'}
            onChange={(on) => setStatus(on ? 'published' : 'draft')}
            isDisabled={locked}
          >
            <span className="kn-switch-track" aria-hidden>
              <span className="kn-switch-knob" />
            </span>
            <span className="kn-grow">
              <span className="kn-strong">Publicada</span>
              <span className="clinic-muted">
                {status === 'published'
                  ? 'A assistente já usa esta resposta'
                  : 'Rascunho: só a equipe vê'}
                {' · '}
                {usedAfter} de {PUBLISHED_MAX} em uso
              </span>
            </span>
          </Switch>
        </div>
        {overQuota ? (
          <Banner tone="warn" title={`Já há ${PUBLISHED_MAX} publicadas`}>
            Despublique uma pergunta ou deixe esta como rascunho.
          </Banner>
        ) : null}
        {locked ? (
          <p className="clinic-muted kn-lock">
            <Lock size={14} aria-hidden /> A política de sinal sincroniza-se em Recebimento; não se
            edita nem se apaga aqui.
          </p>
        ) : null}

        <div className="clinic-row-actions kn-actions">
          <Button className="panel-btn-ghost" onPress={closeEditor}>
            Cancelar
          </Button>
          <Button className="panel-btn-primary" onPress={() => void saveEntry()} isDisabled={!canSave || locked}>
            {editingId ? 'Salvar' : 'Criar pergunta'}
          </Button>
        </div>

        {editingId && !locked ? (
          confirmDelete ? (
            <div className="kn-confirm" role="group" aria-label="Confirmar exclusão">
              <span>Apagar esta pergunta? Não dá para desfazer.</span>
              <div className="clinic-row-actions">
                <Button className="panel-btn-ghost" onPress={() => setConfirmDelete(false)}>
                  Manter
                </Button>
                <Button className="panel-btn-danger" onPress={() => void removeEntry(editingId)} isDisabled={busy}>
                  Apagar
                </Button>
              </div>
            </div>
          ) : (
            <Button className="panel-btn-ghost kn-danger" onPress={() => setConfirmDelete(true)}>
              <Trash2 size={18} aria-hidden /> Apagar pergunta
            </Button>
          )
        ) : null}
      </div>
    )
  }

  // ---------- Lista ----------
  const needle = search.trim().toLowerCase()
  const visible = entries.filter(
    (e) =>
      (filter === 'all' || e.categoryId === filter) &&
      (!needle || e.question.toLowerCase().includes(needle) || e.answer.toLowerCase().includes(needle)),
  )
  const groups = categories
    .map((c) => ({ cat: c, items: visible.filter((e) => e.categoryId === c.id) }))
    .filter((g) => g.items.length > 0)

  const onlyAuto = entries.length > 0 && entries.every((e) => e.sourceKey === SIGNAL_KEY)
  const firstRun = entries.length === 0 || onlyAuto

  return (
    <div className="kn-stack">
      {errorBanner}

      {firstRun ? (
        <section className="kn-first" aria-labelledby="kn-first-t">
          <h2 id="kn-first-t" className="kn-first-title">O que a clínica mais responde no WhatsApp?</h2>
          <p className="clinic-muted">
            Cadastre de 5 a {PUBLISHED_MAX} respostas curtas. A assistente envia o texto exato quando a
            cliente pergunta; o resto continua com a equipe.
          </p>
          <h3 className="kn-sub">Comece por uma destas</h3>
          <ul className="kn-plain kn-sug-list">
            {SUGGESTIONS.map((s) => (
              <li key={s.question}>
                <button type="button" className="kn-sug" onClick={() => openNew(s)}>
                  <span className="kn-grow">
                    <span className="kn-strong">{s.question}</span>
                    <span className="clinic-muted">{s.category}</span>
                  </span>
                  <Plus size={20} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section className="kn-card kn-quota" aria-labelledby="kn-quota-t">
          <div className="kn-quota-head">
            <h2 id="kn-quota-t" className="kn-quota-title">
              <span className="kn-quota-n">{publishedCount}</span> de {PUBLISHED_MAX} publicadas
            </h2>
            <span className="clinic-muted">
              {draftCount === 0 ? 'Sem rascunhos' : draftCount === 1 ? '1 rascunho' : `${draftCount} rascunhos`}
            </span>
          </div>
          <div
            className="kn-meter"
            role="img"
            aria-label={`${publishedCount} de ${PUBLISHED_MAX} respostas publicadas`}
          >
            <div
              className={quotaFull ? 'kn-meter-fill kn-meter-fill--full' : 'kn-meter-fill'}
              style={{ width: `${Math.min(100, (publishedCount / PUBLISHED_MAX) * 100)}%` }}
            />
          </div>
          <p className="clinic-muted">
            A assistente envia o texto exato que você aprovou. A equipe vê a resposta na conversa.
          </p>
        </section>
      )}

      {!firstRun ? (
        <>
          <div className="kn-search">
            <Search size={18} aria-hidden className="kn-search-icon" />
            <Input
              type="search"
              aria-label="Buscar pergunta ou resposta"
              placeholder="Buscar pergunta ou resposta"
              className="panel-input kn-search-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="kn-chips" role="group" aria-label="Filtrar por categoria">
            <button type="button" className="kn-chip" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
              Todas <span className="kn-chip-n">{entries.length}</span>
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                className="kn-chip"
                aria-pressed={filter === c.id}
                onClick={() => setFilter(c.id)}
              >
                {c.name}{' '}
                <span className="kn-chip-n">{entries.filter((e) => e.categoryId === c.id).length}</span>
              </button>
            ))}
          </div>

          {groups.length === 0 ? (
            <EmptyState title="Nada encontrado" description="Tente outra palavra ou outra categoria." />
          ) : (
            groups.map(({ cat, items }) => (
              <section key={cat.id} className="kn-group" aria-labelledby={`kn-g-${cat.id}`}>
                <h2 id={`kn-g-${cat.id}`} className="kn-group-title">
                  <span>{cat.name}</span>
                  <span className="kn-group-n">{items.length === 1 ? '1 pergunta' : `${items.length} perguntas`}</span>
                </h2>
                <ul className="kn-card kn-plain kn-rows">
                  {items.map((e) => (
                    <li key={e.id}>
                      <button type="button" className="kn-row" onClick={() => openEdit(e)}>
                        <span className="kn-grow">
                          <span className="kn-strong">{e.question}</span>
                          <span className="kn-answer">{e.answer}</span>
                          <span className="kn-meta">
                            {e.status === 'published' ? (
                              <span className="kn-pill kn-pill--ok">Publicada</span>
                            ) : (
                              <span className="kn-pill kn-pill--draft">Rascunho</span>
                            )}
                            {e.sourceKey === SIGNAL_KEY ? (
                              <span className="kn-lock">
                                <Lock size={13} aria-hidden /> Vem de Recebimento
                              </span>
                            ) : null}
                          </span>
                        </span>
                        <ChevronRight size={18} aria-hidden className="kn-chev" />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </>
      ) : null}

      <div className="kn-footer">
        <Button className="panel-btn-primary" onPress={() => openNew()} isDisabled={busy}>
          <Plus size={18} aria-hidden /> {firstRun ? 'Escrever outra pergunta' : 'Nova pergunta'}
        </Button>
        <Button className="panel-btn-ghost" onPress={() => setView('categories')}>
          <Tag size={16} aria-hidden /> Categorias
        </Button>
      </div>
    </div>
  )
}
