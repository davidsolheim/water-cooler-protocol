import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Home } from "./home";
import { Spec } from "./spec";
import "./styles.css";

const path = window.location.pathname.replace(/\/$/, "") || "/";
const page = path === "/spec" ? <Spec /> : <Home />;

createRoot(document.getElementById("root")!).render(<StrictMode>{page}</StrictMode>);
