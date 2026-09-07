<div align="center">

<img src="docs/logo.png" alt="GuitarLab" width="150">

# GuitarLab

[English](README.md) · [Português](README.pt-BR.md) · **Español**

Una aplicación de escritorio para consolidar el setlist de tu banda y estudiar
guitarra de verdad — tablaturas de Guitar Pro, vídeos de YouTube, cifrados y
letras, acordes detectados directamente del audio, afinación, separación de
pistas por GPU y progreso registrado por sección, no por canción.

Electron + React + TypeScript + SQLite. Interfaz oscura, estilo neumórfico.

[![CI](https://github.com/paulobrandaodev/GuitarLab/actions/workflows/ci.yml/badge.svg)](https://github.com/paulobrandaodev/GuitarLab/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
<br>
[![Sponsor](https://img.shields.io/badge/GitHub-Sponsor-EA4AAA?logo=githubsponsors&logoColor=white)](https://github.com/sponsors/paulobrandaodev)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-Buy%20me%20a%20coffee-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/paulobrandaodev)

<br>

<img src="docs/screenshots/04-tablatura.png" alt="GuitarLab: tablatura de Guitar Pro con el transporte, la lista de secciones y mute/solo por pista" width="900">

<sub>Más pantallas abajo — <a href="#pantallas">Pantallas</a></sub>

</div>

---

## Instalación

Descarga un instalador desde
[Releases](https://github.com/paulobrandaodev/GuitarLab/releases):

| Sistema | Archivo |
|---|---|
| Windows | `GuitarLab-<versión>-instalador.exe`, o la versión portátil |
| Linux | `.AppImage` (no instala nada) o `.deb` |

**Nada más que instalar.** La aplicación necesita [FFmpeg](https://ffmpeg.org/)
y, si todavía no está en tu `PATH`, hay un botón en Ajustes que lo descarga e
instala por ti. El laboratorio de audio — separación de pistas y análisis — se
instala también desde dentro de la aplicación, así que no hay Python ni Docker
que configurar.

Todo excepto el laboratorio funciona en cuanto termina el instalador.

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
5. ¿Sin ningún archivo? **Nova música** y **Novo setlist**, en la pantalla de
   setlist, crean ambos a mano — un setlist sólo necesita un nombre, y una
   canción sólo un título y un artista. Lo demás (álbum, duración, tono, tempo,
   afinación…) puede esperar, o llega solo cuando llega la tablatura o el audio.

El emparejamiento entre tablatura y audio se hace **por metadatos** (ID3 en MP3,
RIFF INFO en WAV, la cabecera del GP). `02.-Master Of Puppets.wav` y
`master_of_puppets_metallica_gp_v2.gp` se convierten en una sola canción,
automáticamente. Sin etiquetas, recurre al nombre de archivo normalizado con
comparación difusa.

> **Sobre el idioma de la interfaz:** GuitarLab toma el idioma de tu sistema
> operativo y puedes cambiarlo en Ajustes. La traducción está a medio camino: la
> maquinaria, las etiquetas compartidas y la pantalla de Ajustes hablan los tres
> idiomas, y el resto de las pantallas siguen solo en portugués. Migrar una
> pantalla es una tarea autocontenida y una primera contribución muy útil; mira
> [CONTRIBUTING.md](CONTRIBUTING.md#translations).

---

## Pantallas

Esto es la aplicación funcionando sobre una biblioteca real — un setlist real,
tablaturas reales, pistas reales, historial de estudio real. Aquí no hay ningún
mockup: las capturas las toma [`scripts/screenshots.mjs`](scripts/screenshots.mjs),
que arranca la aplicación y la maneja, así que se regeneran en lugar de rehacerse
a mano. La interfaz que se ve está en portugués, por lo explicado justo arriba.

<table>
<tr>
<td width="50%"><img src="docs/screenshots/01-setlist.png" alt="Setlist"></td>
<td width="50%"><img src="docs/screenshots/02-setlist-musica.png" alt="Una canción abierta en su propia fila del setlist"></td>
</tr>
<tr>
<td><b>Setlist</b> — anillo de preparación para el concierto, dominio por canción y aviso cuando dos temas seguidos piden afinaciones distintas. Ordenación por banda, título, afinación (Mi estándar siempre arriba) y duración.</td>
<td><b>Cada fila se abre donde está</b> — último estudio, afinación, tonalidad y tempo, más los atajos <b>GP</b> y <b>WAV</b> que buscan la tablatura y descargan la pista.</td>
</tr>
<tr>
<td><img src="docs/screenshots/03-musica.png" alt="Progreso por sección"></td>
<td><img src="docs/screenshots/04-tablatura.png" alt="Tablatura de Guitar Pro con el reproductor"></td>
</tr>
<tr>
<td><b>Canción</b> — el progreso se lleva por sección, no por canción. Veintisiete aquí, cada una avanzando de <i>sin empezar</i> a <i>lista para el concierto</i> por su cuenta, con su propio BPM objetivo.</td>
<td><b>Estudio — Guitar Pro</b> — partitura y tablatura (alphaTab), transporte con bucle A/B por sección, control de velocidad, metrónomo, cuenta atrás, mute/solo por pista, entrenador de velocidad.</td>
</tr>
<tr>
<td><img src="docs/screenshots/05-stems.png" alt="Reproductor multipista de pistas separadas"></td>
<td><img src="docs/screenshots/06-cifra.png" alt="Cifrado detectado del audio"></td>
</tr>
<tr>
<td><b>Estudio — Pistas</b> — velocidad del 50 al 100 % sin tocar el tono, transposición por semitonos sin tocar la velocidad, bucle A–B arrastrado sobre la onda y ajustado al pulso, metrónomo enganchado al audio, mute/solo y volumen por pista.</td>
<td><b>Acordes</b> — el cifrado detectado directamente del audio y sincronizado con él, con el acorde actual junto al anterior y los dos siguientes. La barra bajo cada bloque es la confianza: en rojo significa pasaje ambiguo, que conviene comprobar de oído.</td>
</tr>
<tr>
<td><img src="docs/screenshots/07-videos.png" alt="Vídeos de YouTube clasificados por función"></td>
<td><img src="docs/screenshots/08-timbre.png" alt="Patches de sonido para tu propio equipo"></td>
</tr>
<tr>
<td><b>Vídeos</b> — una búsqueda por canción, 25 resultados clasificados localmente en Lesson w/ Tabs, Backing Track y Guitar Only, y guardados para siempre. Pegar una URL a mano no gasta cuota alguna.</td>
<td><b>Sonido</b> — patches escritos para el equipo que de verdad tienes y para las secciones que de verdad tocas, con la cadena de señal y cada mando que el patch espera que ajustes.</td>
</tr>
<tr>
<td><img src="docs/screenshots/09-laboratorio.png" alt="Laboratorio de audio"></td>
<td><img src="docs/screenshots/10-progresso.png" alt="Progreso, constancia y BPM"></td>
</tr>
<tr>
<td><b>Laboratorio</b> — separación de pistas (Demucs), BPM y pulsos, tonalidad y pista de acordes, audio→MIDI, transcripción de letra. Totalmente opcional: en esta captura el contenedor está apagado, y la aplicación lo dice en vez de romperse.</td>
<td><b>Progreso</b> — cola del día (repetición espaciada), mapa de constancia, curva de BPM, plan de estudio generado por IA.</td>
</tr>
<tr>
<td><img src="docs/screenshots/11-afinador.png" alt="Afinador"></td>
<td><img src="docs/screenshots/12-palco.png" alt="Modo escenario"></td>
</tr>
<tr>
<td><b>Afinador</b> — micrófono y detección de tono, con el preajuste tomado del archivo GP.</td>
<td><b>Modo escenario</b> — pantalla completa, letra y acordes grandes, avance por teclado o pedal (flechas / AvPág / RePág).</td>
</tr>
</table>

---

## El laboratorio de audio (opcional)

Separación de pistas, BPM y rejilla de pulsos, tonalidad y acordes, audio→MIDI
y transcripción de la letra. **La aplicación funciona entera sin él** — está
apagado hasta que lo instalas, y cada pantalla que lo usa lo dice en vez de
romperse.

Se instala desde dentro de la aplicación: abre la pestaña **Laboratorio** y
elige un paquete.

| Paquete | Descarga | En disco | Para |
|---|---|---|---|
| Procesador (CPU) | ~400 MB | ~1,8 GB | cualquier máquina |
| NVIDIA (CUDA) | ~2,7 GB | ~7 GB | tarjeta NVIDIA, driver 525+ |

La aplicación descarga [uv](https://github.com/astral-sh/uv), le pide un CPython
3.10 propio, monta un entorno virtual e instala allí PyTorch, Demucs, librosa,
basic-pitch y faster-whisper. Nada de eso va en el instalador, y por eso el
instalador ocupa ~116 MB y no varios gigabytes. Los pesos de los modelos son
otra descarga aparte, con su tamaño a la vista y un botón por línea.

**El paquete CUDA solo necesita el driver de NVIDIA.** Sin CUDA Toolkit, sin
Container Toolkit, sin Docker — el runtime de CUDA viaja dentro de los paquetes
`nvidia-*-cu12` que arrastra PyTorch. Esa es la razón práctica de que el
contenedor haya desaparecido: la GPU pasó de exigir "instala Docker Desktop y un
runtime de contenedores" a exigir "ya tienes el driver".

Todo queda en la carpeta de datos de la aplicación, y **Quitar el laboratorio**
lo deshace.

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

<div align="center">

**GuitarLab es libre, de código abierto, y va a seguir siéndolo.**

Si te ahorró una noche peleándote con tablaturas, puedes darme las gracias así:

| | |
|---|---|
| [![Sponsor](https://img.shields.io/badge/GitHub%20Sponsors-Mensual%20o%20puntual-EA4AAA?style=for-the-badge&logo=githubsponsors&logoColor=white)](https://github.com/sponsors/paulobrandaodev) | Lo mejor si ya tienes cuenta en GitHub. **Sin comisiones.** |
| [![Ko-fi](https://img.shields.io/badge/Ko--fi-Inv%C3%ADtame%20a%20un%20caf%C3%A9-FF5E5B?style=for-the-badge&logo=ko-fi&logoColor=white)](https://ko-fi.com/paulobrandaodev) | **No hace falta cuenta.** Tarjeta o PayPal, desde cualquier país. |

</div>

Los dos funcionan desde cualquier parte del mundo, y ninguno va a bloquear
ninguna función — no hay versión de pago ni la va a haber. Si el dinero no es lo
que quieres gastar aquí, un informe de error, una pantalla traducida, o
simplemente contárselo a otro guitarrista ayuda igual.

---

## Licencia

MIT — mira [LICENSE](LICENSE). Los componentes de terceros y sus términos están
en [NOTICE](NOTICE), incluido por qué FFmpeg **no** se empaqueta con la
aplicación.

GuitarLab no distribuye música, tablaturas ni ningún material protegido por
derechos de autor. Organiza los archivos que ya tienes.
