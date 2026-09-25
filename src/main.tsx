import { createRoot } from "react-dom/client";
import App from "@/app/App.tsx";
import "@/index.css";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("ReelLife could not find the #root mount point");
}

createRoot(container).render(<App />);
