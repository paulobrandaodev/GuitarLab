# GuitarLab

[English](README.md) · [Português](README.pt-BR.md) · **Español**

Una aplicación de escritorio para consolidar el setlist de tu banda y estudiar
guitarra de verdad — tablaturas de Guitar Pro, vídeos de YouTube, cifrados y
letras, acordes detectados directamente del audio, afinación, separación de
pistas por GPU y progreso registrado por sección, no por canción.

Electron + React + TypeScript + SQLite. Interfaz oscura, estilo neumórfico.

[![CI](https://github.com/paulobrandaodev/GuitarLab/actions/workflows/ci.yml/badge.svg)](https://github.com/paulobrandaodev/GuitarLab/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Instalación

Descarga un instalador desde
[Releases](https://github.com/paulobrandaodev/GuitarLab/releases):

| Sistema | Archivo |
|---|---|
| Windows | `GuitarLab-<versión>-instalador.exe`, o la versión portátil |
| Linux | `.AppImage` (no instala nada) o `.deb` |

**Un único requisito obligatorio: [FFmpeg](https://ffmpeg.org/download.html)**
instalado y en el `PATH`. Sin él, importar audio falla — la aplicación te avisa
en el primer arranque. Todo lo demás es opcional.

**Las compilaciones de Windows no están firmadas.** SmartScreen dirá "editor
desconocido": pulsa *Más información* → *Ejecutar de todas formas*. Un
certificado cuesta entre 200 y 400 dólares al año, algo que no se justifica en
un proyecto libre hecho por afición. Si eso te incomoda, compílalo tú mismo.

### Desde el código fuente

```bash
git clone https://github.com/paulobrandaodev/GuitarLab.git
cd GuitarLab
npm install          # también recompila better-sqlite3 para Electron
npm run dev
```

Node 22+. No hay paso de migración de base de datos: el esquema se crea en el
primer arranque.

---

## Configuración

Abre la aplicación, ve a **Ajustes** y pega las claves que tengas. **Todas las
integraciones son opcionales** — cada una que falte simplemente desactiva su
propia función y te dice qué hace falta.

Las claves se cifran con el almacén del propio sistema operativo (DPAPI en
Windows, Keychain en macOS, libsecret en Linux) y nunca salen de la máquina. Si
el sistema se niega a cifrar — un Linux sin keyring, por ejemplo — la aplicación
no guarda nada en lugar de escribir tus claves en texto plano, y te explica por
qué.

| Integración | Para qué sirve | Dónde conseguir la clave |
|---|---|---|
| **Gemini / OpenAI / Groq** | Planes de estudio, análisis de técnica, patches de sonido | [aistudio.google.com](https://aistudio.google.com/apikey) · [platform.openai.com](https://platform.openai.com/api-keys) · [console.groq.com](https://console.groq.com/keys) |
| **Ollama** | Lo mismo, en local — sin clave, nada sale de tu máquina | [ollama.com](https://ollama.com) |
| **YouTube** | Buscar lecciones, backing tracks y playthroughs | [console.cloud.google.com](https://console.cloud.google.com) → YouTube Data API v3 |
| **Spotify** | Metadatos y controlar el Spotify que ya tienes abierto | [developer.spotify.com](https://developer.spotify.com/dashboard) |

**No necesitan clave:** LRCLIB (letras sincronizadas), MusicBrainz, archive.org
(descarga de audio), alphaTab y toda la IA local.

Si ejecutas desde un clon, también funciona un archivo `.env` en la raíz — copia
[.env.example](.env.example). El orden de precedencia es: variable de entorno >
lo que guardaste en Ajustes > `.env` > valor por defecto. La pantalla de Ajustes
muestra cuál está ganando en cada campo, para que una variable de entorno que
anula en silencio una clave recién pegada sea visible y no desconcertante.

---

## Cómo se usa

1. Pon archivos `.gp3/.gp4/.gp5/.gpx/.gp` en [gptabs/](gptabs/) y audio
   (`mp3/wav/flac/m4a/ogg`) en [songs/](songs/) — o apunta la aplicación a tus
   propias carpetas desde Ajustes.
2. Abre la aplicación → **Importar pastas**.
3. Las canciones aparecen con afinación, tempo, tonalidad, secciones, letra y
   acordes ya extraídos de los archivos de Guitar Pro.
4. Añádelas a un setlist, abre **Estudar** y empieza.

El emparejamiento entre tablatura y audio se hace **por metadatos** (ID3 en MP3,
RIFF INFO en WAV, la cabecera del GP). `02.-Master Of Puppets.wav` y
`master_of_puppets_metallica_gp_v2.gp` se convierten en una sola canción,
automáticamente. Sin etiquetas, recurre al nombre de archivo normalizado con
comparación difusa.

> **Nota:** la interfaz está actualmente en portugués de Brasil. El inglés y el
> español están en camino — mira [Contribuir](#contribuir) si quieres ayudar.

---

## Pantallas

| Pantalla | Qué hace |
|---|---|
| **Setlist** | Anillo de preparación para el concierto, dominio por canción, aviso cuando dos temas seguidos piden afinaciones distintas, ordenación por banda, título, afinación (Mi estándar siempre arriba) y duración, más atajos **GP** y **WAV** por fila |
| **Estudio — Guitar Pro** | Partitura y tablatura (alphaTab), transporte con bucle A/B por sección, control de velocidad, metrónomo, cuenta atrás, mute/solo por pista, entrenador de velocidad |
| **Estudio — Pistas** | Acorde actual junto al anterior y los dos siguientes, velocidad del 50 al 100 % sin tocar el tono, transposición por semitonos sin tocar la velocidad, bucle A–B arrastrado sobre la onda y ajustado al pulso, metrónomo enganchado al audio, mute/solo y volumen por pista |
| **Canción** | Progreso por sección, vídeos, cifrado y letra, **cifrado automático** sincronizado con el audio, **cifrado generado** a partir de acordes y letra, **patches de sonido** por sección, datos |
| **Laboratorio** | Separación de pistas (Demucs), BPM y pulsos, tonalidad y pista de acordes, audio→MIDI, transcripción de letra |
| **Progreso** | Cola del día (repetición espaciada), mapa de constancia, curva de BPM, plan de estudio generado por IA |
| **Afinador** | Micrófono y detección de tono, preajuste tomado del archivo GP |
| **Modo escenario** | Pantalla completa, letra y acordes grandes, avance por teclado o pedal (flechas / AvPág / RePág) |

---

## El laboratorio de audio (opcional)

La separación de pistas y el análisis automático de BPM, tonalidad y acordes
corren en un contenedor. **La aplicación funciona entera sin él** — es la única
parte que necesita Docker.

```bash
npm run lab:up       # CPU, funciona en cualquier máquina
npm run lab:up:gpu   # NVIDIA, requiere el NVIDIA Container Toolkit
npm run lab:logs
npm run lab:down
```

Aviso: la imagen base es enorme (la final ronda los 12–15 GB), más los pesos de
los modelos que se descargan en el primer uso. Merece la pena si quieres separar
pistas; si no, sáltatelo.

Si tus carpetas de medios no están en el repositorio, copia
[.env.compose.example](.env.compose.example) a `.env` junto a
`docker-compose.yml` y apúntalo a las mismas carpetas que elegiste en Ajustes.

---

## Decisiones que conviene conocer

Esta sección explica por qué la aplicación tiene la forma que tiene. Si piensas
contribuir, léela: casi todo lo que sigue salió caro de aprender. La versión
completa y más detallada está en el
[README en portugués](README.pt-BR.md#decisões-que-valem-saber) y en el
[README en inglés](README.md#decisions-worth-knowing).

**Spotify ya no da BPM ni tonalidad.** Los endpoints `audio-features` y
`audio-analysis` se retiraron en noviembre de 2024 para aplicaciones nuevas, sin
sustituto. Esos datos salen del archivo de Guitar Pro o del análisis local.

**La reproducción de Spotify va por Connect**, no embebida. El Web Playback SDK
exige DRM Widevine, que Electron no trae de serie. La aplicación controla el
Spotify que ya está abierto en la máquina.

**YouTube: una búsqueda por canción, no tres.** La cuota gratuita son unas 100
búsquedas al día. La aplicación hace una búsqueda de 25 resultados y los
clasifica en local por expresiones regulares y reputación del canal, con un
reordenamiento por IA solo en los casos ambiguos.

**Los cifrados se pegan, no se raspan.** Ultimate Guitar y CifraClub no tienen
API pública y raspar sus páginas viola sus términos. Hay un editor ChordPro con
conversión por IA del texto pegado.

**Velocidad y tono son controles separados, y eso costó un worklet.** En Web
Audio, `playbackRate` y `detune` son lo mismo — remuestreo — así que media
velocidad es también una octava abajo, algo inútil para aprender un riff. Quien
los separa es SoundTouch corriendo como AudioWorklet. Puesto al revés, el 70 %
de velocidad sale una octava y media abajo y nada se rompe: compila, suena y
parece correcto en pantalla. Por eso `npm run test:stretch` renderiza un seno de
440 Hz real y mide lo que salió.

**El cifrado sale de la aritmética, no del modelo.** La pista de acordes que el
laboratorio oye del audio y la letra sincronizada de LRCLIB ya están en la base
de datos sin encontrarse nunca. Cada una por separado es medio cifrado. Sobre el
mismo reloj se convierten en ChordPro, con cada acorde encajado al inicio de una
palabra — un acorde a mitad de sílaba es imposible de cantar.

**Las afinaciones no se ordenan alfabéticamente.** Mi estándar va *fijado*
arriba, apunte la flecha hacia donde apunte. Es el bloque que puedes tocar sin
tocar una clavija, y es la única lectura útil de esa columna.

**La guitarra se queda en Mi estándar; el pitch shifter hace el resto.**
Reafinar entre canciones en pleno concierto no es una opción, así que la regla
es: la guitarra vive en Mi estándar, como mucho un Drop D hecho a mano, y el
bloque PS cubre la diferencia. Es aritmética sobre la afinación que declara el
archivo de Guitar Pro, no una conjetura de la IA.

**Las claves de API viven fuera de la base de datos.** La base de datos es tu
biblioteca — el archivo que copias entre máquinas. El texto cifrado de
`safeStorage` está atado al usuario del sistema, así que las claves guardadas
ahí dentro se descifrarían como basura en la otra máquina, sin forma de
distinguirlo de "clave incorrecta".

---

## Pruebas

```bash
npm test        # comprobación de tipos y toda la batería
npm run test:ci # el subconjunto que no necesita claves, GPU ni biblioteca local
```

Las suites individuales están listadas en [CONTRIBUTING.md](CONTRIBUTING.md).
Son TypeScript plano, sin framework, y varias arrancan una instancia real de
Electron y manejan la aplicación de verdad.

---

## Contribuir

Los pull requests son bienvenidos — de desarrolladores y de guitarristas. Un
buen informe sobre cómo se siente algo mientras estás estudiando de verdad vale
tanto como un parche. Mira [CONTRIBUTING.md](CONTRIBUTING.md).

Lo que más falta ahora mismo: **traducciones** (la interfaz sigue solo en
portugués), **capturas de pantalla** y **pruebas en Linux y macOS** — la
aplicación solo se ha ejercitado de verdad en Windows.

---

## Apoyar el proyecto

Si GuitarLab te resulta útil, puedes [invitarme a un café en
Ko-fi](https://ko-fi.com/paulobrandaodev). Totalmente opcional, y nunca va a
bloquear ninguna función — esto seguirá siendo libre y de código abierto de
todas formas.

---

## Licencia

MIT — mira [LICENSE](LICENSE). Los componentes de terceros y sus términos están
en [NOTICE](NOTICE), incluido por qué FFmpeg **no** se empaqueta con la
aplicación.

GuitarLab no distribuye música, tablaturas ni ningún material protegido por
derechos de autor. Organiza los archivos que ya tienes.
