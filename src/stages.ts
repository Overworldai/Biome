import stagesJson from './stages.json'
import type { LoadingStage } from './types/app'

const stageMap = new Map<string, LoadingStage>(stagesJson.map((s) => [s.id, s]))

export type StageId = (typeof stagesJson)[number]['id']

export const resolveStage = (id: string): LoadingStage | undefined => stageMap.get(id)
