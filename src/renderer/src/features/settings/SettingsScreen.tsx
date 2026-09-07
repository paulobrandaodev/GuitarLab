import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  NeuCard,
  NeuButton,
  NeuSelect,
  Spinner,
  Toast,
  useToast,
  cx
} from '../../components/ui'
import { IconSpotify, IconYoutube, IconSparkle, IconLab, IconWave } from '../../components/ui/icons'
import { api, isError } from '../../lib/api'
import { SettingField } from './SettingField'
import { LOCALES, LOCALE_NAMES } from '@shared/i18n'
import { useStrings } from '../../lib/i18n'
import type { IntegrationStatus, SettingView, SettingsSnapshot } from '@shared/types'

/** The folders the user is allowed to move; the database stays with the app. */
type LibraryFolder = 'gptabs' | 'songs' | 'stems'

/**
 * Labels and help for each configurable setting.
 *
 * Kept as data rather than as markup so the screen is a loop instead of two
 * hundred lines of repeated JSX, and so adding a provider is one entry.
 */
const FIELDS: Record<string, { label: string; hint?: string; placeholder?: string }> = {
  spotifyClientId: {
    label: 'Client ID',
    hint: 'Crie um app em developer.spotify.com/dashboard. É o fluxo PKCE, então não existe client secret.'
  },
  spotifyRedirectUri: {
    label: 'Redirect URI',
    hint: 'Precisa estar registrado igualzinho nas configurações do seu app do Spotify.'
  },
  youtubeApiKey: {
    label: 'Chave da API',
    hint: 'console.cloud.google.com → ative a "YouTube Data API v3" → criar credencial. A cota grátis dá ~100 músicas por dia.'
  },
  geminiApiKey: { label: 'Gemini — chave', hint: 'aistudio.google.com/apikey' },
  geminiModel: { label: 'Gemini — modelo' },
  openaiApiKey: { label: 'OpenAI — chave', hint: 'platform.openai.com/api-keys' },
  openaiModel: { label: 'OpenAI — modelo' },
  openaiBaseUrl: {
    label: 'OpenAI — endereço',
    hint: 'Dá para apontar para qualquer serviço compatível com a API da OpenAI.'
  },
  groqApiKey: { label: 'Groq — chave', hint: 'console.groq.com/keys' },
  groqModel: { label: 'Groq — modelo' },
  ollamaBaseUrl: {
    label: 'Ollama — endereço',
    hint: 'Modelos locais, sem chave e sem nada saindo da sua máquina. Instale em ollama.com.'
  },
  ollamaModel: { label: 'Ollama — modelo', placeholder: 'ex.: llama3.1:8b' },
  labUrl: { label: 'Endereço do laboratório' },
  demucsModel: {
    label: 'Modelo do Demucs',
    hint: 'htdemucs_6s separa em 6 faixas; htdemucs faz 4 com qualidade melhor.'
  },
  demucsSegment: {
    label: 'Segmento',
    hint: 'Fatia o áudio para caber na memória da GPU. Menor = menos VRAM.'
  },
  ffmpegPath: {
    label: 'Caminho do FFmpeg',
    hint: 'Vazio usa o que estiver no PATH. O ffprobe é derivado desse mesmo caminho.'
  }
}

const PROVIDERS = ['gemini', 'openai', 'groq', 'ollama'] as const

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

/** A collapsible group of settings. Closed by default: most people touch one. */
function Group({
  title,
  subtitle,
  children,
  defaultOpen = false
}: {
  title: string
  subtitle?: string
  children: ReactNode
  defaultOpen?: boolean
}): ReactNode {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <NeuCard className="p-4">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <div>
          <div className="micro-label">{title}</div>
          {subtitle && <div className="text-txt-micro mt-1 text-[11px]">{subtitle}</div>}
        </div>
        <span className="text-txt-micro text-xs">{open ? '−' : '+'}</span>
      </button>
      {open && <div className="divide-edge mt-2 divide-y">{children}</div>}
    </NeuCard>
  )
}

export function SettingsScreen(): ReactNode {
  const str = useStrings()
  const { toast, show, clear } = useToast()
  /*
   * FFmpeg is the app's one outside dependency, and "install it and put it on
   * your PATH" is exactly where someone who does not use a terminal stops. The
   * download is the same one the Lab uses, so this is a button rather than a
   * paragraph of instructions.
   */
  const [ffmpeg, setFfmpeg] = useState<string | null>(null)

  useEffect(() => {
    return api.tools.onProgress((progress) => {
      if (progress.status === 'downloading') {
        const pct = progress.totalBytes
          ? ` ${Math.round((progress.receivedBytes / progress.totalBytes) * 100)}%`
          : ''
        setFfmpeg(`Baixando${pct}`)
      } else if (progress.status === 'extracting') {
        setFfmpeg('Instalando')
      }
    })
  }, [])

  const installFfmpeg = async (): Promise<void> => {
    setFfmpeg('Baixando')
    const res = await api.tools.installFfmpeg()
    setFfmpeg(null)
    if (isError(res)) show(res.error, 'danger')
    else show('FFmpeg instalado', 'ok')
    await refresh()
  }
  const [status, setStatus] = useState<IntegrationStatus | null>(null)
  const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null)
  const [paths, setPaths] = useState<{
    gptabs: string
    songs: string
    stems: string
    db: string
  } | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [testing, setTesting] = useState<string | null>(null)
  const [probe, setProbe] = useState<Record<string, { ok: boolean; detail: string }>>({})

  const refresh = useCallback(async (): Promise<void> => {
    const [next, snap, folders] = await Promise.all([
      api.status.integrations(),
      api.settings.get(),
      api.library.paths()
    ])
    setStatus(next)
    setSnapshot(snap)
    setPaths(folders)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const byKey = (key: string): SettingView | undefined =>
    snapshot?.settings.find((s) => s.key === key)

  const save = async (key: string, value: string): Promise<void> => {
    const res = await api.settings.set({ [key]: value })
    if (!res.ok) {
      show(res.error ?? 'Não deu para salvar', 'danger')
      return
    }
    show('Salvo', 'ok')
    await refresh()
  }

  const test = async (provider: string): Promise<void> => {
    setTesting(provider)
    try {
      const res = await api.settings.testProvider(provider)
      setProbe((prev) => ({ ...prev, [provider]: res }))
    } catch (err) {
      setProbe((prev) => ({
        ...prev,
        [provider]: { ok: false, detail: err instanceof Error ? err.message : 'Falhou' }
      }))
    } finally {
      setTesting(null)
      await refresh()
    }
  }

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

  /** Pick a folder and restart into it; the main process owns both halves. */
  const changeFolder = async (key: LibraryFolder): Promise<void> => {
    const picked = await api.shell.pickFolder()
    if (!picked) return
    show('Pasta salva — reiniciando o GuitarLab…', 'ok')
    await api.library.setPaths({ [key]: picked })
  }

  if (!status || !snapshot) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner size={28} />
      </div>
    )
  }

  const noEncryption = snapshot.encryption.available ? undefined : snapshot.encryption.hint

  const field = (key: string): ReactNode => {
    const view = byKey(key)
    if (!view) return null
    return (
      <SettingField
        key={key}
        view={view}
        disabled={noEncryption}
        onSave={(value) => save(key, value)}
        {...FIELDS[key]}
      />
    )
  }

  /* What is still missing, in the order it hurts. FFmpeg first: it is the only
     hard requirement, and without it audio import throws with no warning. */
  const todo = [
    !status.ffmpeg.available && 'Instalar o FFmpeg e deixá-lo no PATH',
    !status.llm.configured && 'Configurar um provedor de IA (ou rodar o Ollama local)',
    !status.spotify.configured && 'Adicionar o Client ID do Spotify (opcional)',
    !status.youtube.configured && 'Adicionar a chave do YouTube (opcional)'
  ].filter(Boolean) as string[]

  return (
    <div className="scroll-area h-full px-6 pb-4">
      <h1 className="mb-1 text-xl font-bold">Ajustes</h1>
      <p className="text-txt-dim mb-5 text-sm">
        Cole aqui as suas chaves — elas ficam criptografadas nesta máquina e nunca saem dela. Tudo
        que estiver desligado apenas desabilita aquele recurso; o app continua funcionando.
      </p>

      {todo.length > 0 && (
        <NeuCard className="mb-5 p-4">
          <div className="micro-label mb-2">Primeiros passos</div>
          <ul className="space-y-1.5 text-xs">
            {todo.map((item) => (
              <li key={item} className="text-txt-dim flex items-start gap-2">
                <span className="text-txt-micro mt-0.5">○</span>
                {item}
              </li>
            ))}
          </ul>
          <p className="text-txt-micro mt-3 text-[11px] leading-snug">
            Só o FFmpeg é obrigatório — sem ele a importação de áudio falha. O resto é opcional.
          </p>
        </NeuCard>
      )}

      {!snapshot.encryption.available && (
        <NeuCard className="mb-5 p-4">
          <div className="text-danger micro-label mb-1">Sem criptografia do sistema</div>
          <p className="text-txt-dim text-xs leading-snug">
            {snapshot.encryption.hint} As chaves de API não podem ser guardadas — preferimos não
            gravar nada a gravar em texto puro. Você ainda pode usar o arquivo{' '}
            <code className="font-mono">.env</code>, e o resto dos ajustes funciona normalmente.
          </p>
        </NeuCard>
      )}

      <div className="mb-5 space-y-3">
        <Row
          icon={<IconWave width={20} height={20} className="text-txt-micro" />}
          title="FFmpeg"
          ok={status.ffmpeg.available}
          detail={status.ffmpeg.version ?? 'não encontrado no PATH'}
          hint="O único requisito externo: lê tags, mede loudness e gera a forma de onda. O app pode baixá-lo para você."
          action={
            status.ffmpeg.available ? undefined : (
              <NeuButton variant="accent" onClick={installFfmpeg} disabled={ffmpeg !== null}>
                {ffmpeg ? ffmpeg : 'Baixar e instalar'}
              </NeuButton>
            )
          }
        />

        <Row
          icon={<IconSpotify width={20} height={20} className="text-txt-micro" />}
          title="Spotify"
          ok={status.spotify.connected}
          detail={status.spotify.detail}
          hint="O login abre no seu navegador (PKCE, sem senha no app). Serve para metadados e para comandar o Spotify aberto via Connect."
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
          hint={`Cota de hoje: ${status.youtube.quotaUsedToday}/${status.youtube.quotaLimit} unidades. Cada busca custa 100, então dá ~100 músicas por dia.`}
        />

        <Row
          icon={<IconSparkle width={20} height={20} className="text-txt-micro" />}
          title="IA"
          ok={status.llm.configured}
          detail={status.llm.detail}
          hint="O provedor principal é tentado primeiro; se falhar, o app cai para os da reserva, na ordem."
        />

        <Row
          icon={<IconLab width={20} height={20} className="text-txt-micro" />}
          title="Laboratório de Áudio"
          ok={status.lab.reachable}
          detail={`${status.lab.url} — ${status.lab.detail}`}
          hint={
            status.lab.reachable
              ? `GPU: ${status.lab.gpu ?? 'não informada'}`
              : 'Instale e ligue na aba Laboratório. Só é necessário para stems e análise automática.'
          }
        />
      </div>

      <div className="mb-5 space-y-3">
        <Group
          title="Inteligência artificial"
          subtitle="Planos de treino, análise de técnica e patches de timbre"
          defaultOpen={!status.llm.configured}
        >
          <div className="py-3">
            <div className="micro-label mb-2">Provedor principal</div>
            <NeuSelect
              options={PROVIDERS.map((p) => ({ value: p, label: p }))}
              value={byKey('llmProvider')?.value ?? 'gemini'}
              onChange={(v) => void save('llmProvider', v)}
            />
            <p className="text-txt-micro mt-1.5 text-[11px] leading-snug">
              Se ele falhar, o app tenta os da reserva na ordem abaixo.
            </p>
          </div>

          {(() => {
            const view = byKey('llmFallbackProvider')
            return view ? (
              <SettingField
                view={view}
                label="Reserva"
                hint="Separados por vírgula, tentados nessa ordem. Deixar o Ollama por último cobre o caso de tudo mais estar fora do ar."
                onSave={(v) => save('llmFallbackProvider', v)}
              />
            ) : null
          })()}

          {PROVIDERS.map((provider) => (
            <div key={provider} className="py-1">
              <div className="flex items-center justify-between gap-3 pt-3">
                <span className="text-xs font-semibold capitalize">{provider}</span>
                <div className="flex items-center gap-2">
                  {probe[provider] && (
                    <span
                      className={cx(
                        'text-[10px]',
                        probe[provider].ok ? 'text-ok' : 'text-danger'
                      )}
                    >
                      {probe[provider].detail}
                    </span>
                  )}
                  <NeuButton
                    className="!px-3 !py-1 !text-[10px]"
                    disabled={testing === provider}
                    onClick={() => void test(provider)}
                  >
                    {testing === provider ? <Spinner size={11} /> : 'testar'}
                  </NeuButton>
                </div>
              </div>
              {provider === 'gemini' && (
                <>
                  {field('geminiApiKey')}
                  {field('geminiModel')}
                </>
              )}
              {provider === 'openai' && (
                <>
                  {field('openaiApiKey')}
                  {field('openaiModel')}
                  {field('openaiBaseUrl')}
                </>
              )}
              {provider === 'groq' && (
                <>
                  {field('groqApiKey')}
                  {field('groqModel')}
                </>
              )}
              {provider === 'ollama' && (
                <>
                  {field('ollamaBaseUrl')}
                  {field('ollamaModel')}
                </>
              )}
            </div>
          ))}
        </Group>

        <Group title="Spotify" subtitle="Metadados e controle do player aberto">
          {field('spotifyClientId')}
          {field('spotifyRedirectUri')}
        </Group>

        <Group title="YouTube" subtitle="Busca de aulas, backing tracks e playthroughs">
          {field('youtubeApiKey')}
        </Group>

        <Group title="Laboratório de áudio" subtitle="Separação de stems e análise automática">
          {field('labUrl')}
          {field('demucsModel')}
          {field('demucsSegment')}
        </Group>

        <Group title="FFmpeg">{field('ffmpegPath')}</Group>
      </div>

      <NeuCard className="mb-5 p-4">
        <div className="micro-label mb-3">Idioma</div>
        <NeuSelect
          options={[
            { value: 'auto', label: `Automático (${LOCALE_NAMES[snapshot.locale as never] ?? snapshot.locale})` },
            ...LOCALES.map((l) => ({ value: l, label: LOCALE_NAMES[l] }))
          ]}
          value={byKey('locale')?.value || 'auto'}
          onChange={(v) => void save('locale', v)}
        />
        <p className="text-txt-micro mt-2 text-[11px] leading-snug">
          Automático segue o idioma do sistema operacional.
        </p>
      </NeuCard>

      <NeuCard className="mb-5 p-4">
        <div className="micro-label mb-2">{str.support.title}</div>
        <p className="text-txt-dim mb-3 text-xs leading-snug">{str.support.body}</p>
        <div className="flex flex-wrap gap-2">
          <NeuButton
            variant="accent"
            onClick={() =>
              void api.shell.openExternal('https://github.com/sponsors/paulobrandaodev')
            }
          >
            {str.support.sponsor}
          </NeuButton>
          <NeuButton
            onClick={() => void api.shell.openExternal('https://ko-fi.com/paulobrandaodev')}
          >
            {str.support.kofi}
          </NeuButton>
        </div>
        <div className="text-txt-micro mt-2.5 space-y-1 text-[11px] leading-snug">
          <p>
            <span className="text-txt-dim">{str.support.sponsor}</span> — {str.support.sponsorHint}
          </p>
          <p>
            <span className="text-txt-dim">{str.support.kofi}</span> — {str.support.kofiHint}
          </p>
          <p className="pt-1">{str.support.otherWays}</p>
        </div>
      </NeuCard>

      {paths && (
        <NeuCard className="p-4">
          <div className="micro-label mb-3">Pastas</div>
          <div className="space-y-2 text-xs">
            {(
              [
                ['Guitar Pro', paths.gptabs, 'gptabs'],
                ['Áudio', paths.songs, 'songs'],
                ['Stems', paths.stems, 'stems'],
                ['Banco de dados', paths.db, null]
              ] as Array<[string, string, LibraryFolder | null]>
            ).map(([label, p, key]) => (
              <div key={label} className="flex items-center gap-3">
                <span className="micro-label w-28 shrink-0">{label}</span>
                <button
                  onClick={() => void api.shell.showItem(p)}
                  className="hover:text-accent-2 min-w-0 flex-1 truncate text-left font-mono text-[11px]"
                  title={p}
                >
                  {p}
                </button>
                {key && (
                  <NeuButton
                    className="!px-2.5 !py-1 !text-[10px]"
                    onClick={() => void changeFolder(key)}
                  >
                    alterar
                  </NeuButton>
                )}
              </div>
            ))}
          </div>
          <p className="text-txt-micro mt-3 text-[11px] leading-snug">
            Trocar uma pasta reinicia o GuitarLab — os caminhos são lidos uma vez, na abertura.
            Chaves, modelos e endereços não reiniciam nada. As músicas já importadas continuam
            apontando para os arquivos onde estão.
          </p>
        </NeuCard>
      )}

      {toast && <Toast message={toast.message} tone={toast.tone} onDismiss={clear} />}
    </div>
  )
}
