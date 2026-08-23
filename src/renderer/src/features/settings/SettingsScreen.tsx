import { useEffect, useState, type ReactNode } from 'react'
import {
  NeuCard,
  NeuButton,
  Badge,
  Spinner,
  Toast,
  useToast,
  cx
} from '../../components/ui'
import { IconSpotify, IconYoutube, IconSparkle, IconLab, IconWave } from '../../components/ui/icons'
import { api } from '../../lib/api'
import type { IntegrationStatus } from '@shared/types'

function Row({
  icon,
  title,
  ok,
  detail,
  action,
  hint
}: {
  icon: ReactNode
  title: string
  ok: boolean
  detail: string
  action?: ReactNode
  hint?: string
}): ReactNode {
  return (
    <NeuCard className="p-4">
      <div className="flex flex-wrap items-center gap-4">
        <div className="neu-inset grid h-12 w-12 shrink-0 place-items-center rounded-[16px]">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold">{title}</span>
            <span className={cx('h-2 w-2 rounded-full', ok ? 'bg-ok' : 'bg-danger')} />
          </div>
          <div className="text-txt-dim mt-0.5 text-xs">{detail}</div>
          {hint && <div className="text-txt-micro mt-1.5 text-[11px] leading-snug">{hint}</div>}
        </div>
        {action}
      </div>
    </NeuCard>
  )
}

export function SettingsScreen(): ReactNode {
  const { toast, show, clear } = useToast()
  const [status, setStatus] = useState<IntegrationStatus | null>(null)
  const [paths, setPaths] = useState<{
    gptabs: string
    songs: string
    stems: string
    db: string
  } | null>(null)
  const [connecting, setConnecting] = useState(false)

  const refresh = async (): Promise<void> => {
    setStatus(await api.status.integrations())
    setPaths(await api.library.paths())
  }

  useEffect(() => {
    void refresh()
  }, [])

  const connectSpotify = async (): Promise<void> => {
    setConnecting(true)
    show('Abrindo o Spotify no seu navegador…')
    try {
      const res = await api.spotify.connect()
      if (res.ok) show('Spotify conectado', 'ok')
      else show(res.error ?? 'Falha ao conectar', 'danger')
      await refresh()
    } catch (err) {
      show(err instanceof Error ? err.message : 'Falha ao conectar', 'danger')
    } finally {
      setConnecting(false)
    }
  }

  if (!status) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner size={28} />
      </div>
    )
  }

  return (
    <div className="scroll-area h-full px-6 pb-4">
      <h1 className="mb-1 text-xl font-bold">Ajustes</h1>
      <p className="text-txt-dim mb-5 text-sm">
        Estado das integrações. Tudo que estiver desligado apenas desabilita aquele recurso — o
        app continua funcionando.
      </p>

      <div className="mb-5 space-y-3">
        <Row
          icon={<IconWave width={20} height={20} className="text-txt-micro" />}
          title="FFmpeg"
          ok={status.ffmpeg.available}
          detail={status.ffmpeg.version ?? 'não encontrado no PATH'}
          hint="Usado para ler tags, medir loudness e gerar a forma de onda. Roda sem Docker."
        />

        <Row
          icon={<IconSpotify width={20} height={20} className="text-txt-micro" />}
          title="Spotify"
          ok={status.spotify.connected}
          detail={status.spotify.detail}
          hint="Login abre no seu navegador (PKCE, sem senha no app). Serve para metadados e para comandar o Spotify aberto via Connect — a API de audio-features foi descontinuada pelo Spotify e não é mais usada."
          action={
            status.spotify.configured ? (
              status.spotify.connected ? (
                <NeuButton
                  onClick={async () => {
                    await api.spotify.disconnect()
                    await refresh()
                    show('Desconectado')
                  }}
                >
                  Desconectar
                </NeuButton>
              ) : (
                <NeuButton variant="accent" onClick={connectSpotify} disabled={connecting}>
                  {connecting ? <Spinner size={14} /> : 'Conectar'}
                </NeuButton>
              )
            ) : undefined
          }
        />

        <Row
          icon={<IconYoutube width={20} height={20} className="text-txt-micro" />}
          title="YouTube"
          ok={status.youtube.configured}
          detail={status.youtube.detail}
          hint={`Cota diária: ${status.youtube.quotaUsedToday}/${status.youtube.quotaLimit} unidades. Cada busca custa 100, então são ~100 músicas por dia. Uma busca por música cobre os três papéis.`}
        />

        <Row
          icon={<IconSparkle width={20} height={20} className="text-txt-micro" />}
          title="IA"
          ok={status.llm.configured}
          detail={status.llm.detail}
          hint="Gemini como principal e Ollama local como reserva. Se o Gemini falhar, o app cai automaticamente para o modelo local."
        />

        <Row
          icon={<IconLab width={20} height={20} className="text-txt-micro" />}
          title="Laboratório de Áudio"
          ok={status.lab.reachable}
          detail={`${status.lab.url} — ${status.lab.detail}`}
          hint={
            status.lab.reachable
              ? `GPU: ${status.lab.gpu ?? 'não informada'}`
              : 'Suba com "npm run lab:up". Só é necessário para stems e análise automática.'
          }
        />
      </div>

      {paths && (
        <NeuCard className="p-4">
          <div className="micro-label mb-3">Pastas</div>
          <div className="space-y-2 text-xs">
            {[
              ['Guitar Pro', paths.gptabs],
              ['Áudio', paths.songs],
              ['Stems', paths.stems],
              ['Banco de dados', paths.db]
            ].map(([label, p]) => (
              <div key={label} className="flex items-center gap-3">
                <span className="micro-label w-28 shrink-0">{label}</span>
                <button
                  onClick={() => void api.shell.showItem(p)}
                  className="hover:text-accent-2 min-w-0 flex-1 truncate text-left font-mono text-[11px]"
                  title={p}
                >
                  {p}
                </button>
              </div>
            ))}
          </div>
          <p className="text-txt-micro mt-3 text-[11px]">
            Configure esses caminhos no arquivo <code className="font-mono">.env</code> na raiz do
            projeto.
          </p>
        </NeuCard>
      )}

      {toast && <Toast message={toast.message} tone={toast.tone} onDismiss={clear} />}
    </div>
  )
}
