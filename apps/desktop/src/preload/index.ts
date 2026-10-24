import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@inkcraft/shared'
import type { AiEvent, InkcraftApi } from '@inkcraft/shared'

const api: InkcraftApi = {
  appInfo: () => ipcRenderer.invoke(IPC.AppInfo),
  projectList: () => ipcRenderer.invoke(IPC.ProjectList),
  projectCreate: (payload) => ipcRenderer.invoke(IPC.ProjectCreate, payload),
  projectUpdate: (payload) => ipcRenderer.invoke(IPC.ProjectUpdate, payload),
  projectDelete: (projectId) => ipcRenderer.invoke(IPC.ProjectDelete, projectId),
  volumeList: (projectId) => ipcRenderer.invoke(IPC.VolumeList, projectId),
  volumeCreate: (projectId, title) => ipcRenderer.invoke(IPC.VolumeCreate, projectId, title),
  chapterList: (projectId) => ipcRenderer.invoke(IPC.ChapterList, projectId),
  chapterGet: (chapterId) => ipcRenderer.invoke(IPC.ChapterGet, chapterId),
  chapterCreate: (payload) => ipcRenderer.invoke(IPC.ChapterCreate, payload),
  chapterSave: (payload) => ipcRenderer.invoke(IPC.ChapterSave, payload),
  getSettings: () => ipcRenderer.invoke(IPC.SettingsGet),
  providerCreate: (payload) => ipcRenderer.invoke(IPC.ProviderCreate, payload),
  providerUpdate: (payload) => ipcRenderer.invoke(IPC.ProviderUpdate, payload),
  providerDelete: (providerId) => ipcRenderer.invoke(IPC.ProviderDelete, providerId),
  providerTest: (payload) => ipcRenderer.invoke(IPC.ProviderTest, payload),
  saveModelConfig: (config) => ipcRenderer.invoke(IPC.ModelConfigSave, config),
  aiContinue: (params) => ipcRenderer.invoke(IPC.AIContinue, params),
  aiPolish: (params) => ipcRenderer.invoke(IPC.AIPolish, params),
  aiCancel: (requestId) => ipcRenderer.invoke(IPC.AICancel, requestId),
  onAiEvent: (cb) => {
    const listener = (_e: unknown, event: AiEvent): void => cb(event)
    ipcRenderer.on(IPC.AIEvent, listener)
    return () => {
      ipcRenderer.removeListener(IPC.AIEvent, listener)
    }
  },
  snapshotList: (chapterId) => ipcRenderer.invoke(IPC.SnapshotList, chapterId),
  snapshotCreate: (chapterId, kind, title) =>
    ipcRenderer.invoke(IPC.SnapshotCreate, chapterId, kind, title),
  snapshotRestore: (snapshotId) => ipcRenderer.invoke(IPC.SnapshotRestore, snapshotId)
}

contextBridge.exposeInMainWorld('inkcraft', api)
