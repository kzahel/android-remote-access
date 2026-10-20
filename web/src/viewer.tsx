import { createRoot } from "react-dom/client";
import { ViewerApp } from "./viewer-app.js";
import "./viewer.css";
const root = document.getElementById("root");
if (!root) throw new Error("Missing root");
createRoot(root).render(<ViewerApp />);
