import { plural } from './index'

/**
 * The source of truth for every string in the app.
 *
 * Brazilian Portuguese leads because every string in this codebase started
 * there: moving them here is a pure move, with no translation risk mixed in.
 * `en.ts` and `es.ts` are declared as `Catalog`, so a missing key, a spare key
 * or a function with the wrong arity is a compile error — `npm run typecheck`,
 * which already runs in `npm test`, is the guard that keeps the three in step.
 *
 * Entries are functions when they interpolate, so the compiler checks the
 * arguments too. There is no `t('some.key')` anywhere: a string key would give
 * back exactly the class of runtime bug this shape removes.
 *
 * There is deliberately no `as const`: it would make every literal part of the
 * type, and then en.ts would have to repeat the Portuguese strings verbatim to
 * compile. Widening to `string` is what lets the type check the *shape* while
 * leaving the words free.
 *
 * Keep entries as plain object literals — no computed keys — so a 30-line
 * script could serialise this to JSON for a translation platform later.
 */
export const ptBR = {
  common: {
    save: 'Salvar',
    cancel: 'Cancelar',
    close: 'Fechar',
    delete: 'Excluir',
    edit: 'Editar',
    add: 'Adicionar',
    remove: 'Remover',
    open: 'Abrir',
    back: 'Voltar',
    search: 'Buscar',
    loading: 'Carregando',
    retry: 'Tentar de novo',
    confirm: 'Confirmar',
    none: 'nenhum',
    never: 'nunca',
    now: 'agora',
    yes: 'Sim',
    no: 'Não',
    change: 'alterar',
    test: 'testar',
    show: 'ver',
    hide: 'ocultar',
    empty: '—'
  },

  units: {
    /** Suffixes for a total running time: "1h 12min". */
    hour: 'h',
    minute: 'min',
    bpm: 'BPM',
    seconds: (n: number) => `${n} ${plural(n, 'segundo', 'segundos')}`,
    songs: (n: number) => `${n} ${plural(n, 'música', 'músicas')}`,
    sections: (n: number) => `${n} ${plural(n, 'trecho', 'trechos')}`,
    tracks: (n: number) => `${n} ${plural(n, 'faixa', 'faixas')}`
  },

  nav: {
    setlist: 'Setlist',
    practice: 'Estudar',
    progress: 'Progresso',
    lab: 'Laboratório',
    settings: 'Ajustes',
    tuner: 'Afinador',
    song: 'Música',
    stage: 'Palco'
  },

  /** Labels that used to live in shared/types.ts and shared/sort.ts. */
  labels: {
    status: {
      not_started: 'Não começou',
      learning: 'Aprendendo',
      shaky: 'Inseguro',
      solid: 'Firme',
      gig_ready: 'Pronto pro show'
    },
    instrument: {
      guitar: 'Guitarra',
      bass: 'Baixo',
      drums: 'Bateria',
      vocals: 'Voz'
    },
    /** Most of these are YouTube jargon and stay in English in every language. */
    role: {
      lesson_tabs: 'Lesson w/ Tabs',
      backing_track: 'Backing Track',
      guitar_only: 'Guitar Only',
      bass_only: 'Bass Only',
      drums_only: 'Drums Only',
      official: 'Oficial',
      live: 'Ao vivo',
      cover: 'Cover',
      unknown: 'Sem classificação'
    },
    output: {
      pa: 'PA / mesa de som',
      fones: 'Fones de ouvido',
      amp: 'Amplificador'
    },
    sort: {
      ordem: 'ordem',
      banda: 'banda',
      musica: 'música',
      afinacao: 'afinação',
      duracao: 'duração'
    },
    sortDir: {
      ordem: { asc: 'ordem do show', desc: 'ordem do show' },
      banda: { asc: 'A–Z', desc: 'Z–A' },
      musica: { asc: 'A–Z', desc: 'Z–A' },
      afinacao: {
        asc: 'E Standard no topo, resto A–Z',
        desc: 'E Standard no topo, resto Z–A'
      },
      duracao: { asc: 'menor → maior', desc: 'maior → menor' }
    }
  },

  settings: {
    title: 'Ajustes',
    intro:
      'Cole aqui as suas chaves — elas ficam criptografadas nesta máquina e nunca saem dela. Tudo que estiver desligado apenas desabilita aquele recurso; o app continua funcionando.',
    firstSteps: 'Primeiros passos',
    firstStepsHint:
      'Só o FFmpeg é obrigatório — sem ele a importação de áudio falha. O resto é opcional.',
    todoFfmpeg: 'Instalar o FFmpeg e deixá-lo no PATH',
    todoLlm: 'Configurar um provedor de IA (ou rodar o Ollama local)',
    todoSpotify: 'Adicionar o Client ID do Spotify (opcional)',
    todoYoutube: 'Adicionar a chave do YouTube (opcional)',

    noEncryption: 'Sem criptografia do sistema',
    noEncryptionBody:
      'As chaves de API não podem ser guardadas — preferimos não gravar nada a gravar em texto puro. Você ainda pode usar o arquivo .env, e o resto dos ajustes funciona normalmente.',

    saved: 'Salvo',
    saveFailed: 'Não deu para salvar',
    keyStored: 'chave guardada',
    notConfigured: 'não configurado',
    keepPlaceholder: '•••••••• (deixe vazio para manter)',
    envWarning:
      'Uma variável de ambiente está definindo esse valor e tem prioridade sobre o que você salvar aqui. Remova-a do ambiente para usar este campo.',

    source: {
      env: 'variável de ambiente',
      user: 'salvo por você',
      dotenv: 'do arquivo .env',
      default: 'padrão'
    },

    groupAi: 'Inteligência artificial',
    groupAiSub: 'Planos de treino, análise de técnica e patches de timbre',
    groupSpotify: 'Spotify',
    groupSpotifySub: 'Metadados e controle do player aberto',
    groupYoutube: 'YouTube',
    groupYoutubeSub: 'Busca de aulas, backing tracks e playthroughs',
    groupLab: 'Laboratório de áudio',
    groupLabSub: 'Separação de stems e análise automática',
    groupFfmpeg: 'FFmpeg',

    primaryProvider: 'Provedor principal',
    primaryProviderHint: 'Se ele falhar, o app tenta os da reserva na ordem abaixo.',
    fallback: 'Reserva',
    fallbackHint:
      'Separados por vírgula, tentados nessa ordem. Deixar o Ollama por último cobre o caso de tudo mais estar fora do ar.',

    language: 'Idioma',
    languageAuto: (name: string) => `Automático (${name})`,
    languageHint: 'Automático segue o idioma do sistema operacional.',

    folders: 'Pastas',
    folderGuitarPro: 'Guitar Pro',
    folderAudio: 'Áudio',
    folderStems: 'Stems',
    folderDb: 'Banco de dados',
    folderSaved: 'Pasta salva — reiniciando o GuitarLab…',
    foldersHint:
      'Trocar uma pasta reinicia o GuitarLab — os caminhos são lidos uma vez, na abertura. Chaves, modelos e endereços não reiniciam nada. As músicas já importadas continuam apontando para os arquivos onde estão.',

    connect: 'Conectar',
    disconnect: 'Desconectar',
    disconnected: 'Desconectado',
    connected: 'Spotify conectado',
    connecting: 'Abrindo o Spotify no seu navegador…',
    connectFailed: 'Falha ao conectar',

    ffmpegMissing: 'não encontrado no PATH',
    ffmpegHint:
      'O único requisito externo: lê tags, mede loudness e gera a forma de onda. O app pode baixá-lo para você.',
    spotifyHint:
      'O login abre no seu navegador (PKCE, sem senha no app). Serve para metadados e para comandar o Spotify aberto via Connect.',
    youtubeQuota: (used: number, limit: number) =>
      `Cota de hoje: ${used}/${limit} unidades. Cada busca custa 100, então dá ~100 músicas por dia.`,
    llmHint:
      'O provedor principal é tentado primeiro; se falhar, o app cai para os da reserva, na ordem.',
    labGpu: (gpu: string) => `GPU: ${gpu}`,
    labGpuUnknown: 'não informada',
    labOffline:
      'Instale e ligue na aba Laboratório. Só é necessário para stems e análise automática.',

    fields: {
      spotifyClientId: 'Client ID',
      spotifyClientIdHint:
        'Crie um app em developer.spotify.com/dashboard. É o fluxo PKCE, então não existe client secret.',
      spotifyRedirectUri: 'Redirect URI',
      spotifyRedirectUriHint:
        'Precisa estar registrado igualzinho nas configurações do seu app do Spotify.',
      youtubeApiKey: 'Chave da API',
      youtubeApiKeyHint:
        'console.cloud.google.com → ative a "YouTube Data API v3" → criar credencial. A cota grátis dá ~100 músicas por dia.',
      geminiApiKey: 'Gemini — chave',
      geminiModel: 'Gemini — modelo',
      openaiApiKey: 'OpenAI — chave',
      openaiModel: 'OpenAI — modelo',
      openaiBaseUrl: 'OpenAI — endereço',
      openaiBaseUrlHint: 'Dá para apontar para qualquer serviço compatível com a API da OpenAI.',
      groqApiKey: 'Groq — chave',
      groqModel: 'Groq — modelo',
      ollamaBaseUrl: 'Ollama — endereço',
      ollamaBaseUrlHint:
        'Modelos locais, sem chave e sem nada saindo da sua máquina. Instale em ollama.com.',
      ollamaModel: 'Ollama — modelo',
      labUrl: 'Endereço do laboratório',
      demucsModel: 'Modelo do Demucs',
      demucsModelHint: 'htdemucs_6s separa em 6 faixas; htdemucs faz 4 com qualidade melhor.',
      demucsSegment: 'Segmento',
      demucsSegmentHint: 'Fatia o áudio para caber na memória da GPU. Menor = menos VRAM.',
      ffmpegPath: 'Caminho do FFmpeg',
      ffmpegPathHint:
        'Vazio usa o que estiver no PATH. O ffprobe é derivado desse mesmo caminho.'
    }
  },

  support: {
    title: 'Apoie o projeto',
    body:
      'O GuitarLab é livre e de código aberto, e vai continuar sendo — não existe versão paga. Se ele te ajuda, dá para retribuir.',
    sponsor: 'GitHub Sponsors',
    sponsorHint: 'Sem taxa nenhuma. Precisa de conta no GitHub.',
    kofi: 'Ko-fi',
    kofiHint: 'Não precisa de conta. Cartão ou PayPal, de qualquer país.',
    otherWays: 'Relatar um bug ou traduzir uma tela ajuda do mesmo jeito.'
  },

  setup: {
    ffmpegMissing:
      'O FFmpeg não foi encontrado. Sem ele, importar áudio não funciona — é o único requisito obrigatório do app.',
    howToInstall: 'como instalar',
    openSettings: 'ajustes',
    dismiss: 'dispensar'
  },

  setlist: {
    library: 'Biblioteca',
    noSongs: 'Nenhuma música ainda',
    noSongsBody:
      'Aponte para onde estão seus arquivos e importe. Tablaturas .gp e áudios ficam em pastas separadas.',
    import: 'Importar',
    chooseFolders: 'Escolher pastas'
  },

  /**
   * Adding a setlist or a song by hand, with no file to import.
   *
   * What is required here is the least that makes the thing exist and findable
   * later: a name for the setlist, a title and an artist for the song. All the
   * rest is what a file would have carried, and can be filled in when it shows
   * up.
   */
  manual: {
    newSetlist: 'Novo setlist',
    newSong: 'Nova música',
    addSong: 'Adicionar música',
    required: 'obrigatório',
    create: 'Criar',
    createAndOpen: 'Criar e abrir',
    moreFields: 'mais campos',
    fewerFields: 'menos campos',

    setlistHint: 'Só o nome é obrigatório. Data, local e anotações você preenche quando souber.',
    setlistName: 'Nome do setlist',
    setlistNamePlaceholder: 'ex.: Show do Sesc',
    band: 'Banda',
    bandPlaceholder: 'ex.: Cover Metallica',
    eventDate: 'Data do show',
    venue: 'Local',
    venuePlaceholder: 'ex.: Sesc Pompeia',
    setlistCreated: (name: string) => `Setlist "${name}" criado e ativo`,

    songHint:
      'Só título e artista são obrigatórios — o resto o app preenche sozinho quando você importar a tablatura ou o áudio.',
    songTitle: 'Título',
    songTitlePlaceholder: 'ex.: Master of Puppets',
    artist: 'Artista',
    artistPlaceholder: 'ex.: Metallica',
    album: 'Álbum',
    year: 'Ano',
    genre: 'Gênero',
    duration: 'Duração',
    durationInvalid: 'Não entendi a duração — escreva como no player, tipo 4:32.',
    key: 'Tom',
    bpm: 'BPM',
    timeSignature: 'Compasso',
    tuning: 'Afinação',
    noTuning: '— nenhuma —',
    capo: 'Capotraste',
    notes: 'Anotações',
    addTo: 'Já colocar no setlist',
    onlyLibrary: '— só na biblioteca —',
    songCreated: (title: string) => `"${title}" entrou na biblioteca`,
    songCreatedIn: (title: string, setlist: string) => `"${title}" entrou em ${setlist}`,
    duplicate: (title: string, artist: string) =>
      `Já existe "${title}", de ${artist}, na sua biblioteca.`,
    duplicateOpen: 'Abrir a que já existe',
    duplicateAnyway: 'Criar assim mesmo'
  },

  /** Errors raised in the main process that reach the interface. */
  /*
   * O laboratório de áudio.
   *
   * Esta tela ficou de fora do catálogo por muito tempo, com o texto fixo em
   * português dentro do componente. Ela entrou aqui quando deixou de exigir
   * Docker: passou a ser a primeira coisa que alguém que não é desenvolvedor
   * encara, e uma instalação de 2,7 GB explicada num idioma que a pessoa não lê
   * é uma instalação que não acontece.
   */
  lab: {
    title: 'Laboratório de Áudio',
    subtitle: 'Separação de stems e análise, rodando na sua máquina',
    on: 'Laboratório ativo',
    off: 'Laboratório desligado',
    jobs: {
      stems: 'Separar stems',
      rhythm: 'BPM e grade de batidas',
      harmony: 'Tom e acordes',
      transcribe: 'Áudio → MIDI',
      lyrics: 'Transcrever letra'
    },
    jobDesc: {
      stems: 'O Demucs separa em vocal, bateria, baixo, guitarra, piano e outros. Gera seu guitar-only e o backing track.',
      rhythm: 'Detecta andamento, batidas e compassos para travar o loop A/B na grade.',
      harmony: 'Detecta a tonalidade e a progressão de acordes ao longo do tempo.',
      transcribe: 'O basic-pitch converte o áudio em MIDI — um rascunho de tablatura.',
      lyrics: 'O faster-whisper transcreve a letra com marcação de tempo.'
    },
    run: 'Rodar',
    rerun: 'Rodar de novo',
    sent: (job: string) => `${job} enviado para o laboratório`,
    sendFailed: 'Falha ao enviar o job',
    jobStatus: {
      queued: 'na fila',
      running: 'rodando',
      done: 'concluído',
      error: 'erro',
      canceled: 'cancelado'
    },
    stemsMade: (count: number) => `Stems gerados (${count})`,
    openFolder: 'abrir pasta',
    history: 'Histórico de jobs',
    chooseSong: 'música',
    chooseSongPlaceholder: '— escolha uma música —',
    noSongs: 'Nenhuma música com áudio local',
    noSongsDesc:
      'O laboratório precisa do arquivo de áudio. Coloque mp3/wav/flac na pasta de músicas e importe.',
    songNoAudio: 'Essa música ainda não tem áudio local',
    songNoAudioDesc:
      'O laboratório escuta a gravação. Baixe a faixa pelo botão WAV no setlist, ou coloque o arquivo na pasta de áudio e importe.',
    goToSetlist: 'Ir para o Setlist',
    demucsModel: {
      six: '6 stems (inclui guitarra)',
      four: '4 stems (melhor qualidade)',
      fourFt: '4 stems fine-tuned (mais lento)'
    },
    setup: {
      title: 'Instalar o laboratório',
      intro:
        'O laboratório roda os modelos pesados na sua máquina. Ele não vem no instalador para não deixá-lo enorme — escolha abaixo e o app baixa e configura tudo sozinho.',
      gpuFound: (name: string, driver: string) => `${name} · driver ${driver}`,
      gpuNone: 'Nenhuma placa NVIDIA encontrada — o pacote de CPU é o certo aqui',
      recommended: 'recomendado',
      packCpu: 'Processador (CPU)',
      packCpuDesc:
        'Funciona em qualquer máquina. Separar uma música leva alguns minutos em vez de alguns segundos.',
      packCuda: 'Placa NVIDIA (CUDA)',
      packCudaDesc:
        'Bem mais rápido. Precisa só do driver da NVIDIA — nada de CUDA Toolkit nem Docker.',
      install: (size: string) => `Instalar · ${size}`,
      installing: 'Instalando',
      cancel: 'Cancelar instalação',
      canceled: 'Instalação cancelada',
      timeWarning:
        'Pode levar de alguns minutos a meia hora, conforme a sua internet. Dá para fechar esta aba — o download continua.',
      phase: {
        uv: 'preparando o instalador',
        python: 'baixando o Python',
        venv: 'criando o ambiente',
        torch: 'baixando o PyTorch',
        demucs: 'instalando o Demucs',
        base: 'instalando o resto',
        done: 'pronto',
        error: 'falhou'
      },
      ready: 'Laboratório instalado',
      packInUse: (pack: string) => `pacote ${pack}`,
      start: 'Ligar',
      stop: 'Desligar',
      starting: 'Ligando',
      remove: 'Remover o laboratório',
      removeConfirm:
        'Isso apaga o ambiente Python do laboratório. Os modelos baixados ficam. Continuar?',
      removeModels: 'Apagar os modelos',
      removeModelsConfirm: 'Isso apaga os modelos baixados. Eles serão baixados de novo quando precisar. Continuar?',
      stale: 'Esta instalação é de uma versão anterior',
      staleDesc: 'Reinstale para acompanhar as versões que esta versão do app espera.',
      diskRuntime: 'ambiente',
      diskModels: 'modelos',
      models: 'Modelos',
      modelsDesc:
        'Baixados na primeira vez que você usa cada um. Antecipe aqui para não esperar no meio de um job.',
      download: 'Baixar',
      downloading: 'Baixando',
      downloaded: 'baixado',
      folders: 'Pastas'
    }
  },
  tools: {
    ffmpeg: {
      title: 'FFmpeg',
      missing: 'O FFmpeg não foi encontrado',
      missingDesc:
        'O app usa o FFmpeg para ler, converter e medir o volume dos áudios. Sem ele, importar música não funciona.',
      install: 'Baixar e instalar',
      installing: 'Baixando o FFmpeg',
      extracting: 'Instalando',
      installed: (path: string) => `Instalado pelo app em ${path}`,
      remove: 'Remover',
      onPath: 'Encontrado no sistema'
    }
  },
  update: {
    available: (version: string) => `Versão ${version} disponível`,
    download: 'Baixar',
    downloading: 'Baixando a atualização',
    ready: (version: string) => `Versão ${version} pronta para instalar`,
    restart: 'Reiniciar e atualizar',
    later: 'Depois',
    upToDate: 'Você está na versão mais recente',
    check: 'Procurar atualizações'
  },
  errors: {
    songNotFound: 'Música não encontrada',
    titleRequired: 'A música precisa de um título',
    artistRequired: 'A música precisa de um artista',
    setlistNameRequired: 'O setlist precisa de um nome',
    fileNotFound: (path: string) => `Arquivo não encontrado: ${path}`,
    windowUnavailable: 'Janela indisponível',
    noLocalAudio: 'Essa música não tem arquivo de áudio local importado',
    noLyrics: 'Resultado sem letra utilizável',
    emptyQueue: 'Nada na fila — importe músicas e marque o progresso.',
    aiNoJson: 'A IA não devolveu um patch em JSON legível — tente de novo.',
    aiNoBlocks: 'A IA respondeu, mas sem nenhum bloco utilizável — tente de novo.',
    labUnreachable: (detail: string) =>
      `Laboratório indisponível: ${detail}. Abra a aba Laboratório para ligá-lo.`,
    labRefused: (detail: string) => `Laboratório recusou o job: ${detail}`,
    spotifyNotConnected: 'Spotify não conectado',
    spotifyNotConfigured: 'O Client ID do Spotify não está configurado — coloque em Ajustes',
    encryptionUnavailable:
      'O sistema não oferece criptografia, então a chave não foi guardada.'
  }
}
