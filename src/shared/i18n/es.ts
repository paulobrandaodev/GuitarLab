import { plural } from './index'
import type { Catalog } from './catalog'

/**
 * Spanish strings.
 *
 * Declared `: Catalog`, so anything missing, spare, or with the wrong argument
 * list is a compile error. Do not restructure this file — change `pt-BR.ts`,
 * the source of truth, and let the compiler point out what needs updating here.
 */
export const es: Catalog = {
  common: {
    save: 'Guardar',
    cancel: 'Cancelar',
    close: 'Cerrar',
    delete: 'Eliminar',
    edit: 'Editar',
    add: 'Añadir',
    remove: 'Quitar',
    open: 'Abrir',
    back: 'Volver',
    search: 'Buscar',
    loading: 'Cargando',
    retry: 'Reintentar',
    confirm: 'Confirmar',
    none: 'ninguno',
    never: 'nunca',
    now: 'ahora',
    yes: 'Sí',
    no: 'No',
    change: 'cambiar',
    test: 'probar',
    show: 'ver',
    hide: 'ocultar',
    empty: '—'
  },

  units: {
    hour: 'h',
    minute: 'min',
    bpm: 'BPM',
    seconds: (n: number) => `${n} ${plural(n, 'segundo', 'segundos')}`,
    songs: (n: number) => `${n} ${plural(n, 'canción', 'canciones')}`,
    sections: (n: number) => `${n} ${plural(n, 'sección', 'secciones')}`,
    tracks: (n: number) => `${n} ${plural(n, 'pista', 'pistas')}`
  },

  nav: {
    setlist: 'Setlist',
    practice: 'Estudiar',
    progress: 'Progreso',
    lab: 'Laboratorio',
    settings: 'Ajustes',
    tuner: 'Afinador',
    song: 'Canción',
    stage: 'Escenario'
  },

  labels: {
    status: {
      not_started: 'Sin empezar',
      learning: 'Aprendiendo',
      shaky: 'Insegura',
      solid: 'Sólida',
      gig_ready: 'Lista para el bolo'
    },
    instrument: {
      guitar: 'Guitarra',
      bass: 'Bajo',
      drums: 'Batería',
      vocals: 'Voz'
    },
    role: {
      lesson_tabs: 'Lesson w/ Tabs',
      backing_track: 'Backing Track',
      guitar_only: 'Guitar Only',
      bass_only: 'Bass Only',
      drums_only: 'Drums Only',
      official: 'Oficial',
      live: 'En directo',
      cover: 'Cover',
      unknown: 'Sin clasificar'
    },
    output: {
      pa: 'PA / mesa de mezclas',
      fones: 'Auriculares',
      amp: 'Amplificador'
    },
    sort: {
      ordem: 'orden',
      banda: 'banda',
      musica: 'canción',
      afinacao: 'afinación',
      duracao: 'duración'
    },
    sortDir: {
      ordem: { asc: 'orden del bolo', desc: 'orden del bolo' },
      banda: { asc: 'A–Z', desc: 'Z–A' },
      musica: { asc: 'A–Z', desc: 'Z–A' },
      afinacao: {
        asc: 'Mi estándar arriba, resto A–Z',
        desc: 'Mi estándar arriba, resto Z–A'
      },
      duracao: { asc: 'más corta → más larga', desc: 'más larga → más corta' }
    }
  },

  settings: {
    title: 'Ajustes',
    intro:
      'Pega aquí tus claves — se cifran en esta máquina y nunca salen de ella. Todo lo que esté apagado solo desactiva su propia función; la aplicación sigue funcionando.',
    firstSteps: 'Primeros pasos',
    firstStepsHint:
      'Solo FFmpeg es obligatorio — sin él, importar audio falla. Lo demás es opcional.',
    todoFfmpeg: 'Instalar FFmpeg y dejarlo en el PATH',
    todoLlm: 'Configurar un proveedor de IA (o ejecutar Ollama en local)',
    todoSpotify: 'Añadir el Client ID de Spotify (opcional)',
    todoYoutube: 'Añadir la clave de YouTube (opcional)',

    noEncryption: 'Sin cifrado del sistema',
    noEncryptionBody:
      'Las claves de API no se pueden guardar — preferimos no guardar nada antes que guardarlas en texto plano. Puedes seguir usando el archivo .env, y el resto de los ajustes funciona con normalidad.',

    saved: 'Guardado',
    saveFailed: 'No se pudo guardar',
    keyStored: 'clave guardada',
    notConfigured: 'sin configurar',
    keepPlaceholder: '•••••••• (déjalo vacío para mantenerla)',
    envWarning:
      'Una variable de entorno está fijando este valor y tiene prioridad sobre lo que guardes aquí. Quítala del entorno para usar este campo.',

    source: {
      env: 'variable de entorno',
      user: 'guardado por ti',
      dotenv: 'del archivo .env',
      default: 'por defecto'
    },

    groupAi: 'Inteligencia artificial',
    groupAiSub: 'Planes de estudio, análisis de técnica y patches de sonido',
    groupSpotify: 'Spotify',
    groupSpotifySub: 'Metadatos y control del reproductor abierto',
    groupYoutube: 'YouTube',
    groupYoutubeSub: 'Búsqueda de lecciones, backing tracks y playthroughs',
    groupLab: 'Laboratorio de audio',
    groupLabSub: 'Separación de pistas y análisis automático',
    groupFfmpeg: 'FFmpeg',

    primaryProvider: 'Proveedor principal',
    primaryProviderHint: 'Si falla, la aplicación prueba los de reserva, en orden.',
    fallback: 'Reserva',
    fallbackHint:
      'Separados por comas, probados en ese orden. Dejar Ollama al final cubre el caso de que todo lo demás esté caído.',

    language: 'Idioma',
    languageAuto: (name: string) => `Automático (${name})`,
    languageHint: 'Automático sigue el idioma del sistema operativo.',

    folders: 'Carpetas',
    folderGuitarPro: 'Guitar Pro',
    folderAudio: 'Audio',
    folderStems: 'Pistas',
    folderDb: 'Base de datos',
    folderSaved: 'Carpeta guardada — reiniciando GuitarLab…',
    foldersHint:
      'Cambiar una carpeta reinicia GuitarLab — las rutas se leen una vez, al arrancar. Las claves, los modelos y las direcciones no reinician nada. Las canciones ya importadas siguen apuntando a los archivos donde están.',

    connect: 'Conectar',
    disconnect: 'Desconectar',
    disconnected: 'Desconectado',
    connected: 'Spotify conectado',
    connecting: 'Abriendo Spotify en tu navegador…',
    connectFailed: 'No se pudo conectar',

    ffmpegMissing: 'no encontrado en el PATH',
    ffmpegHint:
      'El único requisito obligatorio: lee etiquetas, mide loudness y dibuja la forma de onda. No necesita Docker.',
    spotifyHint:
      'El inicio de sesión se abre en tu navegador (PKCE, sin contraseña en la aplicación). Sirve para metadatos y para controlar el Spotify ya abierto vía Connect.',
    youtubeQuota: (used: number, limit: number) =>
      `Cuota de hoy: ${used}/${limit} unidades. Cada búsqueda cuesta 100, así que salen unas 100 canciones al día.`,
    llmHint:
      'Se prueba primero el proveedor principal; si falla, la aplicación pasa a los de reserva, en orden.',
    labGpu: (gpu: string) => `GPU: ${gpu}`,
    labGpuUnknown: 'no informada',
    labOffline:
      'Arráncalo con "npm run lab:up". Solo hace falta para las pistas y el análisis automático.',

    fields: {
      spotifyClientId: 'Client ID',
      spotifyClientIdHint:
        'Crea una aplicación en developer.spotify.com/dashboard. Es el flujo PKCE, así que no hay client secret.',
      spotifyRedirectUri: 'Redirect URI',
      spotifyRedirectUriHint:
        'Tiene que estar registrada exactamente así en los ajustes de tu aplicación de Spotify.',
      youtubeApiKey: 'Clave de API',
      youtubeApiKeyHint:
        'console.cloud.google.com → activa "YouTube Data API v3" → crear credencial. La cuota gratuita da para unas 100 canciones al día.',
      geminiApiKey: 'Gemini — clave',
      geminiModel: 'Gemini — modelo',
      openaiApiKey: 'OpenAI — clave',
      openaiModel: 'OpenAI — modelo',
      openaiBaseUrl: 'OpenAI — dirección',
      openaiBaseUrlHint: 'Puedes apuntarlo a cualquier servicio compatible con la API de OpenAI.',
      groqApiKey: 'Groq — clave',
      groqModel: 'Groq — modelo',
      ollamaBaseUrl: 'Ollama — dirección',
      ollamaBaseUrlHint:
        'Modelos locales, sin clave y sin que nada salga de tu máquina. Instálalo desde ollama.com.',
      ollamaModel: 'Ollama — modelo',
      labUrl: 'Dirección del laboratorio',
      demucsModel: 'Modelo de Demucs',
      demucsModelHint: 'htdemucs_6s separa en 6 pistas; htdemucs hace 4 con mejor calidad.',
      demucsSegment: 'Segmento',
      demucsSegmentHint: 'Trocea el audio para que quepa en la memoria de la GPU. Menor = menos VRAM.',
      ffmpegPath: 'Ruta de FFmpeg',
      ffmpegPathHint: 'Vacío usa lo que haya en el PATH. ffprobe se deriva de esa misma ruta.'
    }
  },

  support: {
    title: 'Apoyar el proyecto',
    body:
      'GuitarLab es libre y de código abierto, y va a seguir siéndolo — no hay versión de pago. Si te sirve, puedes devolver algo.',
    sponsor: 'GitHub Sponsors',
    sponsorHint: 'Sin comisiones. Necesita una cuenta de GitHub.',
    kofi: 'Ko-fi',
    kofiHint: 'No hace falta cuenta. Tarjeta o PayPal, desde cualquier país.',
    otherWays: 'Informar de un error o traducir una pantalla ayuda igual.'
  },

  setup: {
    ffmpegMissing:
      'No se encontró FFmpeg. Sin él, importar audio no funciona — es el único requisito obligatorio de la aplicación.',
    howToInstall: 'cómo instalarlo',
    openSettings: 'ajustes',
    dismiss: 'descartar'
  },

  setlist: {
    library: 'Biblioteca',
    noSongs: 'Todavía no hay canciones',
    noSongsBody:
      'Apunta la aplicación a tus archivos e importa. Las tablaturas .gp y el audio van en carpetas separadas.',
    import: 'Importar',
    chooseFolders: 'Elegir carpetas'
  },

  manual: {
    newSetlist: 'Nuevo setlist',
    newSong: 'Nueva canción',
    addSong: 'Agregar canción',
    required: 'obligatorio',
    create: 'Crear',
    createAndOpen: 'Crear y abrir',
    moreFields: 'más campos',
    fewerFields: 'menos campos',

    setlistHint:
      'Sólo el nombre es obligatorio. La fecha, el lugar y las notas se completan cuando los sepas.',
    setlistName: 'Nombre del setlist',
    setlistNamePlaceholder: 'ej.: Show en el Sesc',
    band: 'Banda',
    bandPlaceholder: 'ej.: Covers de Metallica',
    eventDate: 'Fecha del show',
    venue: 'Lugar',
    venuePlaceholder: 'ej.: Sesc Pompeia',
    setlistCreated: (name: string) => `Setlist "${name}" creado y activo`,

    songHint:
      'Sólo el título y el artista son obligatorios — el resto lo completa la aplicación cuando importes la tablatura o el audio.',
    songTitle: 'Título',
    songTitlePlaceholder: 'ej.: Master of Puppets',
    artist: 'Artista',
    artistPlaceholder: 'ej.: Metallica',
    album: 'Álbum',
    year: 'Año',
    genre: 'Género',
    duration: 'Duración',
    durationInvalid:
      'No entendí la duración — escríbela como la muestra un reproductor, por ejemplo 4:32.',
    key: 'Tono',
    bpm: 'BPM',
    timeSignature: 'Compás',
    tuning: 'Afinación',
    noTuning: '— ninguna —',
    capo: 'Cejilla',
    notes: 'Notas',
    addTo: 'Ponerla ya en el setlist',
    onlyLibrary: '— sólo en la biblioteca —',
    songCreated: (title: string) => `"${title}" está en la biblioteca`,
    songCreatedIn: (title: string, setlist: string) => `"${title}" entró en ${setlist}`,
    duplicate: (title: string, artist: string) =>
      `"${title}", de ${artist}, ya está en tu biblioteca.`,
    duplicateOpen: 'Abrir la que ya tienes',
    duplicateAnyway: 'Crearla igual'
  },

  errors: {
    songNotFound: 'Canción no encontrada',
    titleRequired: 'La canción necesita un título',
    artistRequired: 'La canción necesita un artista',
    setlistNameRequired: 'El setlist necesita un nombre',
    fileNotFound: (path: string) => `Archivo no encontrado: ${path}`,
    windowUnavailable: 'No hay ventana disponible',
    noLocalAudio: 'Esta canción no tiene ningún archivo de audio local importado',
    noLyrics: 'El resultado no traía letra utilizable',
    emptyQueue: 'Nada en la cola — importa canciones y marca tu progreso.',
    aiNoJson: 'La IA no devolvió un patch en JSON legible — inténtalo de nuevo.',
    aiNoBlocks: 'La IA respondió, pero sin ningún bloque utilizable — inténtalo de nuevo.',
    labUnreachable: (detail: string) =>
      `Laboratorio no disponible: ${detail}. Ejecuta "npm run lab:up".`,
    labRefused: (detail: string) => `El laboratorio rechazó el trabajo: ${detail}`,
    spotifyNotConnected: 'Spotify no está conectado',
    spotifyNotConfigured: 'El Client ID de Spotify no está configurado — añádelo en Ajustes',
    encryptionUnavailable:
      'El sistema operativo no ofrece cifrado, así que la clave no se guardó.'
  }
}
