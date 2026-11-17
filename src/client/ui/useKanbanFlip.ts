import { useLayoutEffect, useRef, type RefObject } from 'react'
import {
  keysWithStageChange,
  playFlipAnimations,
  readFlipRects,
  type FlipRectMap,
} from './flipLayout'

export type StageKeyMap = Map<string, string>

/** Build boardKey → pipeline stage from columnized data. */
export function buildStageKeyMap(
  byStage: Partial<Record<string, { boardKey?: string; id: string }[]>> | null,
): StageKeyMap {
  const map: StageKeyMap = new Map()
  if (!byStage) return map
  for (const [stage, cards] of Object.entries(byStage)) {
    for (const card of cards ?? []) {
      map.set(card.boardKey ?? card.id, stage)
    }
  }
  return map
}

/**
 * After kanban data updates, FLIP-animate cards whose stage changed.
 * Skips the first paint; call `captureBeforeUpdate()` immediately before setState.
 */
export function useKanbanFlip(
  boardRef: RefObject<HTMLElement | null>,
  byStage: Partial<Record<string, { boardKey?: string; id: string }[]>> | null,
) {
  const flipBeforeRef = useRef<FlipRectMap | null>(null)
  const stageBeforeRef = useRef<StageKeyMap>(new Map())
  const initialPaintRef = useRef(true)

  function captureBeforeUpdate() {
    const root = boardRef.current
    if (!root || initialPaintRef.current) return
    flipBeforeRef.current = readFlipRects(root)
    stageBeforeRef.current = buildStageKeyMap(byStage)
  }

  useLayoutEffect(() => {
    const root = boardRef.current
    if (!byStage || !root) return

    if (initialPaintRef.current) {
      initialPaintRef.current = false
      stageBeforeRef.current = buildStageKeyMap(byStage)
      flipBeforeRef.current = null
      return
    }

    const beforeRects = flipBeforeRef.current
    flipBeforeRef.current = null
    if (!beforeRects || beforeRects.size === 0) {
      stageBeforeRef.current = buildStageKeyMap(byStage)
      return
    }

    const nextStages = buildStageKeyMap(byStage)
    const moved = keysWithStageChange(stageBeforeRef.current, nextStages)
    stageBeforeRef.current = nextStages

    if (moved.length === 0) return
    playFlipAnimations(root, beforeRects, moved)
  }, [byStage, boardRef])

  return { captureBeforeUpdate }
}