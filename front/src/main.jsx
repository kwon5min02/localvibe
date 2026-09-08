import React from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './shared/auth/AuthContext';
import { ScrapsProvider } from './features/scraps/ScrapsContext';
import { TripsProvider } from './features/trips/TripsContext';
import App from './App';
import StartHome from './pages/StartHome';
import StartLogin from './pages/StartLogin';
import StartSignin from './pages/StartSignin';

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <GoogleOAuthProvider clientId={googleClientId}>
      <BrowserRouter>
        <AuthProvider>
          <ScrapsProvider>
            <TripsProvider>
              <Routes>
                <Route path="/" element={<StartHome />} />
                <Route path="/main" element={<App />} />
                <Route path="/login" element={<StartLogin />} />
                <Route path="/signin" element={<StartSignin />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </TripsProvider>
          </ScrapsProvider>
        </AuthProvider>
      </BrowserRouter>
    </GoogleOAuthProvider>
  </React.StrictMode>,
);
