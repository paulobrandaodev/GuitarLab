# GuitarLab

App desktop para consolidar o setlist da banda e estudar guitarra — tablaturas Guitar Pro, vídeos do YouTube, cifra/letra, cifra automática detectada do áudio, afinação, separação de stems na GPU e controle de progresso por trecho.

Electron + React + TypeScript + SQLite. Visual dark neumorphism.

---

## Rodando

```bash
npm install          # já compila o better-sqlite3 para o Electron
npm run dev          # desenvolvimento, com hot reload
npm run build        # gera out/
npm start            # roda o build
```

Laboratório de áudio (opcional, precisa de Docker + GPU NVIDIA):

```bash
npm run lab:up       # sobe o container CUDA
npm run lab:logs     # acompanha
npm run lab:down     # derruba
```

**O app funciona inteiro sem o container.** Só a separação de stems e a análise automática de BPM/tom/acordes dependem dele.

---

## Como usar

1. Coloque arquivos `.gp3/.gp4/.gp5/.gpx/.gp` em [gptabs/](gptabs/) e áudios (`mp3/wav/flac/m4a/ogg`) em [songs/](songs/).
2. Abra o app → **Importar pastas**.
3. As músicas aparecem com afinação, andamento, tonalidade, seções, letra e acordes já extraídos dos arquivos Guitar Pro.
4. Adicione ao setlist, abra **Estudar** e comece.

O casamento entre tablatura e áudio é **por metadado** (ID3 no MP3, RIFF INFO no WAV, cabeçalho do GP). `02.-Master Of Puppets.wav` e `master_of_puppets_metallica_gp_v2.gp` viram uma música só, automaticamente. Sem tags, cai para nome de arquivo normalizado com comparação fuzzy.

---

## Telas

| Tela | O que faz |
|---|---|
| **Setlist** | Anel de prontidão do show, músicas com domínio individual, aviso de troca de afinação entre faixas seguidas, **ordenação** por banda, música, afinação (E padrão sempre no topo) e duração, atalhos **GP** e **WAV** por linha para buscar a tablatura e baixar a faixa |
| **Estudar — Guitar Pro** | Partitura + tablatura (alphaTab), transporte com loop A/B por trecho, slider de velocidade, metrônomo, contagem, mute/solo por trilha, treinador de velocidade |
| **Estudar — Stems** | Acorde atual em degradê com o anterior e os dois seguintes, velocidade de 50% a 100% sem mexer no tom, transposição por semitom sem mexer na velocidade, loop A–B arrastado na forma de onda com encaixe na batida, metrônomo trancado no áudio, mute/solo e volume por faixa |
| **Música** | Progresso por trecho, vídeos, cifra/letra, **cifra automática** sincronizada com o áudio, **cifra gerada** dos acordes + letra sincronizada, **patches de timbre** por trecho, dados |
| **Laboratório** | Separação de stems (Demucs), BPM/batidas, tom + trilha de acordes, áudio→MIDI, transcrição de letra |
| **Progresso** | Fila do dia (SRS), heatmap de constância, curva de BPM, plano de treino gerado por IA |
| **Afinador** | Microfone + detecção de pitch, preset vindo do arquivo GP |
| **Modo Palco** | Tela cheia, letra/cifra grande, avanço por teclado ou pedal (setas / PageUp / PageDown) |

---

## Configuração (`.env`)

O app abre e funciona com o `.env` vazio — cada integração se desliga sozinha e mostra o que falta em **Ajustes**.

```bash
SPOTIFY_CLIENT_ID=            # developer.spotify.com/dashboard (PKCE, sem secret)
SPOTIFY_REDIRECT_URI=http://127.0.0.1:8888/callback
YOUTUBE_API_KEY=              # console.cloud.google.com → YouTube Data API v3

LLM_PROVIDER=gemini           # gemini | groq | ollama
LLM_FALLBACK_PROVIDER=ollama  # usado quando o principal falha
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.5-flash
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=...

GPTABS_DIR=...                # pastas de mídia
SONGS_DIR=...
STEMS_DIR=...
FFMPEG_PATH=                  # vazio = usa o do PATH
FORGE_LAB_URL=http://127.0.0.1:8756
DEMUCS_MODEL=htdemucs_6s      # htdemucs = 4 stems (melhor qualidade)
DEMUCS_SEGMENT=7              # chunking para GPUs de 8 GB
```

**Não precisam de chave:** LRCLIB (letra sincronizada), MusicBrainz, alphaTab e toda a IA local.

Tokens OAuth ficam criptografados com `safeStorage` (DPAPI no Windows), nunca no `.env`.

---

## Decisões que valem saber

**Spotify não fornece mais BPM nem tom.** Os endpoints `audio-features` e `audio-analysis` foram descontinuados em nov/2024 para apps novos, sem substituto. Esses dados vêm do arquivo Guitar Pro ou da análise local. Fevereiro/2026 também cortou `search` para 10 resultados e removeu busca em lote, então o cliente usa fila limitada e cache agressivo.

**Reprodução do Spotify é via Connect**, não embutida. O Web Playback SDK exige DRM Widevine, que o Electron padrão não traz — só um fork com assinatura VMP. O app comanda o Spotify que já está aberto na máquina. O driver fica atrás de uma interface, então trocar depois é plugar outra implementação.

**YouTube: uma busca por música, não três.** A cota gratuita são ~100 buscas/dia. O app faz uma busca com 25 resultados e classifica localmente nos papéis (Lesson w/ Tabs, Backing Track, Guitar Only) por regex + reputação de canal, com re-rank por IA só nos casos ambíguos. Resultado fica em cache permanente, e há o caminho manual de colar URL, que não gasta cota.

**Cifras são coladas, não raspadas.** Ultimate Guitar e CifraClub não têm API pública e raspar viola os termos deles. O app tem editor ChordPro com conversão por IA de texto colado, e deep link para o site.

**Tablatura: o app não baixa, mas recebe.** Pela mesma razão acima, o botão **GP** abre a busca do Ultimate Guitar já filtrada em `type=500` (só Guitar Pro) com `rating[0]=4&rating[1]=5` — os parâmetros são os que a própria página usa nos filtros "Guitar Pro Tab" e "High rated", então acompanham o site em vez de adivinhar. A janela que abre tem os downloads interceptados: o arquivo que você clicar cai direto em [gptabs/](gptabs/) e é importado na música de origem, sem passar pela pasta Downloads. Quem escolhe e clica é você; o app só decide onde o arquivo mora. A sessão é persistente e separada da do app, então um login Pro sobrevive entre execuções. O CifraClub entra como alternativa, resolvido para a página exata da música pelo mesmo autocomplete que a busca do site usa.

**Áudio vem do archive.org, e esse é automático.** O archive.org tem busca e metadados públicos, então o botão **WAV** faz o caminho inteiro: procura o item, pontua faixa por faixa contra o título e o artista da música (o mesmo casador do importador), prefere wav/flac a mp3, baixa para [songs/](songs/) e importa — duração, loudness EBU R128 e forma de onda saem na hora. Download parcial é apagado: um wav truncado em `songs/` viraria uma faixa corrompida para sempre.

**O sidecar roda o código do repositório, não o da imagem.** O Dockerfile copia `lab/app` para dentro da imagem, então editar o Python e rodar `npm run lab:up` deixava o container servindo a versão antiga — a análise respondia `done` com um resultado sem acordes e o app não tinha o que guardar. Agora o compose monta `lab/app` por cima (somente leitura) e o uvicorn roda com `--reload`: salvou o arquivo, o container recarrega.

**Cifra automática, no estilo Chordify.** O `/harmony` do laboratório deixou de devolver só o tom: ele rastreia as batidas, tira um chroma por batida do sinal harmônico (percussão borra o chroma) e casa contra gabaritos de acorde — maior, menor, 7, m7, maj7 e power chord, que é metade de um riff de metal. O passe final é um Viterbi com penalidade fixa para trocar de acorde; sem ele o rótulo muda a cada batida e não dá para ler. A tela mostra os blocos na ordem, acende o que está tocando, pula para o trecho no clique e transpõe por semitom. A barrinha embaixo de cada acorde é a confiança — vermelha quer dizer trecho ambíguo, vale conferir de ouvido.

**Velocidade e tom são controles separados, e isso custou um worklet.** No Web Audio, `playbackRate` e `detune` são a mesma coisa — reamostragem — então meia velocidade também é uma oitava abaixo, o que não serve para estudar riff nenhum. Quem separa os dois é o SoundTouch (time-stretch WSOLA + transpositor de taxa) rodando como AudioWorklet. A divisão de trabalho não é óbvia pelos nomes: quem muda a velocidade continua sendo a *fonte*, com o `playbackRate` dela, e o parâmetro `playbackRate` do nó diz ao processador o quanto empurrar o tom de volta (ele calcula `pitch × 2^(semitons/12) ÷ playbackRate`). Ou seja, os dois recebem o mesmo número, e `pitchSemitones` é a transposição livre por cima. Trocado de lado, 70% de velocidade sai uma oitava e meia abaixo e nada quebra — compila, toca e parece certo na tela. Por isso `npm run test:stretch` renderiza uma senoide de 440 Hz de verdade e mede o que saiu. Em 100% e sem transposição o nó sai do caminho: latência e artefato de graça não interessam.

**O clique do metrônomo entra pelo barramento, não direto na saída.** O time-stretcher atrasa o áudio em dezenas de milissegundos. Um clique que pulasse esse caminho chegaria adiantado em relação à batida que devia marcar — e a 150 bpm, 50 ms é meia semicolcheia. Então o metrônomo entra no mesmo barramento das faixas, antes do stretcher: os dois sofrem o mesmo atraso e ficam trancados. Em troca, o clique passa pelo transpositor, então a frequência dele é pré-compensada para sair sempre no mesmo tom. A grade das batidas vem do laboratório quando existe (a gravação acelera no refrão; uma grade rígida de BPM desgruda da banda em um minuto) e cai no BPM declarado quando não existe.

**O loop A–B é nativo, e o cabeçote sabe disso.** A repetição usa `loop`/`loopStart`/`loopEnd` do próprio `AudioBufferSourceNode`, então a volta é sample-exata e nada reinicia. O preço é que o relógio precisa descobrir a virada sozinho — e, quando descobre, reancorar no *instante exato* em que ela aconteceu, não em "agora": arredondar para o quadro corrente adiciona um erro por volta, e um trecho de dois compassos estudado por cinco minutos termina com o metrônomo uma batida fora. `resolvePosition` faz essa conta e `npm run test:tempo` roda duzentas voltas para provar que não acumula.

**A cifra sai da aritmética, não do modelo.** Duas análises já ficam no banco sem nunca se encontrarem: a trilha de acordes que o laboratório ouve do áudio e a letra sincronizada do LRCLIB. Cada uma sozinha é meia cifra. No mesmo relógio, elas viram ChordPro: para cada linha cantada, o acorde que já estava soando abre a linha e as trocas seguintes caem proporcionalmente ao tempo, sempre encaixadas no começo de uma palavra — acorde no meio de uma sílaba é impossível de cantar. Buraco longo entre duas linhas vira bloco instrumental; o que sobra depois da última vira final. Um modelo pedido para "colocar os acordes no lugar certo" inventa os dois; os carimbos de tempo são verdade. Cifra escrita à mão nunca é sobrescrita em silêncio: quando já existe uma, a gerada abre no editor.

**Afinação não se ordena em ordem alfabética.** Ordenar o setlist por afinação não é A–Z: E padrão é *fixado* no topo, nos dois sentidos da seta. É o bloco que dá para tocar sem encostar numa tarraxa, e é a única leitura útil dessa coluna — só o resto vira A–Z ou Z–A. Ordenar é um jeito de *ler* o setlist, nunca de reescrevê-lo: as linhas continuam mostrando o lugar delas no show e a alça de arrastar só fica viva na ordem do show, porque soltar uma linha numa lista ordenada por duração gravaria uma ordem que ninguém pediu.

**Um patch por timbre, não um por música.** Master of Puppets tem riff sujo, um trecho limpo no meio e um solo — um patch médio não serve para nenhum dos três. A IA devolve uma lista em ordem cronológica (no máximo 4), cada um com nome, o trecho onde entra, sua própria cadeia de sinal desenhada e os knobs. Os nomes dos trechos vêm do arquivo Guitar Pro, então o patch diz "entra no solo" em vez de "na parte mais pesada".

**A guitarra fica em E padrão; o pitch shifter faz o resto.** Trocar de afinação entre músicas no meio do show não é uma opção, então a regra é: a guitarra vive em E padrão, no máximo um Drop D feito na mão, e o bloco PS cobre a diferença. Isso é aritmética sobre a afinação que o arquivo Guitar Pro declara, não palpite de IA — `planPitchShifter` compara as seis cordas com E padrão e decide: deslocamento uniforme vira PS puro (Eb → −1), padrão de drop vira Drop D na mão mais o PS (Drop C# → Drop D −1), e afinação aberta ou de 7 cordas ele avisa que não dá. O número entra no prompt como fato e volta no plano sem passar pelo modelo.

**O botão CTRL tem dono.** A GT-1 tem um único footswitch atribuível, então cada patch declara o que vale colocar nele naquele trecho — wah, whammy, boost de solo, ligar o delay — com o que um toque faz e quando se usa. Quando não há nada que justifique, o campo volta nulo em vez de inventar.

**Resposta de IA é markdown, e é lida como markdown.** As respostas vinham com `###` e `**` literais na tela. Um renderizador pequeno (títulos, listas aninhadas, negrito, código, cercas) desenha isso com os títulos no degradê laranja da interface. Sem biblioteca: nada aqui precisa de tabela ou link, e um parser completo seria dependência nova mais superfície de injeção para texto que veio de um modelo.

**Título é o nome da música, não a embalagem da loja.** O Spotify entrega "The Four Horsemen - Remastered" e "The Trooper (Original Album Version)". Além de feio no setlist, nenhum site de tablatura ou item do archive.org está catalogado assim — as buscas voltavam vazias. `cleanTitle` derruba só o rabo que é *só* qualificador (remaster, versão de álbum, ao vivo, feat.), então "Sgt. Pepper - Reprise" e "Show Me How to Live" ficam inteiros. Vale na importação, nas buscas e uma vez sobre o que já está no banco.

**Só guitarra.** O modelo de dados continua com uma linha de progresso por instrumento (o arquivo Guitar Pro traz todas as trilhas), mas a interface parou de perguntar: nada de abas guitarra/baixo/bateria, e a fila do dia filtra por guitarra. O painel de trilhas da tela Estudar continua mostrando qualquer trilha sob demanda.

**Reimportar a mesma playlist atualiza o setlist.** O setlist guarda o id da playlist do Spotify que o criou. Uma segunda importação sincroniza em vez de duplicar: quem saiu da playlist sai do setlist, quem entrou é acrescentado e a ordem passa a ser a da playlist. As linhas que sobrevivem mantêm o id, então tom planejado e nota de transição não são jogados fora a cada atualização.

**O renderer roda em `app://`, não `file://`.** Sob `file://` o navegador bloqueia Web Workers e blobs, que o alphaTab precisa para diagramar a partitura fora da thread principal.

**Uma trilha por vez na partitura.** Master of Puppets tem 5 guitarras em 425 compassos; desenhar todas leva ~27s e fica ilegível. O padrão é a trilha principal do instrumento escolhido, e o painel lateral adiciona as outras sob demanda. Música de tamanho normal renderiza em ~2s.

**Volume equalizado entre fontes.** O FFmpeg mede loudness EBU R128 na importação (Master of Puppets deu −16,0 LUFS; The Trooper, −9,3) e o app compensa o ganho, para trocar de fonte no meio de um loop sem levar susto.

---

## Estrutura

```
src/main/          processo principal: SQLite, IPC, importadores, integrações
  db/              schema Drizzle, DDL de bootstrap, consultas
  importers/       Guitar Pro (alphaTab headless), áudio (ffprobe), matcher
  media/ffmpeg.ts  tags, loudness, forma de onda, conversões
  services/        spotify, youtube, lrclib, lab, llm/
  services/sources.ts      links de tablatura + busca/download no archive.org
  services/tabdownload.ts  janela do site com download apontado para gptabs/
  services/tone.ts         afinação→pitch shifter, prompt dos patches, normalização
  practice/        SRS, escada de andamento, cálculo de domínio
src/shared/chords.ts  transposição, leitura da trilha de acordes e validação do JSON do lab
src/shared/tempo.ts   grade de batidas, encaixe na batida e o cabeçote dentro do loop A–B
src/shared/cifra.ts   acordes detectados + letra sincronizada → ChordPro
src/shared/sort.ts    ordenação das listas (E padrão fixado no topo da afinação)
src/preload/       ponte tipada (contextBridge)
src/renderer/      React: design system + telas
  features/practice/MultitrackPlayer.tsx  player de stems: velocidade, tom, loop A–B, metrônomo
  features/practice/stretcher.ts          worklet SoundTouch (tempo e tom independentes)
lab/               sidecar Python (FastAPI + Demucs + librosa + basic-pitch + whisper)
scripts/verify.ts  verificação ponta a ponta contra os arquivos reais
```

O banco fica em `%APPDATA%/guitarlab/guitarlab.db` — um arquivo, backup por cópia. Na primeira abertura depois da renomeação, o banco antigo (`%APPDATA%/setlist-lab/setlist-lab.db`) é copiado para cá; o original fica onde está.

---

## Verificação

```bash
npm test               # typecheck + toda a bateria abaixo
npm run test:setlist   # setlists, bandas, exclusão, sincronia da playlist, limpeza de títulos
npm run test:sources   # links do UG, ranking e busca real no archive.org
npm run test:chords    # transposição, leitura da trilha e validação do JSON do lab
npm run test:tempo     # grade de batidas, encaixe e o cabeçote sem acumular erro no loop
npm run test:cifra     # acordes + letra sincronizada viram ChordPro sem picar palavra
npm run test:sort      # ordenação das listas, com E padrão fixado no topo
npm run test:stretch   # renderiza 440 Hz e mede: velocidade e tom são mesmo independentes
npm run test:player    # abre o app de verdade e trabalha o player de stems (precisa de build antes)
npm run test:tone      # afinação→pitch shifter, CTRL e a lista de patches
npm run test:markdown  # a resposta da IA renderizada de verdade (react-dom/server)
npm run test:chordmap  # detecção de acordes de ponta a ponta (pula se o container estiver fora)
npm run test:llm       # o prompt de timbre contra os provedores reais
```

Ponta a ponta contra os arquivos reais:

```bash
npm run build
npx esbuild scripts/verify.ts --bundle --platform=node --format=esm --target=node22 \
  --outfile=out/verify/index.js --external:electron --external:better-sqlite3 \
  --alias:@shared=./src/shared
./node_modules/electron/dist/electron.exe out/verify
```

Roda o pipeline inteiro contra os arquivos reais: parse dos três formatos GP, leitura de tags, importação, casamento tab↔áudio, classificador do YouTube, LRCLIB, cadeia de IA com fallback e fila de estudo.
