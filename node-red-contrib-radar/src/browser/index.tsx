import { createRoot } from "react-dom/client";
import { App } from "./app";

const isEmbedded = location.search.includes("embed");
if (isEmbedded) {
  document.body.classList.add("embed");
}

const targetElement = document.getElementById("react-app")!;
createRoot(targetElement).render(<App readonly={isEmbedded} />);
