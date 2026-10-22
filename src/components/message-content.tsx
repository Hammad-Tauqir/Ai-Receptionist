import ReactMarkdown from "react-markdown";

export function MessageContent({ text }: { text: string }) {
  return <div className="message-content"><ReactMarkdown skipHtml urlTransform={(url) => {
    try { const parsed = new URL(url); return ["https:", "http:"].includes(parsed.protocol) ? url : ""; } catch { return ""; }
  }} components={{
    a: ({ href, children }) => href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
    img: ({ alt }) => <span>{alt}</span>,
  }}>{text}</ReactMarkdown></div>;
}
