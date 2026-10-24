import { ipcMain } from 'electron'
import { IPC } from '@inkcraft/shared'
import type {
  AppInfoDTO,
  CreateChapterPayload,
  CreateProjectPayload,
  CreateProviderPayload,
  ModelConfigDTO,
  ProviderTestPayload,
  SaveChapterPayload,
  UpdateProjectPayload,
  UpdateProviderPayload
} from '@inkcraft/shared'
import type { LibraryService } from './services/libraryService'
import type { SettingService } from './services/settingService'

/**
 * 注册全部 IPC 通道。preload 侧的 InkcraftApi 与这里的参数/返回一一对应，
 * 契约以 packages/shared 的 IPC 常量为准。
 */
export function registerIpc(
  service: LibraryService,
  settingService: SettingService,
  meta: { version: string; dbPath: string }
): void {
  const handle = (channel: string, fn: (...args: unknown[]) => unknown): void => {
    ipcMain.handle(channel, (_event, ...args) => {
      try {
        return fn(...args)
      } catch (err) {
        // zod 校验错误等信息透传给渲染层
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    })
  }

  handle(IPC.AppInfo, (): AppInfoDTO => ({ ...meta, platform: process.platform }))
  handle(IPC.ProjectList, () => service.listProjects())
  handle(IPC.ProjectCreate, (p) => service.createProject(p as CreateProjectPayload))
  handle(IPC.ProjectUpdate, (p) => service.updateProject(p as UpdateProjectPayload))
  handle(IPC.ProjectDelete, (id) => service.deleteProject(id as string))
  handle(IPC.VolumeList, (projectId) => service.listVolumes(projectId as string))
  handle(IPC.VolumeCreate, (projectId, title) =>
    service.createVolume(projectId as string, title as string)
  )
  handle(IPC.ChapterList, (projectId) => service.listChapters(projectId as string))
  handle(IPC.ChapterGet, (chapterId) => service.getChapter(chapterId as string))
  handle(IPC.ChapterCreate, (p) => service.createChapter(p as CreateChapterPayload))
  handle(IPC.ChapterSave, (p) => service.saveChapter(p as SaveChapterPayload))

  handle(IPC.SettingsGet, () => settingService.getSettings())
  handle(IPC.ProviderCreate, (p) => settingService.createProvider(p as CreateProviderPayload))
  handle(IPC.ProviderUpdate, (p) => settingService.updateProvider(p as UpdateProviderPayload))
  handle(IPC.ProviderDelete, (id) => settingService.deleteProvider(id as string))
  handle(IPC.ProviderTest, (p) => settingService.testProvider(p as ProviderTestPayload))
  handle(IPC.ModelConfigSave, (c) => settingService.saveModelConfig(c as ModelConfigDTO))
}
