import { createRoot } from "react-dom/client";
import { CMSProvider } from "./store";
import App from "./App";
import "./styles.css";
createRoot(document.getElementById("root")!).render(
  <CMSProvider>
    <App />
  </CMSProvider>,
);
