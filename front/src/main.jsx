import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import App from "./App";
import StartHome from "./pages/StartHome";
import StartLogin from "./pages/StartLogin";
import StartSignin from "./pages/StartSignin";
import "./App.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<StartHome />} />
        <Route path="/main" element={<App />} />
        <Route path="/login" element={<StartLogin />} />
        <Route path="/signin" element={<StartSignin />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
