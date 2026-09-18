import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  CredentialStatus,
  DubOptions,
  GoogleProfile,
  JobProgress,
  McpStatus,
  SelectedVideo
} from '../shared/types.js'

/**
 * 렌더러에 노출하는 유일한 통로.
 * API 키 값은 이 다리를 건너오지 않는다 — 설정은 보내기만 하고, 읽기는 존재 여부만.
 */
const api = {
  creds: {
    status: (): Promise<CredentialStatus> => ipcRenderer.invoke('creds:status'),
    setGoogleClient: (id: string, secret: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('creds:setGoogleClient', id, secret)
  },
  auth: {
    signIn: (): Promise<{ ok: boolean; profile?: GoogleProfile; error?: string }> =>
      ipcRenderer.invoke('auth:google'),
    signOut: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('auth:signOut'),
    profile: (): Promise<GoogleProfile | null> => ipcRenderer.invoke('auth:profile'),
    allowedDomains: (): Promise<string[]> => ipcRenderer.invoke('auth:allowedDomains'),
    config: (): Promise<{
      clientIdConfigured: boolean
      clientIdFromBuild: boolean
      allowedDomains: string[]
    }> => ipcRenderer.invoke('auth:config'),
    setAllowedDomains: (domains: string[]): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('auth:setAllowedDomains', domains)
  },
  /** 최초 1회 연결 안내. 끝내면 다시 뜨지 않는다. */
  onboarding: {
    needed: (): Promise<boolean> => ipcRenderer.invoke('onboarding:needed'),
    complete: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('onboarding:complete'),
    reset: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('onboarding:reset')
  },
  /** HeyGen MCP — OAuth 로 계정을 붙인다. 토큰은 메인 프로세스 밖으로 나가지 않는다. */
  mcp: {
    status: (): Promise<McpStatus> => ipcRenderer.invoke('mcp:status'),
    connect: (): Promise<{ ok: boolean; status?: McpStatus; error?: string }> =>
      ipcRenderer.invoke('mcp:connect'),
    disconnect: (): Promise<{ ok: boolean; status: McpStatus }> =>
      ipcRenderer.invoke('mcp:disconnect'),
    tools: (): Promise<{ ok: boolean; count?: number; names?: string[]; error?: string }> =>
      ipcRenderer.invoke('mcp:tools')
  },
  video: {
    pick: (): Promise<SelectedVideo | null> => ipcRenderer.invoke('video:pick'),
    setPath: (path: string): Promise<SelectedVideo> => ipcRenderer.invoke('video:setPath', path),
    clear: (): Promise<null> => ipcRenderer.invoke('video:clear'),
    /** 드래그앤드롭된 File 객체에서 실제 경로를 얻는다. Electron 32+ 필수 API. */
    pathForFile: (file: File): string => webUtils.getPathForFile(file),
  },
  job: {
    start: (opts: DubOptions): Promise<{ ok: boolean; outputPath?: string; error?: string }> =>
      ipcRenderer.invoke('job:start', opts),
    cancel: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('job:cancel'),
    current: (): Promise<JobProgress | null> => ipcRenderer.invoke('job:current'),
    onProgress: (cb: (p: JobProgress) => void): (() => void) => {
      const listener = (_e: unknown, p: JobProgress): void => cb(p)
      ipcRenderer.on('job:progress', listener)
      return () => ipcRenderer.removeListener('job:progress', listener)
    }
  },
  shell: {
    /** 안내에 적어둔 발급 페이지만 열린다. 임의 URL 은 메인 프로세스가 거부한다. */
    openExternal: (url: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('shell:openExternal', url),
    reveal: (path: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('shell:reveal', path)
  }
}

contextBridge.exposeInMainWorld('heyu', api)

export type HeyuApi = typeof api
