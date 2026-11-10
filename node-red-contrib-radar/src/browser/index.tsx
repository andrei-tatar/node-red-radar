import { createRoot } from "react-dom/client";
import { App } from "./app";

const isEmbedded = new URLSearchParams(location.search).has("embed");
document.body.classList.toggle("embed", isEmbedded);

const targetElement = document.getElementById("react-app")!;
createRoot(targetElement).render(<App readonly={isEmbedded} />);
