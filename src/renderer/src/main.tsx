import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './design/tokens.css'

const root = document.getElementById('root')
if (!root) throw new Error('Elemento #root não encontrado')

/**
 * If the preload bridge failed to load, every screen would throw on its first
 * data call and leave a blank window. Fail loudly with something actionable
 * instead — a white screen tells the user nothing.
 */
if (!window.api) {
  root.innerHTML = `
    <div style="height:100%;display:grid;place-items:center;padding:40px;
                font-family:Inter,system-ui,sans-serif;color:#f2f2f5;text-align:center">
      <div style="max-width:520px;background:#212128;padding:40px;border-radius:28px;
                  box-shadow:-6px -6px 14px rgba(255,255,255,.045),8px 8px 18px rgba(0,0,0,.55)">
        <h1 style="margin:0 0 12px;font-size:20px;
                   background:linear-gradient(135deg,#FFD15C,#FF8A5C 45%,#FF4E8A);
                   -webkit-background-clip:text;background-clip:text;color:transparent">
          Ponte com o processo principal indisponível
        </h1>
        <p style="margin:0;color:#8b8b98;font-size:14px;line-height:1.6">
          O script de preload não carregou, então o app não consegue falar com o banco
          nem com os arquivos. Rode <code style="font-family:monospace">npm run build</code>
          e abra de novo. Se persistir, confira o console do processo principal.
        </p>
      </div>
    </div>`
} else {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}
