import { useState } from 'react'
import type { ProjectDTO } from '@inkcraft/shared'
import { Bookshelf } from './pages/Bookshelf'
import { GenesisWizard } from './pages/GenesisWizard'
import { Settings } from './pages/Settings'
import { Workbench } from './pages/Workbench'

export default function App() {
  const [project, setProject] = useState<ProjectDTO | null>(null)
  const [wizardProject, setWizardProject] = useState<ProjectDTO | null>(null)
  const [view, setView] = useState<'library' | 'settings'>('library')

  const enterWorkbench = (): void => {
    if (wizardProject) {
      setProject(wizardProject)
      setWizardProject(null)
    }
  }

  return (
    <div className="app">
      {project ? (
        <Workbench project={project} onBack={() => setProject(null)} />
      ) : wizardProject ? (
        <GenesisWizard project={wizardProject} onFinish={enterWorkbench} onSkip={enterWorkbench} />
      ) : view === 'settings' ? (
        <Settings onBack={() => setView('library')} />
      ) : (
        <Bookshelf onOpen={setProject} onStartWizard={setWizardProject} onOpenSettings={() => setView('settings')} />
      )}
    </div>
  )
}
