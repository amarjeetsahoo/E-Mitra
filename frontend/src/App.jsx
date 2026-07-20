import React, { useState, useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { Analytics } from "@vercel/analytics/react";

const API_BASE_URL = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:5000/api`;

const locales = {
  hindi: {
    subtitle: "दिल्ली श्रमिक साथी",
    placeholder: "अपनी समस्या यहाँ लिखें या माइक दबाएं...",
    micTitle: "माइक दबाकर बोलें",
    sendTitle: "भेजें",
    logout: "लॉग आउट करें (Log out)",
    officeCardTitle: "📍 आपका नजदीकी श्रम कार्यालय (Nearest Labour Office):",
    districtLabel: "जिला (District):",
    officeLabel: "कार्यालय (Office):",
    addressLabel: "पता (Address):",
    helplineLabel: "हेल्पलाइन (Helpline):",
    mapsLinkText: "🗺️ दिशा-निर्देश देखें (Open Google Maps)",
    authTitleRegister: "श्रमिक पंजीकरण (Register)",
    authTitleLogin: "श्रमिक लॉगिन (Login)",
    emailLabel: "ईमेल (Email Address)",
    passwordLabel: "पासवर्ड (Password)",
    authBtnRegister: "पंजीकरण करें (Register)",
    authBtnLogin: "प्रवेश करें (Login)",
    demoLogin: "✨ Quick Demo Login (डेमो लॉगिन)",
    toggleRegister: "नया खाता बनाएं (Create Account)",
    toggleLogin: "पहले से खाता है? लॉगिन करें"
  },
  english: {
    subtitle: "Delhi Labour Companion",
    placeholder: "Type your query here or tap mic...",
    micTitle: "Speak into mic",
    sendTitle: "Send",
    logout: "Log Out",
    officeCardTitle: "📍 Your Nearest Labour Office:",
    districtLabel: "District:",
    officeLabel: "Office:",
    addressLabel: "Address:",
    helplineLabel: "Helpline:",
    mapsLinkText: "🗺️ View Directions (Open Google Maps)",
    authTitleRegister: "Labour Registration",
    authTitleLogin: "Labour Login",
    emailLabel: "Email Address",
    passwordLabel: "Password",
    authBtnRegister: "Register",
    authBtnLogin: "Log In",
    demoLogin: "✨ Quick Demo Login",
    toggleRegister: "Create a new account",
    toggleLogin: "Already have an account? Log in"
  }
};

const QUICK_PROMPTS = [
  { icon: "💰", textHindi: "न्यूनतम मजदूरी दरें", textEnglish: "Minimum Wages", query: "What is the minimum wage for unskilled, semi-skilled and skilled worker in Delhi?" },
  { icon: "🚨", textHindi: "हेल्पलाइन नंबर", textEnglish: "Emergency Helplines", query: "What are the emergency labour helpline numbers in Delhi?" },
  { icon: "🆔", textHindi: "ई-श्रम कार्ड", textEnglish: "e-Shram Card", query: "How to register for e-Shram card and what are the benefits?" },
  { icon: "📍", textHindi: "पास का श्रम कार्यालय", textEnglish: "Nearest Office", query: "Where is the nearest labour commissioner office in Delhi?" }
];

function App() {
  // Auth state
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [email, setEmail] = useState(localStorage.getItem('email') || '');
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Chat and Voice state
  const [chatHistory, setChatHistory] = useState([
    {
      sender: 'bot',
      text: 'Welcome to E-Mitra',
      data: {
        hindi: "नमस्ते! मैं ई-मित्र हूँ - दिल्ली में श्रमिकों का साथी। आप मुझसे न्यूनतम मजदूरी (₹695/दिन से शुरू), श्रम अधिकारों, ई-श्रम कार्ड या अपने नजदीकी श्रम कार्यालय के बारे में पूछ सकते हैं। कृपया बोलें या टाइप करें।",
        english: "Hello! I am E-Mitra, supporting Delhi workers. Ask me about minimum wages (starts at ₹695/day), labour rights, e-Shram cards, or locate your nearest labour office. Speak or type your question below."
      }
    }
  ]);
  const [query, setQuery] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedLanguage, setSelectedLanguage] = useState('hindi'); // 'hindi' or 'english'
  
  // Geolocation & Routing state
  const [coords, setCoords] = useState(null);
  const [nearestOffice, setNearestOffice] = useState(null);
  const [locationDenied, setLocationDenied] = useState(false);

  const chatEndRef = useRef(null);
  const chatWindowRef = useRef(null);
  const quickActionsRef = useRef(null);
  const micButtonRef = useRef(null);

  const recognitionRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerIntervalRef = useRef(null);
  const abortControllerRef = useRef(null);

  const [audioUrl, setAudioUrl] = useState(null);
  const [recordingTimer, setRecordingTimer] = useState(0);
  const [speakingMessageIdx, setSpeakingMessageIdx] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false);

  const MAX_QUERY_LENGTH = 500;

  // Central audio kill-switch
  const stopAllAudio = () => {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    setSpeakingMessageIdx(null);
  };

  // Auto-scroll chat to bottom
  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [chatHistory, isLoading, audioUrl]);

  // GSAP Animation for Quick Chips entrance
  useEffect(() => {
    if (token && quickActionsRef.current) {
      gsap.fromTo(
        quickActionsRef.current.children,
        { opacity: 0, y: -10 },
        {
          opacity: 1,
          y: 0,
          stagger: 0.06,
          duration: 0.4,
          ease: 'power2.out',
          clearProps: 'all'
        }
      );
    }
  }, [token]);

  // GSAP Animation for new chat message bubbles
  useEffect(() => {
    if (chatWindowRef.current && chatHistory.length > 0) {
      const messages = chatWindowRef.current.querySelectorAll('.message');
      const lastMessage = messages[messages.length - 1];
      if (lastMessage) {
        gsap.fromTo(lastMessage, 
          { opacity: 0, y: 14 },
          { opacity: 1, y: 0, duration: 0.35, ease: 'power2.out' }
        );
      }
    }
  }, [chatHistory]);

  // Geolocation trigger on login
  useEffect(() => {
    if (token) {
      if ('geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            const { latitude, longitude } = position.coords;
            setCoords({ lat: latitude, lon: longitude });
            setLocationDenied(false);
            fetchNearestOffice(latitude, longitude);
          },
          (err) => {
            console.warn('Geolocation denied or unavailable:', err.message);
            setLocationDenied(true);
            setNearestOffice(null); // Do not auto-ping an office card on location denial
          },
          { timeout: 10000 }
        );
      } else {
        setLocationDenied(true);
        setNearestOffice(null);
      }
    }
  }, [token]);

  // Fetch Nearest District Labour Office (only when GPS lat/lon or explicit district is provided)
  const fetchNearestOffice = async (lat = null, lon = null, district = null) => {
    if ((lat === null || lat === undefined) && (lon === null || lon === undefined) && !district) {
      setNearestOffice(null);
      return;
    }

    try {
      const body = {};
      if (lat !== null && lat !== undefined) body.lat = lat;
      if (lon !== null && lon !== undefined) body.lon = lon;
      if (district) body.district = district;

      const res = await fetch(`${API_BASE_URL}/route-office`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!data.error && (data.office_name || data.title)) {
        setNearestOffice(data);
      } else {
        setNearestOffice(null);
      }
    } catch (err) {
      console.error('Failed to fetch nearest office:', err);
    }
  };

  // Auth Submit Handler
  const handleAuth = async (e) => {
    e.preventDefault();
    setError('');
    const endpoint = isRegisterMode ? 'register' : 'login';

    try {
      const res = await fetch(`${API_BASE_URL}/auth/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, password: loginPassword })
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Authentication failed');
      }

      if (isRegisterMode) {
        setIsRegisterMode(false);
        setError('Registration successful! Please log in.');
      } else {
        localStorage.setItem('token', data.token);
        localStorage.setItem('email', data.email);
        setToken(data.token);
        setEmail(data.email);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  // Demo Bypass Handler
  const handleDemoBypass = async () => {
    setLoginEmail('admin@emitra.in');
    setLoginPassword('mitra123');
    setTimeout(async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'admin@emitra.in', password: 'mitra123' })
        });
        const data = await res.json();
        if (data.token) {
          localStorage.setItem('token', data.token);
          localStorage.setItem('email', data.email);
          setToken(data.token);
          setEmail(data.email);
        }
      } catch (err) {
        setError('Demo login failed. Make sure backend server is running on port 5000.');
      }
    }, 100);
  };

  const handleLogout = () => {
    stopAllAudio();
    localStorage.removeItem('token');
    localStorage.removeItem('email');
    setToken('');
    setEmail('');
    setNearestOffice(null);
  };

  // Voice Listening Handler
  const startVoiceListening = () => {
    stopAllAudio(); // Stop any active AI voice synthesis speaking first

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError('Your browser does not support Speech Recognition. Please use Chrome/Edge or type your question.');
      return;
    }

    if (isListening) {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch (e) {}
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try { mediaRecorderRef.current.stop(); } catch (e) {}
      }
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      setIsListening(false);
      return;
    }

    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }
    setRecordingTimer(0);

    try {
      const rec = new SpeechRecognition();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = selectedLanguage === 'hindi' ? 'hi-IN' : 'en-US';

      rec.onstart = () => {
        setIsListening(true);
        setError('');
        if (micButtonRef.current) {
          gsap.to(micButtonRef.current, { scale: 1.15, duration: 0.2, yoyo: true, repeat: 1 });
        }
      };

      rec.onresult = (event) => {
        const transcript = Array.from(event.results)
          .map(result => result[0].transcript)
          .join('');
        setQuery(transcript);
      };

      rec.onerror = (e) => {
        console.error('Speech recognition error:', e);
        if (e.error === 'not-allowed') {
          setError('Microphone access blocked. Please allow microphone permissions in browser settings.');
          setIsListening(false);
        }
      };

      rec.onend = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop();
        }
        if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
        setIsListening(false);
      };

      recognitionRef.current = rec;

      navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
          const mediaRecorder = new MediaRecorder(stream);
          mediaRecorderRef.current = mediaRecorder;
          audioChunksRef.current = [];

          mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
              audioChunksRef.current.push(event.data);
            }
          };

          mediaRecorder.onstop = () => {
            const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
            const newUrl = URL.createObjectURL(audioBlob);
            setAudioUrl(newUrl);
            stream.getTracks().forEach(track => track.stop());
          };

          mediaRecorder.start();
          rec.start();

          if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
          timerIntervalRef.current = setInterval(() => {
            setRecordingTimer(prev => {
              if (prev >= 119) {
                if (mediaRecorder.state !== 'inactive') mediaRecorder.stop();
                rec.stop();
                clearInterval(timerIntervalRef.current);
                return 120;
              }
              return prev + 1;
            });
          }, 1000);
        })
        .catch(err => {
          console.warn('Microphone stream error:', err.message);
          rec.start();
        });

    } catch (err) {
      console.error('Speech recognition setup failed:', err);
      setError('Could not start speech recognition.');
    }
  };

  // Text-to-Speech (Speaker Button)
  const toggleSpeak = (text, lang, msgIdx) => {
    if (!('speechSynthesis' in window)) {
      setError('Text-to-speech is not supported in this browser.');
      return;
    }

    if (speakingMessageIdx === msgIdx) {
      stopAllAudio();
      return;
    }

    stopAllAudio();
    setSpeakingMessageIdx(msgIdx);

    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();

    if (lang === 'hindi') {
      utterance.lang = 'hi-IN';
      const hiVoice = voices.find(v => v.lang.startsWith('hi') || v.name.toLowerCase().includes('hindi'));
      if (hiVoice) utterance.voice = hiVoice;
    } else {
      utterance.lang = 'en-US';
      const enVoice = voices.find(v => v.lang.startsWith('en') && (v.name.toLowerCase().includes('google') || v.name.toLowerCase().includes('natural')));
      if (enVoice) utterance.voice = enVoice;
    }

    utterance.rate = 0.95;
    utterance.onend = () => setSpeakingMessageIdx(null);
    utterance.onerror = () => setSpeakingMessageIdx(null);

    window.speechSynthesis.speak(utterance);
  };

  // Stop active request processing handler
  const handleStopProcessing = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setIsLoading(false);
    stopAllAudio();
  };

  // Submit Chat Form
  const handleSubmit = async (e, customQuery = null) => {
    if (e) e.preventDefault();
    const messageText = (customQuery || query).trim();
    if (!messageText || isLoading) return;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    stopAllAudio();

    // Clear recorded voice preview once message is sent
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }

    if (isListening) {
      if (recognitionRef.current) try { recognitionRef.current.stop(); } catch (err) {}
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try { mediaRecorderRef.current.stop(); } catch (err) {}
      }
      setIsListening(false);
    }

    const updatedHistory = [...chatHistory, { sender: 'user', text: messageText }];
    setChatHistory(updatedHistory);
    setQuery('');
    setIsLoading(true);
    setError('');

    try {
      const res = await fetch(`${API_BASE_URL}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          query: messageText,
          locationDenied
        }),
        signal: controller.signal
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to get response');

      setChatHistory([
        ...updatedHistory,
        {
          sender: 'bot',
          text: data.english,
          data: {
            hindi: data.hindi,
            english: data.english
          }
        }
      ]);

      if (data.detectedDistrict) {
        fetchNearestOffice(null, null, data.detectedDistrict);
      }

    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('Chat submit error:', err);
      setError(err.message || 'Error communicating with E-Mitra assistant.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="app-container">
      {/* Header Banner */}
      <header>
        <div className="brand-section">
          <div className="brand-logo-badge">👷</div>
          <div className="brand-title">
            <h1>E-Mitra</h1>
            <p>{locales[selectedLanguage].subtitle}</p>
          </div>
        </div>

        <div className="header-actions">
          <div className="lang-toggle">
            <button 
              className={`lang-btn ${selectedLanguage === 'hindi' ? 'active' : ''}`}
              onClick={() => { stopAllAudio(); setSelectedLanguage('hindi'); }}
            >
              हिन्दी
            </button>
            <button 
              className={`lang-btn ${selectedLanguage === 'english' ? 'active' : ''}`}
              onClick={() => { stopAllAudio(); setSelectedLanguage('english'); }}
            >
              Eng
            </button>
          </div>

          {token && (
            <button
              className="avatar-btn"
              onClick={() => setProfileOpen(true)}
              title={email}
              aria-label="Open profile menu"
            >
              {email.charAt(0).toUpperCase()}
            </button>
          )}
        </div>
      </header>

      {/* User Profile Modal */}
      {profileOpen && (
        <div className="profile-modal-backdrop" onClick={() => setProfileOpen(false)}>
          <div className="profile-modal" onClick={(e) => e.stopPropagation()}>
            <div className="profile-modal-avatar">
              {email.charAt(0).toUpperCase()}
            </div>
            <div className="profile-modal-name">{email.split('@')[0]}</div>
            <div className="profile-modal-email">{email}</div>

            <button
              className="profile-modal-logout"
              onClick={() => { setProfileOpen(false); handleLogout(); }}
            >
              🚪 {locales[selectedLanguage].logout}
            </button>
          </div>
        </div>
      )}

      {/* Main View Area */}
      {!token ? (
        <div className="auth-container">
          {error && <div style={{ color: '#dc2626', background: '#fef2f2', padding: '0.65rem 1rem', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.85rem', fontWeight: 600 }}>{error}</div>}
          <div className="auth-card">
            <h2>{isRegisterMode ? locales[selectedLanguage].authTitleRegister : locales[selectedLanguage].authTitleLogin}</h2>
            <form className="auth-form" onSubmit={handleAuth}>
              <div className="input-group">
                <label>{locales[selectedLanguage].emailLabel}</label>
                <input 
                  type="email" 
                  value={loginEmail} 
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder="name@email.com"
                  required
                />
              </div>
              <div className="input-group">
                <label>{locales[selectedLanguage].passwordLabel}</label>
                <input 
                  type="password" 
                  value={loginPassword} 
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="******"
                  required
                />
              </div>
              <button type="submit" className="auth-btn">
                {isRegisterMode ? locales[selectedLanguage].authBtnRegister : locales[selectedLanguage].authBtnLogin}
              </button>
            </form>
            
            <button className="demo-bypass-btn" onClick={handleDemoBypass}>
              {locales[selectedLanguage].demoLogin}
            </button>

            <p style={{ textAlign: 'center', marginTop: '1.2rem', fontSize: '0.85rem' }}>
              <span 
                style={{ color: 'var(--primary)', cursor: 'pointer', fontWeight: 700 }}
                onClick={() => setIsRegisterMode(!isRegisterMode)}
              >
                {isRegisterMode ? locales[selectedLanguage].toggleLogin : locales[selectedLanguage].toggleRegister}
              </span>
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* Quick Action Prompt Chips */}
          <div className="quick-action-bar" ref={quickActionsRef}>
            {QUICK_PROMPTS.map((chip, idx) => (
              <button 
                key={idx}
                className="quick-chip"
                onClick={() => handleSubmit(null, chip.query)}
              >
                <span>{chip.icon}</span>
                <span>{selectedLanguage === 'hindi' ? chip.textHindi : chip.textEnglish}</span>
              </button>
            ))}
          </div>

          {/* Chat Window */}
          <div className="chat-window" ref={chatWindowRef}>
            {error && (
              <div style={{ color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca', padding: '0.65rem 1rem', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 600 }}>
                ⚠️ {error}
              </div>
            )}
            
            {chatHistory.map((msg, idx) => (
              <div key={idx} className={`message ${msg.sender}`}>
                {msg.sender === 'user' ? (
                  <div className="user-bubble">{msg.text}</div>
                ) : (
                  <div className="bot-bubble">
                    <div className="bilingual-panel-header">
                      <span className="panel-lang-tag">
                        🗣️ {selectedLanguage === 'hindi' ? 'हिन्दी उत्तर (Hindi)' : 'English Answer'}
                      </span>
                      <button
                        className={`speaker-btn ${speakingMessageIdx === idx ? 'speaking' : ''}`}
                        title={speakingMessageIdx === idx ? 'आवाज़ बंद करें' : 'पढ़कर सुनाएं (Read Aloud)'}
                        onClick={() => toggleSpeak(selectedLanguage === 'hindi' ? msg.data.hindi : msg.data.english, selectedLanguage, idx)}
                      >
                        {speakingMessageIdx === idx ? '⏹️' : '🔊'}
                      </button>
                    </div>

                    <div className="panel-body-text">
                      {selectedLanguage === 'hindi' ? msg.data.hindi : msg.data.english}
                    </div>

                    {/* Geolocation / District Labour Office Card */}
                    {idx === chatHistory.length - 1 && nearestOffice && (
                      <div className="office-card">
                        <h4>{locales[selectedLanguage].officeCardTitle}</h4>
                        <p><strong>{locales[selectedLanguage].districtLabel}</strong> {nearestOffice.district || nearestOffice.office_district}</p>
                        <p><strong>{locales[selectedLanguage].officeLabel}</strong> {nearestOffice.office_name || nearestOffice.title}</p>
                        <p><strong>{locales[selectedLanguage].addressLabel}</strong> {selectedLanguage === 'hindi' ? (nearestOffice.address_hindi || nearestOffice.office_address_hindi) : (nearestOffice.address_english || nearestOffice.office_address_english)}</p>
                        <p><strong>{locales[selectedLanguage].helplineLabel}</strong> {nearestOffice.helpline || nearestOffice.phone || nearestOffice.office_helpline}</p>
                        <a 
                          className="office-maps-btn"
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(nearestOffice.maps_query || nearestOffice.office_maps_query || nearestOffice.office_name || nearestOffice.title)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {locales[selectedLanguage].mapsLinkText}
                        </a>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {/* Skeleton Loading Indicator with Stop Action */}
            {isLoading && (
              <div className="message bot">
                <div className="bot-bubble">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--primary-hover)' }}>
                      ⚡ {selectedLanguage === 'hindi' ? 'उत्तर तैयार किया जा रहा है...' : 'Generating response...'}
                    </span>
                    <button 
                      type="button" 
                      onClick={handleStopProcessing}
                      style={{ background: '#fef2f2', border: '1px solid #fca5a5', color: '#dc2626', padding: '0.2rem 0.6rem', borderRadius: '6px', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                    >
                      ⏹️ {selectedLanguage === 'hindi' ? 'रोकें (Stop)' : 'Stop'}
                    </button>
                  </div>
                  <div className="skeleton-loader">
                    <div className="skeleton-line" style={{ width: '90%' }}></div>
                    <div className="skeleton-line"></div>
                    <div className="skeleton-line" style={{ width: '60%' }}></div>
                  </div>
                </div>
              </div>
            )}

            <div ref={chatEndRef} style={{ paddingBottom: '0.5rem', flexShrink: 0 }} />
          </div>

          {/* Sticky Bottom Input Dock & Audio Preview */}
          <div className="input-area-container">
            {isListening && (
              <div className="recording-status-container">
                <span className="recording-dot"></span>
                <span>
                  {selectedLanguage === 'hindi' ? '🔴 आवाज़ रिकॉर्ड हो रही है...' : '🔴 Recording voice...'} ({Math.floor(recordingTimer / 60)}:{String(recordingTimer % 60).padStart(2, '0')} / 2:00)
                </span>
              </div>
            )}

            {audioUrl && (
              <div className="audio-preview-container">
                <div className="audio-preview-header">
                  <span>{selectedLanguage === 'hindi' ? '🔊 आपका रिकॉर्ड किया गया संदेश:' : '🔊 Your Recorded Voice Message:'}</span>
                  <button 
                    type="button" 
                    className="delete-audio-btn" 
                    onClick={() => {
                      URL.revokeObjectURL(audioUrl);
                      setAudioUrl(null);
                    }}
                  >
                    ❌ {selectedLanguage === 'hindi' ? 'हटाएं' : 'Delete'}
                  </button>
                </div>
                <audio src={audioUrl} controls className="audio-playback-player" />
              </div>
            )}

            <form className="input-dock" onSubmit={handleSubmit}>
              <button 
                ref={micButtonRef}
                type="button" 
                className={`voice-mic-btn ${isListening ? 'listening' : ''}`}
                onClick={startVoiceListening}
                title={locales[selectedLanguage].micTitle}
              >
                🎤
              </button>
              <input 
                type="text" 
                className="text-input-field" 
                placeholder={locales[selectedLanguage].placeholder}
                value={query}
                onChange={(e) => setQuery(e.target.value.slice(0, MAX_QUERY_LENGTH))}
                maxLength={MAX_QUERY_LENGTH}
              />
              {isLoading ? (
                <button 
                  type="button" 
                  className="stop-processing-btn" 
                  onClick={handleStopProcessing}
                  title={selectedLanguage === 'hindi' ? 'प्रक्रिया रोकें (Stop)' : 'Stop processing'}
                >
                  ⏹️
                </button>
              ) : (
                <button type="submit" className="send-arrow-btn" title={locales[selectedLanguage].sendTitle}>
                  ➔
                </button>
              )}
            </form>
            <footer className="text-center py-2 text-xs text-amber-900/60 font-medium">
              Designed & Developed by <a href="https://amarjeetsahoo.qzz.io/" target="_blank" rel="noopener noreferrer" className="underline hover:text-amber-900 font-semibold transition-colors">Amarjeet Sahoo</a>
            </footer>
          </div>
        </>
      )}
      <Analytics />
    </div>
  );
}

export default App;
