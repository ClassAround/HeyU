import { useCallback, useEffect, useState } from 'react'
import DubPanel from './components/DubPanel'
import Chat from './components/Chat'
import Settings from './components/Settings'
import Login from './components/Login'
import type {
  CredentialStatus,
  GoogleProfile,
  JobProgress,
  SelectedVideo
} from '../../shared/types'

export default function App(): JSX.Element {
  const [status, setStatus] = useState<CredentialStatus>({
    heygen: false,
    openai: false,
    google: false
  })
  const [profile, setProfile] = useState<GoogleProfile | null>(null)
  const [video, setVideo] = useState<SelectedVideo | null>(null)
  const [job, setJob] = useState<JobProgress | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  // 저장된 프로필을 읽기 전에는 로그인 화면을 깜빡이지 않는다.
  const [booting, setBooting] = useState(true)

  const refresh = useCallback(async (): Promise<void> => {
    setStatus(await window.heyu.creds.status())
    setProfile(await window.heyu.auth.profile())
  }, [])

  useEffect(() => {
    void refresh().finally(() => setBooting(false))
    void window.heyu.job.current().then(setJob)
    // 메인 프로세스가 흘려보내는 진행 상황을 구독한다.
    return window.heyu.job.onProgress(setJob)
  }, [refresh])

  const signOut = async (): Promise<void> => {
    await window.heyu.auth.signOut()
    setProfile(null)
    void refresh()
  }

  if (booting) return <div className="gate" />

  if (!profile) {
    return (
      <Login
        onSignedIn={(p) => {
          setProfile(p)
          void refresh()
        }}
      />
    )
  }

  return (
    <div className="app">
      <header className="titlebar">
        <div className="brand">
          <span className="dot" />
          HeyU
          <small>영어 립싱크 더빙</small>
        </div>

        <div className="who">
          {profile.picture && <img src={profile.picture} alt="" />}
          <span>{profile.email}</span>
          <button className="btn ghost sm" onClick={() => void signOut()}>
            로그아웃
          </button>
          <button className="btn ghost sm" onClick={() => setShowSettings(true)}>
            설정
          </button>
        </div>
      </header>

      <div className="panes">
        <DubPanel
          video={video}
          setVideo={setVideo}
          job={job}
          hasHeygen={status.heygen}
          onOpenSettings={() => setShowSettings(true)}
        />
        <Chat enabled={status.openai} onOpenSettings={() => setShowSettings(true)} />
      </div>

      {showSettings && (
        <Settings
          status={status}
          onClose={() => setShowSettings(false)}
          onSaved={() => void refresh()}
        />
      )}
    </div>
  )
}
