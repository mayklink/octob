export type CapabilityDraftStatus = 'draft' | 'ready' | 'installed' | 'discarded' | 'failed'

export interface CapabilitySpec {
  name: string
  description: string
  provider?: string
  screens: string[]
  actions: string[]
  requiredSecrets: string[]
  externalWrites: string[]
  timeoutMs?: number
}

export interface CapabilityTestCase {
  name: string
  input: unknown
  expected: unknown
  httpMocks?: Array<{
    url: string
    method?: string
    status?: number
    body?: unknown
    headers?: Record<string, string>
  }>
}

export interface CapabilityArtifactInput {
  html: string
  css: string
  javascript: string
  /** An async function expression or CommonJS source exporting one. */
  handler: string
  /** Extra source or data files loaded by the handler with require('./file'). */
  files?: Record<string, string>
  tests: CapabilityTestCase[]
}

export interface CapabilityDraft {
  id: string
  name: string
  request: string
  spec: CapabilitySpec
  status: CapabilityDraftStatus
  latestVersion: number
  installedVersion: number | null
  createdAt: string
  updatedAt: string
}

export interface CapabilityVersion {
  draftId: string
  version: number
  status: 'draft' | 'ready' | 'failed'
  spec: CapabilitySpec
  artifactHash: string
  validation: CapabilityValidation | null
  createdAt: string
}

export interface CapabilityValidation {
  ok: boolean
  checks: Array<{ name: string; ok: boolean; detail?: string }>
}

export interface CapabilityDetail {
  draft: CapabilityDraft
  versions: CapabilityVersion[]
  artifact: CapabilityArtifactInput | null
}
