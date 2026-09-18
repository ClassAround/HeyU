import { useCallback, useEffect, useState } from 'react'
import DubPanel from './components/DubPanel'
import Settings from './components/Settings'
import Login from './components/Login'
import Onboarding from './components/Onboarding'
import type {
  CredentialStatus,
  GoogleProfile,
  JobProgress,
  SelectedVideo
} from '../../shared/types'

/**
 * 사용자 아바타.
 *
 * Google 프로필 이미지(lh3.googleusercontent.com)는 **referrer 가 붙으면 403** 을 돌려준다.
 * 그래서 referrerPolicy 를 꺼야 뜬다 — 이게 없으면 깨진 이미지 아이콘이 남는다.
 *
 * 그래도 실패할 수 있다(사진 미설정, 네트워크 차단 등). 그 경우 빈 자리를 남기지 않고
 * 이니셜로 떨어뜨린다. 아바타가 없다고 앱이 이상해 보일 이유는 없다.
 */
function Avatar({ src, email }: { src?: string; email: string }): JSX.Element {
  const [failed, setFailed] = useState(false)

  // 계정이 바뀌면 실패 기록을 지운다. 이전 계정의 실패가 새 사진을 가리면 안 된다.
  useEffect(() => setFailed(false), [src])

  if (!src || failed) {
    return <span className="avatar-fallback">{email.slice(0, 1).toUpperCase()}</span>
  }
  return (
    <img
      src={src}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  )
}

export default function App(): JSX.Element {
  const [status, setStatus] = useState<CredentialStatus>({
    heygen: false,
    google: false,
    heygenMcp: false
  })
  const [profile, setProfile] = useState<GoogleProfile | null>(null)
  const [video, setVideo] = useState<SelectedVideo | null>(null)
  const [job, setJob] = useState<JobProgress | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  /** 최초 1회 연결 안내. null 이면 아직 확인 전이다. */
  const [needsOnboarding, setNeedsOnboarding] = useState<boolean | null>(null)
  // 저장된 프로필을 읽기 전에는 로그인 화면을 깜빡이지 않는다.
  const [booting, setBooting] = useState(true)

  const refresh = useCallback(async (): Promise<void> => {
    setStatus(await window.heyu.creds.status())
    const p = await window.heyu.auth.profile()
    setProfile(p)
    // 연결 안내 여부도 같이 본다. 설정에서 "다시 보기" 를 눌렀을 때
    // 재시작 없이 바로 뜨려면 이 확인이 갱신 경로 안에 있어야 한다.
    setNeedsOnboarding(p ? await window.heyu.onboarding.needed() : null)
  }, [])

  useEffect(() => {
    void refresh().finally(() => setBooting(false))
    void window.heyu.job.current().then(setJob)
    // 메인 프로세스가 흘려보내는 진행 상황을 구독한다.
    const offJob = window.heyu.job.onProgress(setJob)
    return () => {
      offJob()
    }
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

  // 확인 전에는 본 화면을 깜빡이지 않는다.
  if (needsOnboarding === null) return <div className="gate" />

  if (needsOnboarding) {
    return (
      <Onboarding
        status={status}
        onChanged={() => void refresh()}
        onDone={() => {
          void window.heyu.onboarding.complete()
          setNeedsOnboarding(false)
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
          <Avatar src={profile.picture} email={profile.email} />
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
          hasHeygen={status.heygenMcp}
          onOpenSettings={() => setShowSettings(true)}
        />
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
