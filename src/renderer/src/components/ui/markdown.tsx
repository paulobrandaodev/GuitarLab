import { type ReactNode } from 'react'

/**
 * The markdown the models actually write, rendered.
 *
 * Every LLM answer in this app comes back as markdown — headings, bold labels,
 * nested bullets, backticked values like `5.5 / 10`. Printing it raw put
 * literal `###` and `**` on screen, which is both ugly and hard to scan while
 * holding a guitar. This is a deliberately small renderer: headings, bullets,
 * ordered lists, paragraphs, code fences, and inline bold/italic/code. No
 * tables, no links, no HTML — nothing here needs them, and a full parser is a
 * dependency plus an injection surface for text that came from a model.
 *
 * Headings use the app's orange gradient, so an answer reads like part of the
 * interface instead of a text dump.
 */

/** Split a line into bold / italic / code runs. */
function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = []
  // one pass, longest markers first so ** never loses to *
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*\n]+\*)/g
  let last = 0
  let match: RegExpExecArray | null
  let i = 0

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index))
    const token = match[0]
    const key = `${keyPrefix}-${i++}`
    if (token.startsWith('**') || token.startsWith('__')) {
      out.push(
        <strong key={key} className="text-txt font-bold">
          {token.slice(2, -2)}
        </strong>
      )
    } else if (token.startsWith('`')) {
      out.push(
        <code
          key={key}
          className="neu-inset-sm text-accent-2 rounded-[6px] px-1.5 py-0.5 font-mono text-[0.92em]"
        >
          {token.slice(1, -1)}
        </code>
      )
    } else {
      out.push(
        <em key={key} className="text-txt-dim italic">
          {token.slice(1, -1)}
        </em>
      )
    }
    last = match.index + token.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

interface ListItem {
  depth: number
  ordered: boolean
  marker: string
  text: string
}

function ListBlock({ items, keyPrefix }: { items: ListItem[]; keyPrefix: string }): ReactNode {
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li
          key={`${keyPrefix}-${i}`}
          className="flex gap-2 leading-relaxed"
          style={{ marginLeft: item.depth * 16 }}
        >
          <span
            className={
              item.ordered
                ? 'text-accent-2 shrink-0 text-[0.85em] font-bold tabular-nums'
                : 'text-accent-2 shrink-0 leading-[1.6]'
            }
          >
            {item.ordered ? item.marker : item.depth > 0 ? '◦' : '•'}
          </span>
          <span className="min-w-0 flex-1">{inline(item.text, `${keyPrefix}-${i}`)}</span>
        </li>
      ))}
    </ul>
  )
}

export function Markdown({
  content,
  className
}: {
  content: string
  className?: string
}): ReactNode {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []

  let paragraph: string[] = []
  let list: ListItem[] = []
  let fence: { lang: string; lines: string[] } | null = null

  const flushParagraph = (): void => {
    if (!paragraph.length) return
    const key = `p-${blocks.length}`
    blocks.push(
      <p key={key} className="leading-relaxed">
        {inline(paragraph.join(' '), key)}
      </p>
    )
    paragraph = []
  }

  const flushList = (): void => {
    if (!list.length) return
    const key = `l-${blocks.length}`
    blocks.push(<ListBlock key={key} items={list} keyPrefix={key} />)
    list = []
  }

  const flushAll = (): void => {
    flushParagraph()
    flushList()
  }

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')

    // ```lang … ``` — kept verbatim, the one place whitespace matters
    const fenceMatch = /^\s*```(\w*)\s*$/.exec(line)
    if (fenceMatch) {
      if (fence) {
        const key = `c-${blocks.length}`
        blocks.push(
          <pre
            key={key}
            className="neu-inset scroll-area text-txt-dim overflow-x-auto rounded-[12px] p-3 font-mono text-[12px] leading-relaxed"
          >
            {fence.lines.join('\n')}
          </pre>
        )
        fence = null
      } else {
        flushAll()
        fence = { lang: fenceMatch[1], lines: [] }
      }
      continue
    }
    if (fence) {
      fence.lines.push(raw)
      continue
    }

    if (!line.trim()) {
      flushAll()
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      flushAll()
      const level = heading[1].length
      const key = `h-${blocks.length}`
      // h1/h2 lead a section, h3+ label a sub-part; both in the gradient so the
      // structure is visible at a glance
      blocks.push(
        <h3
          key={key}
          className={
            level <= 2
              ? 'gradient-text mt-1 text-[15px] font-bold'
              : 'gradient-text mt-1 text-[13px] font-bold'
          }
        >
          {heading[2].replace(/[*_`]/g, '')}
        </h3>
      )
      continue
    }

    // --- / *** horizontal rule
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      flushAll()
      blocks.push(<hr key={`r-${blocks.length}`} className="border-edge my-1 border-t" />)
      continue
    }

    const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line)
    const ordered = /^(\s*)(\d+[.)])\s+(.*)$/.exec(line)
    if (bullet || ordered) {
      flushParagraph()
      const indent = (bullet ? bullet[1] : (ordered as RegExpExecArray)[1]).replace(/\t/g, '  ')
      list.push({
        depth: Math.min(3, Math.floor(indent.length / 2)),
        ordered: Boolean(ordered),
        marker: ordered ? (ordered as RegExpExecArray)[2] : '•',
        text: bullet ? bullet[2] : (ordered as RegExpExecArray)[3]
      })
      continue
    }

    flushList()
    paragraph.push(line.trim())
  }

  if (fence) {
    blocks.push(
      <pre
        key={`c-${blocks.length}`}
        className="neu-inset text-txt-dim overflow-x-auto rounded-[12px] p-3 font-mono text-[12px]"
      >
        {fence.lines.join('\n')}
      </pre>
    )
  }
  flushAll()

  return <div className={className ?? 'text-txt-dim space-y-2.5 text-[13px]'}>{blocks}</div>
}
