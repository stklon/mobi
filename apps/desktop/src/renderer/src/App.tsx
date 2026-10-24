import { useState } from 'react'
import type { ProjectDTO } from '@inkcraft/shared'
import { Bookshelf } from './pages/Bookshelf'
import { Settings } from './pages/Settings'
import { Workbench } from './pages/Workbench'

export default function App() {
  const [project, setProject] = useState<ProjectDTO | null>(null)
  const [view, setView] = useState<'library' | 'settings'>('library')

  return (
    <div className="app">
      {project ? (
        <Workbench project={project} onBack={() => setProject(null)} />
      ) : view === 'settings' ? (
        <Settings onBack={() => setView('library')} />
      ) : (
        <Bookshelf onOpen={setProject} onOpenSettings={() => setView('settings')} />
      )}
    </div>
  )
}
