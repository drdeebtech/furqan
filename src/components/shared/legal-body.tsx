// Tiny zero-dep renderer for the legal-document body format. The text uses:
//   ## Heading      → <h2>
//   - List item     → <ul><li>
//   Other lines     → <p>
// Blank lines separate blocks. Inline formatting is intentionally not parsed.

interface Block {
  type: "h2" | "p" | "ul";
  lines: string[];
}

function parse(body: string): Block[] {
  const blocks: Block[] = [];
  const lines = body.split(/\r?\n/);
  let buffer: string[] = [];
  let inList = false;

  function flushParagraph() {
    if (buffer.length > 0) {
      blocks.push({ type: "p", lines: [buffer.join(" ")] });
      buffer = [];
    }
  }

  for (const raw of lines) {
    const line = raw.trim();
    if (line === "") {
      flushParagraph();
      inList = false;
      continue;
    }
    if (line.startsWith("## ")) {
      flushParagraph();
      inList = false;
      blocks.push({ type: "h2", lines: [line.slice(3).trim()] });
      continue;
    }
    if (line.startsWith("- ")) {
      flushParagraph();
      const item = line.slice(2).trim();
      if (inList && blocks[blocks.length - 1]?.type === "ul") {
        blocks[blocks.length - 1].lines.push(item);
      } else {
        blocks.push({ type: "ul", lines: [item] });
        inList = true;
      }
      continue;
    }
    inList = false;
    buffer.push(line);
  }
  flushParagraph();
  return blocks;
}

export function LegalBody({ body }: { body: string }) {
  const blocks = parse(body);
  return (
    <>
      {blocks.map((b, i) => {
        if (b.type === "h2") return <h2 key={i}>{b.lines[0]}</h2>;
        if (b.type === "ul") return <ul key={i}>{b.lines.map((li, j) => <li key={j}>{li}</li>)}</ul>;
        return <p key={i}>{b.lines[0]}</p>;
      })}
    </>
  );
}
