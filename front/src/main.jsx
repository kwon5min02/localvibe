import React from "react";
import ReactDOM from "react-dom/client";
import { GoogleOAuthProvider } from "@react-oauth/google";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import App from "./App";
import StartHome from "./pages/StartHome";
import StartLogin from "./pages/StartLogin";
import StartSignin from "./pages/StartSignin";
import "./App.css";

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <GoogleOAuthProvider clientId={googleClientId}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<StartHome />} />
          <Route path="/main" element={<App />} />
          <Route path="/login" element={<StartLogin />} />
          <Route path="/signin" element={<StartSignin />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </GoogleOAuthProvider>
  </React.StrictMode>
);
