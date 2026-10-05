// El render Markdown de las respuestas de PulseBot (react-markdown, ~50 KB gz). Se carga la
// primera vez que hay una respuesta que pintar, no con el botón flotante.
import ReactMarkdown from "react-markdown";

export default function ChatbotMarkdown({ children }: { children: string }) {
  return <ReactMarkdown>{children}</ReactMarkdown>;
}
